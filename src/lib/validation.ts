import { z } from "zod";
import { isValidSlug } from "@/lib/slug";

/** Strips control characters and collapses whitespace in single-line input. */
const singleLine = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

const multiLine = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim())
    .pipe(z.string().max(max));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const MAX_QUESTIONS = 5;

export const campaignInputSchema = z
  .object({
    productName: singleLine(80).pipe(z.string().min(2, "Give the product or campaign a name.")),
    productDescription: multiLine(600),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .refine(isValidSlug, "Use 3–48 lowercase letters, numbers and dashes."),
    questions: z
      .array(singleLine(200))
      .transform((qs) => qs.filter((q) => q.length > 0))
      .pipe(
        z
          .array(z.string().min(5, "Questions need at least 5 characters."))
          .min(1, "Add at least one question.")
          .max(MAX_QUESTIONS, `Keep it to ${MAX_QUESTIONS} questions or fewer.`),
      ),
    rewardHeadline: singleLine(80).pipe(z.string().min(2, "Say what people get, e.g. “20% off”.")),
    rewardKind: z.enum(["generated", "static"]),
    rewardCodePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, "Use 2–10 letters or numbers."))
      .optional(),
    rewardStaticCode: singleLine(40).optional(),
    rewardInstructions: singleLine(200),
  })
  .superRefine((value, ctx) => {
    if (value.rewardKind === "static" && !value.rewardStaticCode) {
      ctx.addIssue({
        code: "custom",
        path: ["rewardStaticCode"],
        message: "Enter the discount code to give out.",
      });
    }
  });

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const startSessionSchema = z.object({
  slug: z.string().max(64),
  mode: z.enum(["voice", "text"]),
  consent: z.object({
    version: z.string().max(20),
    responses: z.literal(true),
    aiAnalysis: z.literal(true),
    approximateLocation: z.boolean(),
  }),
  source: z.string().max(80).nullish(),
  referrer: z.string().max(300).nullish(),
});

export const turnsSchema = z.object({
  turns: z
    .array(
      z.object({
        clientTurnId: z.string().min(1).max(80),
        seq: z.number().int().min(0).max(10_000),
        role: z.enum(["assistant", "user"]),
        text: multiLine(4000).pipe(z.string().min(1)),
      }),
    )
    .min(1)
    .max(50),
});

export const chatSchema = z.object({
  clientTurnId: z.string().min(1).max(80),
  message: multiLine(1000).pipe(z.string().min(1)),
});

export const completeSchema = z.object({
  email: emailSchema,
});
