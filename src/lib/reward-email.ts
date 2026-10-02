import "server-only";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, merchants, participants, rewards } from "@/db/schema";
import { sendRewardEmail } from "@/lib/email";

export const MAX_EMAIL_ATTEMPTS = 5;
/** A send that was claimed this long ago and never finished is assumed dead. */
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Emails one reward code, at most once.
 *
 * The conditional update is the claim: of any number of concurrent callers,
 * only one gets the row back and sends. A send that fails for a temporary
 * reason (the email provider's rate limit, a network error) leaves the reward
 * "pending" so a later pass can try again; a permanent failure (an address the
 * provider rejects) is marked "failed" and left alone.
 */
export async function deliverRewardEmail(rewardId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const [claimed] = await db
    .update(rewards)
    .set({ emailAttempts: sql`${rewards.emailAttempts} + 1`, emailAttemptedAt: new Date() })
    .where(
      and(
        eq(rewards.id, rewardId),
        eq(rewards.emailStatus, "pending"),
        lt(rewards.emailAttempts, MAX_EMAIL_ATTEMPTS),
        or(isNull(rewards.emailAttemptedAt), lt(rewards.emailAttemptedAt, staleBefore)),
      ),
    )
    .returning({ attempts: rewards.emailAttempts });
  if (!claimed) return;

  const [details] = await db
    .select({
      code: rewards.code,
      email: participants.email,
      productName: campaigns.productName,
      rewardHeadline: campaigns.rewardHeadline,
      instructions: campaigns.rewardInstructions,
      brandName: merchants.brandName,
    })
    .from(rewards)
    .innerJoin(participants, eq(participants.id, rewards.participantId))
    .innerJoin(campaigns, eq(campaigns.id, rewards.campaignId))
    .innerJoin(merchants, eq(merchants.id, campaigns.merchantId))
    .where(eq(rewards.id, rewardId))
    .limit(1);
  if (!details) return;

  const result = await sendRewardEmail({
    to: details.email,
    brandName: details.brandName,
    productName: details.productName,
    rewardHeadline: details.rewardHeadline,
    code: details.code,
    instructions: details.instructions,
  });

  const outOfAttempts = claimed.attempts >= MAX_EMAIL_ATTEMPTS;
  const status =
    result.status === "retry" ? (outOfAttempts ? "failed" : "pending") : result.status;
  await db.update(rewards).set({ emailStatus: status }).where(eq(rewards.id, rewardId));
}

/**
 * Retries reward emails for a campaign that are still waiting, oldest first.
 * Sent one after another on purpose, to stay under the provider's rate limit.
 * Called after each completed interview and when the merchant opens the
 * dashboard, so a burst that outran the rate limit drains on its own.
 */
export async function deliverPendingRewardEmails(campaignId: string, max = 5): Promise<void> {
  const retryBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const pending = await db
    .select({ id: rewards.id })
    .from(rewards)
    .where(
      and(
        eq(rewards.campaignId, campaignId),
        eq(rewards.emailStatus, "pending"),
        lt(rewards.emailAttempts, MAX_EMAIL_ATTEMPTS),
        // Either the last attempt was a while ago, or it was never attempted
        // because the invocation that issued it died first.
        or(
          lt(rewards.emailAttemptedAt, retryBefore),
          and(isNull(rewards.emailAttemptedAt), lt(rewards.issuedAt, retryBefore)),
        ),
      ),
    )
    .orderBy(asc(rewards.issuedAt))
    .limit(max);

  for (const reward of pending) await deliverRewardEmail(reward.id);
}
