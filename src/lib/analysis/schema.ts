import { z } from "zod";

/**
 * The structured output of analysing one interview.
 *
 * Every judgement carries a confidence between 0 and 1, and "unclear" is a
 * valid answer everywhere: a short interview often does not say anything
 * about price or purchase intent, and the dashboard should show that honestly
 * instead of inventing a number.
 *
 * Bump SESSION_SCHEMA_VERSION when the shape changes so old rows can be
 * re-analysed.
 */
export const SESSION_SCHEMA_VERSION = 1;
export const CAMPAIGN_SCHEMA_VERSION = 1;

export const SENTIMENTS = ["positive", "neutral", "negative", "mixed"] as const;
export const LEVELS = ["high", "medium", "low", "unclear"] as const;

/**
 * Strict structured output fixes the shape but not lengths or ranges, so those
 * are clipped rather than rejected: an over-long quote should be shortened,
 * not fail the whole analysis.
 */
const clip = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const upTo = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).transform((items) => items.slice(0, max));
const unit = z.number().transform((n) => Math.min(1, Math.max(0, n)));

const confidence = unit;
const phraseList = upTo(clip(120), 8);

export const sessionAnalysisSchema = z.object({
  summary: clip(400),
  overall_sentiment: z.object({ label: z.enum(SENTIMENTS), confidence }),
  emotional_tone: z.object({ labels: upTo(clip(40), 4), confidence }),
  purchase_intent: z.object({
    level: z.enum(LEVELS),
    likelihood: unit.nullable(),
    confidence,
    evidence: clip(300),
  }),
  price_sensitivity: z.object({
    level: z.enum(LEVELS),
    confidence,
    evidence: clip(300),
  }),
  willingness_to_pay: z.object({
    amount: z.number().nullable().transform((n) => (n !== null && n >= 0 ? n : null)),
    currency: clip(8).nullable(),
    confidence,
    evidence: clip(300),
  }),
  product_preference: clip(160).nullable(),
  likes: phraseList,
  dislikes: phraseList,
  objections: phraseList,
  needs: phraseList,
  requested_changes: phraseList,
  topics: phraseList,
  key_quotes: upTo(clip(300), 4),
  questions: z.array(
    z.object({
      question_number: z.number().int(),
      answered: z.boolean(),
      answer_verbatim: clip(1500),
      answer_summary: clip(300),
      sentiment: z.enum(SENTIMENTS),
    }),
  ),
});

export type SessionAnalysis = z.infer<typeof sessionAnalysisSchema>;

const conf = { type: "number", description: "0 to 1. How well the transcript supports this." };
const phrases = (description: string) => ({
  type: "array",
  description,
  items: { type: "string" },
});

