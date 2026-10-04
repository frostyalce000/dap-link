import { describe, expect, it } from "vitest";
import { matchQuestion } from "@/components/participant/use-voice-interview";
import { sessionAnalysisSchema } from "@/lib/analysis/schema";
import { confidenceLabel, formatDuration, formatLocation, formatMoney, formatPercent } from "@/lib/format";
import { buildChatOpening, buildVoiceInstructions } from "@/lib/interview/edna";
import { getDeviceType } from "@/lib/request";
import { generateCode } from "@/lib/rewards";
import { isValidSlug, slugify } from "@/lib/slug";
import { campaignInputSchema, completeSchema, startSessionSchema, turnsSchema } from "@/lib/validation";

describe("slugs", () => {
  it("turns product names into URL-safe slugs", () => {
    expect(slugify("Air Max — Feedback!")).toBe("air-max-feedback");
    expect(slugify("  Crème brûlée  candle ")).toBe("creme-brulee-candle");
    expect(slugify("a".repeat(80)).length).toBeLessThanOrEqual(48);
  });

  it("rejects reserved, short and malformed slugs", () => {
    expect(isValidSlug("nike-airmax-feedback")).toBe(true);
    expect(isValidSlug("dashboard")).toBe(false);
    expect(isValidSlug("api")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("Has-Caps")).toBe(false);
    expect(isValidSlug("double--dash")).toBe(false);
    expect(isValidSlug("../etc/passwd")).toBe(false);
  });
});

describe("reward codes", () => {
  it("uses the prefix and an unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode("NORTH20")).toMatch(/^NORTH20-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it("does not repeat in a realistic batch", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateCode("DAP")));
    expect(codes.size).toBe(2000);
  });
});

describe("campaign validation", () => {
  const valid = {
    productName: "The Everyday Hoodie",
    productDescription: "Heavyweight cotton.",
    slug: "everyday-hoodie",
    questions: ["What do you think of it?", "", "How much should it cost?"],
    rewardHeadline: "20% off",
    rewardKind: "generated",
    rewardCodePrefix: "north20",
    rewardInstructions: "",
  };

  it("accepts a normal campaign, dropping blank questions and upper-casing the prefix", () => {
    const parsed = campaignInputSchema.parse(valid);
    expect(parsed.questions).toEqual(["What do you think of it?", "How much should it cost?"]);
    expect(parsed.rewardCodePrefix).toBe("NORTH20");
  });

  it("requires at least one question and at most five", () => {
    expect(campaignInputSchema.safeParse({ ...valid, questions: ["", " "] }).success).toBe(false);
    expect(
      campaignInputSchema.safeParse({ ...valid, questions: Array(6).fill("What do you think?") }).success,
    ).toBe(false);
  });

  it("requires a code when one shared code is chosen", () => {
    expect(campaignInputSchema.safeParse({ ...valid, rewardKind: "static" }).success).toBe(false);
    expect(
      campaignInputSchema.safeParse({ ...valid, rewardKind: "static", rewardStaticCode: "WELCOME20" }).success,
    ).toBe(true);
  });

  it("strips control characters from single-line fields", () => {
    const parsed = campaignInputSchema.parse({ ...valid, productName: "Hoodie\u0000\n  two" });
    expect(parsed.productName).toBe("Hoodie two");
  });
});

