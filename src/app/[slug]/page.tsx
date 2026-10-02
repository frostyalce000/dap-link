import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Experience } from "@/components/participant/experience";
import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { getPublishedCampaignBySlug } from "@/lib/campaigns";
import { INTERVIEWER_NAME, MAX_FOLLOW_UPS, VOICE_MAX_SECONDS } from "@/lib/interview/edna";
import { isValidSlug } from "@/lib/slug";

// Campaign content can change at any time, so this page is rendered per request.
export const dynamic = "force-dynamic";

const loadCampaign = cache(async (slug: string) =>
  isValidSlug(slug) ? getPublishedCampaignBySlug(slug) : null,
);

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const found = await loadCampaign(slug);
  if (!found) return { title: "Link not found", robots: { index: false } };
  const { campaign, brandName } = found;
  const title = `${campaign.productName}: share your opinion, get ${campaign.rewardHeadline}`;
  const description = `${brandName} wants your opinion. Answer a few quick questions and get ${campaign.rewardHeadline}.`;
  const images = campaign.productImageUrl ? [campaign.productImageUrl] : undefined;
  return {
    title: { absolute: title },
    description,
    // Individual campaign links are meant to be shared, not found by search.
    robots: { index: false },
    openGraph: { title, description, images, type: "website" },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images },
  };
}

export default async function PublicLinkPage(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const found = await loadCampaign(slug);

  if (!found) {
    // A paused campaign gets an explanation; anything else is a plain 404.
    const [paused] = isValidSlug(slug)
      ? await db
          .select({ status: campaigns.status })
          .from(campaigns)
          .where(eq(campaigns.slug, slug))
          .limit(1)
      : [];
    if (paused?.status !== "paused") notFound();
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">This link is taking a break</h1>
        <p className="mt-2 text-[15px] leading-snug text-ink-soft">
          It isn&apos;t accepting responses right now. Please check back later.
        </p>
      </main>
    );
  }

  const { campaign, brandName, questions } = found;
  return (
    <Experience
      slug={campaign.slug}
      brandName={brandName}
      productName={campaign.productName}
      productDescription={campaign.productDescription}
      productImageUrl={campaign.productImageUrl}
      rewardHeadline={campaign.rewardHeadline}
      questions={questions.map((q) => q.text)}
      interviewerName={INTERVIEWER_NAME}
      voiceMaxSeconds={VOICE_MAX_SECONDS}
      maxFollowUps={MAX_FOLLOW_UPS}
    />
  );
}