/** JSON Schema twin of `sessionAnalysisSchema`, in OpenAI strict mode. */
export const sessionAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "overall_sentiment",
    "emotional_tone",
    "purchase_intent",
    "price_sensitivity",
    "willingness_to_pay",
    "product_preference",
    "likes",
    "dislikes",
    "objections",
    "needs",
    "requested_changes",
    "topics",
    "key_quotes",
    "questions",
  ],
  properties: {
    summary: {
      type: "string",
      description: "One or two plain sentences on what this person thinks.",
    },
    overall_sentiment: {
      type: "object",
      additionalProperties: false,
      required: ["label", "confidence"],
      properties: { label: { type: "string", enum: SENTIMENTS }, confidence: conf },
    },
    emotional_tone: {
      type: "object",
      additionalProperties: false,
      required: ["labels", "confidence"],
      properties: {
        labels: {
          type: "array",
          description: "Up to 3 single-word emotion signals, e.g. excited, hesitant, indifferent.",
          items: { type: "string" },
        },
        confidence: conf,
      },
    },
    purchase_intent: {
      type: "object",
      additionalProperties: false,
      required: ["level", "likelihood", "confidence", "evidence"],
      properties: {
        level: { type: "string", enum: LEVELS },
        likelihood: {
          type: ["number", "null"],
          description: "Estimated chance of buying, 0 to 1. Null when the transcript gives no signal.",
        },
        confidence: conf,
        evidence: { type: "string", description: "What they said that supports this, or why it is unclear." },
      },
    },
    price_sensitivity: {
      type: "object",
      additionalProperties: false,
      required: ["level", "confidence", "evidence"],
      properties: {
        level: { type: "string", enum: LEVELS, description: "high = price is a major factor for them." },
        confidence: conf,
        evidence: { type: "string" },
      },
    },
    willingness_to_pay: {
      type: "object",
      additionalProperties: false,
      required: ["amount", "currency", "confidence", "evidence"],
      properties: {
        amount: {
          type: ["number", "null"],
          description: "The price they said it should cost or they would pay. Null unless they gave a figure; use the midpoint of a range.",
        },
        currency: { type: ["string", "null"], description: "ISO code such as USD, or null if not stated or implied." },
        confidence: conf,
        evidence: { type: "string" },
      },
    },
    product_preference: {
      type: ["string", "null"],
      description: "A stated preference between options (colour, size, variant), or null.",
    },
    likes: phrases("What they like. Short lowercase phrases, 2-5 words, e.g. 'minimal design'."),
    dislikes: phrases("What they dislike. Short lowercase phrases."),
    objections: phrases("Reasons they might not buy. Short lowercase phrases."),
    needs: phrases("Underlying needs or jobs they want done. Short lowercase phrases."),
    requested_changes: phrases("Changes they asked for. Short lowercase phrases, e.g. 'darker colours'."),
    topics: phrases("Main topics they raised. Short lowercase phrases."),
    key_quotes: {
      type: "array",
      description: "Up to 3 of the participant's most telling sentences, copied word for word.",
      items: { type: "string" },
    },
    questions: {
      type: "array",
      description: "One entry per merchant question, in order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question_number", "answered", "answer_verbatim", "answer_summary", "sentiment"],
        properties: {
          question_number: { type: "integer" },
          answered: { type: "boolean" },
          answer_verbatim: {
            type: "string",
            description: "The participant's own words answering this question, including any follow-up answer. Empty if not answered.",
          },
          answer_summary: { type: "string" },
          sentiment: { type: "string", enum: SENTIMENTS },
        },
      },
    },
  },
} as const;

const themeSchema = z.object({
  theme: clip(120),
  response_numbers: z.array(z.number().int()),
  quote: clip(300).nullable(),
});

export const campaignAnalysisSchema = z.object({
  headline: clip(300),
  top_likes: upTo(themeSchema, 6),
  top_objections: upTo(themeSchema, 6),
  requested_changes: upTo(themeSchema, 6),
  themes: upTo(themeSchema, 8),
  price_expectations: z.object({
    summary: clip(300),
    low: z.number().nullable(),
    high: z.number().nullable(),
    currency: clip(8).nullable(),
  }),
  representative_quotes: upTo(
    z.object({ quote: clip(300), response_number: z.number().int() }),
    6,
  ),
  suggested_actions: upTo(clip(200), 4),
});

export type CampaignAnalysis = z.infer<typeof campaignAnalysisSchema>;
export type CampaignTheme = z.infer<typeof themeSchema>;

const themeJson = (description: string) => ({
  type: "array",
  description,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["theme", "response_numbers", "quote"],
    properties: {
      theme: { type: "string", description: "Short label, 2-5 words." },
      response_numbers: {
        type: "array",
        description: "The numbers of every response that expresses this theme.",
        items: { type: "integer" },
      },
      quote: { type: ["string", "null"], description: "One verbatim quote that illustrates it, if available." },
    },
  },
});

export const campaignAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "top_likes",
    "top_objections",
    "requested_changes",
    "themes",
    "price_expectations",
    "representative_quotes",
    "suggested_actions",
  ],
  properties: {
    headline: {
      type: "string",
      description: "One or two sentences a merchant can act on, stating the main pattern across responses.",
    },
    top_likes: themeJson("What people most often like, most common first. Merge near-duplicates."),
    top_objections: themeJson("The most common reasons not to buy, most common first."),
    requested_changes: themeJson("The most requested changes, most common first."),
    themes: themeJson("Other recurring themes worth knowing about."),
    price_expectations: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "low", "high", "currency"],
      properties: {
        summary: { type: "string", description: "What people expect to pay, or that too few gave a figure to say." },
        low: { type: ["number", "null"] },
        high: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
      },
    },
    representative_quotes: {
      type: "array",
      description: "Up to 5 verbatim quotes that together represent the range of opinion.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "response_number"],
        properties: { quote: { type: "string" }, response_number: { type: "integer" } },
      },
    },
    suggested_actions: {
      type: "array",
      description: "Up to 3 concrete next steps the responses support.",
      items: { type: "string" },
    },
  },
} as const;