describe("public API validation", () => {
  it("requires consent to start", () => {
    const base = { slug: "everyday-hoodie", mode: "voice", source: null, referrer: null };
    const consent = { version: "v1", responses: true, aiAnalysis: true, approximateLocation: false };
    expect(startSessionSchema.safeParse({ ...base, consent }).success).toBe(true);
    expect(startSessionSchema.safeParse({ ...base, consent: { ...consent, responses: false } }).success).toBe(false);
    expect(startSessionSchema.safeParse({ ...base, consent: { ...consent, aiAnalysis: false } }).success).toBe(false);
  });

  it("normalises and validates emails", () => {
    expect(completeSchema.parse({ email: "  Sam@Example.COM " }).email).toBe("sam@example.com");
    expect(completeSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("rejects empty and oversized transcript batches", () => {
    const turn = { clientTurnId: "item_1", seq: 0, role: "user", text: "It looks great" };
    expect(turnsSchema.safeParse({ turns: [turn] }).success).toBe(true);
    expect(turnsSchema.safeParse({ turns: [] }).success).toBe(false);
    expect(turnsSchema.safeParse({ turns: [{ ...turn, text: "   " }] }).success).toBe(false);
    expect(turnsSchema.safeParse({ turns: Array(51).fill(turn) }).success).toBe(false);
  });
});

describe("interviewer brief", () => {
  const brief = {
    brandName: "Studio North",
    productName: "The Everyday Hoodie",
    productDescription: "",
    rewardHeadline: "20% off",
    questions: ["What do you think of it?", "How much should it cost?"],
  };

  it("includes every question, numbered, in the voice instructions", () => {
    const instructions = buildVoiceInstructions(brief);
    expect(instructions).toContain("1. What do you think of it?");
    expect(instructions).toContain("2. How much should it cost?");
    expect(instructions).toContain("finish_interview");
  });

  it("opens the typed interview with the first question", () => {
    expect(buildChatOpening(brief)).toContain("2 quick questions");
    expect(buildChatOpening(brief).endsWith("What do you think of it?")).toBe(true);
    expect(buildChatOpening({ ...brief, questions: ["Only one?"] })).toContain("Just one quick question");
  });
});

describe("voice progress tracking", () => {
  const questions = [
    "What do you think of this hoodie?",
    "How much do you think it should cost?",
    "What would make you more likely to buy it?",
  ];

  it("recognises a question asked word for word or lightly rephrased", () => {
    expect(matchQuestion("Got it. How much do you think it should cost?", questions)).toBe(2);
    expect(matchQuestion("Thanks! And what would make you more likely to buy it?", questions)).toBe(3);
    expect(matchQuestion("Hi there, what do you think of this hoodie?", questions)).toBe(1);
  });

  it("does not mistake an acknowledgement or a follow-up for a question", () => {
    expect(matchQuestion("Thanks, that's really helpful. Your reward is ready on screen.", questions)).toBeNull();
    expect(matchQuestion("What is it about the fit that puts you off?", questions)).toBeNull();
  });
});

describe("analysis schema", () => {
  const analysis = {
    summary: "Likes it.",
    overall_sentiment: { label: "positive", confidence: 1.4 },
    emotional_tone: { labels: ["excited"], confidence: 0.6 },
    purchase_intent: { level: "unclear", likelihood: null, confidence: 0.2, evidence: "" },
    price_sensitivity: { level: "unclear", confidence: 0.1, evidence: "" },
    willingness_to_pay: { amount: -5, currency: null, confidence: 0, evidence: "" },
    product_preference: null,
    likes: Array(20).fill("minimal design"),
    dislikes: [],
    objections: [],
    needs: [],
    requested_changes: [],
    topics: [],
    key_quotes: ["x".repeat(1000)],
    questions: [],
  };

  it("clips over-long output instead of rejecting the whole analysis", () => {
    const parsed = sessionAnalysisSchema.parse(analysis);
    expect(parsed.overall_sentiment.confidence).toBe(1);
    expect(parsed.likes).toHaveLength(8);
    expect(parsed.key_quotes[0]).toHaveLength(300);
    expect(parsed.willingness_to_pay.amount).toBeNull();
  });

  it("rejects values outside the allowed labels", () => {
    expect(
      sessionAnalysisSchema.safeParse({ ...analysis, overall_sentiment: { label: "ecstatic", confidence: 1 } }).success,
    ).toBe(false);
  });
});

describe("rate limiting by network", () => {
  it("treats every address in one IPv6 /64 as one visitor", async () => {
    process.env.IP_HASH_SALT = "test-salt";
    const { hashIp } = await import("@/lib/request");
    expect(hashIp("2001:db8:1:2::5")).toBe(hashIp("2001:db8:1:2:ffff:ffff:ffff:9"));
    expect(hashIp("2001:db8:1:2::5")).not.toBe(hashIp("2001:db8:1:3::5"));
    expect(hashIp("::ffff:203.0.113.7")).toBe(hashIp("203.0.113.7"));
    expect(hashIp("203.0.113.7")).not.toBe(hashIp("203.0.113.8"));
    expect(hashIp(null)).toBeNull();
  });
});

describe("database error handling", () => {
  const queryError = () => {
    const err = new Error("Failed query: insert into participants\nparams: someone@example.com");
    err.name = "DrizzleQueryError";
    (err as Error & { cause: unknown }).cause = { code: "23505", constraint_name: "campaigns_slug_key" };
    return err;
  };

  it("never puts query parameters in the log line", async () => {
    const { describeError } = await import("@/db/errors");
    const line = describeError(queryError());
    expect(line).toBe("DrizzleQueryError pg 23505 campaigns_slug_key");
    expect(line).not.toContain("example.com");
  });

  it("recognises a unique violation by constraint name", async () => {
    const { isUniqueViolation } = await import("@/db/errors");
    expect(isUniqueViolation(queryError(), "campaigns_slug_key")).toBe(true);
    expect(isUniqueViolation(queryError(), "rewards_session_key")).toBe(false);
    expect(isUniqueViolation(new Error("other"), "campaigns_slug_key")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats durations, percentages and money", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(75)).toBe("1m 15s");
    expect(formatDuration(null)).toBe("–");
    expect(formatPercent(0.826)).toBe("83%");
    expect(formatPercent(null)).toBe("–");
    expect(formatMoney(70, "USD")).toBe("$70");
    expect(formatMoney("79.50", "USD")).toBe("$79.50");
    expect(formatMoney(70, null)).toBe("70");
  });

  it("names locations and confidence bands", () => {
    expect(formatLocation("Austin", "US")).toBe("Austin, United States");
    expect(formatLocation(null, null)).toBeNull();
    expect(confidenceLabel(0.9)).toBe("High");
    expect(confidenceLabel(0.5)).toBe("Medium");
    expect(confidenceLabel(0.2)).toBe("Low");
  });

  it("classifies devices from the user agent", () => {
    expect(getDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(getDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0")).toBe("desktop");
    expect(getDeviceType(null)).toBeNull();
  });
});
