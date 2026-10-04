import "server-only";
import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

export type RateLimitRule = { limit: number; windowSeconds: number };

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Fixed-window counter stored in Postgres.
 *
 * Serverless functions share no memory, so the counter has to live somewhere
 * shared. One atomic upsert per check keeps it correct under concurrency
 * without adding another service; swapping this for Redis later only means
 * replacing this function.
 */
export async function rateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  // Occasionally clear out expired windows so the table stays small.
  if (Math.random() < 0.02) {
    void db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now - 24 * 60 * 60 * 1000)))
      .catch(() => {});
  }

  const count = row?.count ?? 1;
  return {
    ok: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: Math.ceil((windowStart.getTime() + windowMs - now) / 1000),
  };
}

/** Limits for the public, unauthenticated endpoints. */
export const LIMITS = {
  /**
   * New interviews from one IP on one campaign. Generous on purpose: mobile
   * carriers put many real people behind one address.
   */
  sessionStartPerIp: { limit: 60, windowSeconds: 60 * 60 },
  // Voice calls are the costly part, so they have their own ceilings: per
  // campaign, per merchant and across the whole app. Past a ceiling the
  // participant is offered the typed interview instead of an error.
  voicePerCampaign: { limit: 1500, windowSeconds: 24 * 60 * 60 },
  voicePerMerchant: { limit: 2000, windowSeconds: 24 * 60 * 60 },
  voiceTotal: { limit: 5000, windowSeconds: 24 * 60 * 60 },
  chatPerSession: { limit: 40, windowSeconds: 10 * 60 },
  turnsPerSession: { limit: 200, windowSeconds: 10 * 60 },
  completePerSession: { limit: 10, windowSeconds: 60 * 60 },
  // Not tighter than the start limit: many real people can share one
  // address (a mobile carrier, a campus), and each already needed a start.
  completePerIp: { limit: 120, windowSeconds: 60 * 60 },
  authPerIp: { limit: 20, windowSeconds: 10 * 60 },
} satisfies Record<string, RateLimitRule>;
