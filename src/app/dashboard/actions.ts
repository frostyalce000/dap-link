"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { describeError, isUniqueViolation } from "@/db/errors";
import { campaigns, questions } from "@/db/schema";
import { analyzePendingSessions } from "@/lib/analysis/analyze-session";
import { synthesizeCampaign } from "@/lib/analysis/synthesize-campaign";
import { requireMerchant } from "@/lib/auth";
import { getOwnedCampaign } from "@/lib/campaigns";
import { env } from "@/lib/env";
import { generateStructured } from "@/lib/openai";
import { rateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { MAX_QUESTIONS, campaignInputSchema } from "@/lib/validation";

export type CampaignFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const IMAGE_BUCKET = "campaign-images";
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

/** Uploads a product photo and returns its public URL. */
async function uploadProductImage(merchantId: string, file: File): Promise<string> {
  const extension = IMAGE_TYPES[file.type];
  if (!extension) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is too large. Try a smaller one.");

  const supabase = createSupabaseAdminClient();
  // The file name is generated here; nothing from the upload ends up in the path.
  const path = `${merchantId}/${randomUUID()}.${extension}`;
  const body = Buffer.from(await file.arrayBuffer());

  let { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, body, { contentType: file.type, cacheControl: "31536000" });
  if (error && /bucket not found/i.test(error.message)) {
    await supabase.storage.createBucket(IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: Object.keys(IMAGE_TYPES),
    });
    ({ error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, body, { contentType: file.type, cacheControl: "31536000" }));
  }
  if (error) throw new Error("The image couldn't be uploaded. Please try again.");
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Creates or updates a campaign from the builder form. */
export async function saveCampaign(
  _previous: CampaignFormState,
  formData: FormData,
): Promise<CampaignFormState> {
  const merchant = await requireMerchant();
  const campaignId = String(formData.get("campaignId") ?? "");
  const publish = formData.get("intent") === "publish";

  const existing = campaignId ? await getOwnedCampaign(merchant.id, campaignId) : null;
  if (campaignId && !existing) return { error: "That campaign couldn't be found." };

  const parsed = campaignInputSchema.safeParse({
    productName: formData.get("productName") ?? "",
    productDescription: formData.get("productDescription") ?? "",
    slug: formData.get("slug") ?? "",
    questions: formData.getAll("questions").map(String),
    rewardHeadline: formData.get("rewardHeadline") ?? "",
    rewardKind: formData.get("rewardKind") ?? "generated",
    rewardCodePrefix: formData.get("rewardCodePrefix") || undefined,
    rewardStaticCode: formData.get("rewardStaticCode") || undefined,
    rewardInstructions: formData.get("rewardInstructions") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  const input = parsed.data;

  const [slugTaken] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.slug, input.slug), ne(campaigns.id, existing?.id ?? randomUUID())))
    .limit(1);
  if (slugTaken) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: { slug: "That link is already taken. Try another." },
    };
  }

  let productImageUrl = existing?.productImageUrl ?? null;
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    try {
      productImageUrl = await uploadProductImage(merchant.id, image);
    } catch (err) {
      return {
        error: "Please fix the highlighted fields.",
        fieldErrors: { image: err instanceof Error ? err.message : "The image couldn't be uploaded." },
      };
    }
  } else if (formData.get("removeImage") === "1") {
    productImageUrl = null;
  }

  const now = new Date();
  const status = publish ? "published" : (existing?.status ?? "draft");
  const values = {
    slug: input.slug,
    productName: input.productName,
    productDescription: input.productDescription,
    productImageUrl,
    rewardHeadline: input.rewardHeadline,
    rewardKind: input.rewardKind,
    rewardCodePrefix: input.rewardCodePrefix ?? existing?.rewardCodePrefix ?? "DAP",
    rewardStaticCode: input.rewardKind === "static" ? (input.rewardStaticCode ?? null) : null,
    rewardInstructions: input.rewardInstructions,
    status,
    publishedAt: status === "published" ? (existing?.publishedAt ?? now) : (existing?.publishedAt ?? null),
    updatedAt: now,
  } as const;

  let savedId: string;
  try {
    savedId = await db.transaction(async (tx) => {
      let id = existing?.id;
      if (id) {
        await tx.update(campaigns).set(values).where(eq(campaigns.id, id));
      } else {
        const [created] = await tx
          .insert(campaigns)
          .values({ ...values, merchantId: merchant.id })
          .returning({ id: campaigns.id });
        id = created!.id;
      }

      // Questions that are unchanged keep their row (and their answers).
      // Changed or removed ones are archived rather than deleted, so earlier
      // responses still point at the question they were actually asked.
      const current = await tx
        .select()
        .from(questions)
        .where(and(eq(questions.campaignId, id), isNull(questions.archivedAt)))
        .orderBy(questions.position);
      for (let position = 0; position < Math.max(current.length, input.questions.length); position++) {
        const before = current[position];
        const text = input.questions[position];
        if (before && before.text === text) continue;
        if (before) {
          await tx.update(questions).set({ archivedAt: now }).where(eq(questions.id, before.id));
        }
        if (text) await tx.insert(questions).values({ campaignId: id, position, text });
      }
      return id;
    });
  } catch (err) {
    // Two merchants saving the same new slug at once: the unique index decides.
    if (isUniqueViolation(err, "campaigns_slug_key")) {
      return {
        error: "Please fix the highlighted fields.",
        fieldErrors: { slug: "That link is already taken. Try another." },
      };
    }
    throw err;
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/campaigns/${savedId}${publish && existing?.status !== "published" ? "?published=1" : ""}`);
}

export async function setCampaignStatus(campaignId: string, status: "published" | "paused"): Promise<void> {
  const merchant = await requireMerchant();
  const campaign = await getOwnedCampaign(merchant.id, campaignId);
  if (!campaign) return;
  await db
    .update(campaigns)
    .set({
      status,
      publishedAt: status === "published" ? (campaign.publishedAt ?? new Date()) : campaign.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaign.id));
  refresh();
}

/** Re-runs any missing analysis and rebuilds the across-responses summary. */
export async function refreshInsights(campaignId: string): Promise<void> {
  const merchant = await requireMerchant();
  const campaign = await getOwnedCampaign(merchant.id, campaignId);
  if (!campaign) return;
  const limit = await rateLimit(`insights:${campaign.id}`, { limit: 6, windowSeconds: 10 * 60 });
  if (!limit.ok) return;
  await analyzePendingSessions(campaign.id, 10);
  try {
    await synthesizeCampaign(campaign.id);
  } catch (err) {
    console.error("[analysis] manual refresh failed:", describeError(err));
  }
  refresh();
}

const suggestionSchema = z.object({ questions: z.array(z.string()) });

/** Drafts interview questions from the product details, to get a merchant started. */
export async function suggestQuestions(
  productName: string,
  productDescription: string,
): Promise<{ questions: string[] } | { error: string }> {
  const merchant = await requireMerchant();
  const limit = await rateLimit(`suggest:${merchant.id}`, { limit: 20, windowSeconds: 60 * 60 });
  if (!limit.ok) return { error: "You've used a lot of suggestions. Try again in a little while." };

  const name = productName.trim().slice(0, 80);
  if (name.length < 2) return { error: "Add a product name first." };

  try {
    const result = await generateStructured({
      model: env.chatModel,
      name: "question_suggestions",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["questions"],
        properties: { questions: { type: "array", items: { type: "string" } } },
      },
      system: `You help a merchant write questions for a one-minute spoken customer interview about a product.

Write exactly 3 questions. They will be asked aloud by an AI interviewer, one at a time.
- Each is short (under 15 words), open-ended, neutral and easy to answer out loud without preparation.
- Together they should cover: first impression or what they like and dislike, what price feels right, and what would make them more likely to buy.
- Adapt the wording to the product. No yes/no questions, no leading questions, no jargon.`,
      user: `Product or campaign: ${name}\nDetails: ${productDescription.trim().slice(0, 600) || "(none given)"}`,
      parse: (value) => suggestionSchema.parse(value),
    });
    return {
      questions: result.questions
        .map((q) => q.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, MAX_QUESTIONS),
    };
  } catch {
    return { error: "Couldn't suggest questions right now. Please try again." };
  }
}
