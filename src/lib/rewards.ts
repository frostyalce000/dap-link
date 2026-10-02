import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { rewards, type Campaign, type Reward } from "@/db/schema";

/**
 * Where a discount code comes from. The MVP ships two sources; a Shopify (or
 * other commerce platform) source would implement the same interface by
 * creating a real price rule and returning its code.
 */
export interface RewardSource {
  kind: Reward["kind"];
  nextCode(campaign: Campaign): Promise<string>;
}

// No 0/O, 1/I/L: codes get read aloud and typed by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCode(prefix: string, length = 6): string {
  let suffix = "";
  for (let i = 0; i < length; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${prefix}-${suffix}`;
}

const generatedSource: RewardSource = {
  kind: "generated",
  nextCode: async (campaign) => generateCode(campaign.rewardCodePrefix || "DAP"),
};

const staticSource: RewardSource = {
  kind: "static",
  nextCode: async (campaign) => campaign.rewardStaticCode ?? "",
};

export function getRewardSource(campaign: Campaign): RewardSource {
  return campaign.rewardKind === "static" && campaign.rewardStaticCode
    ? staticSource
    : generatedSource;
}

export type IssuedReward = { reward: Reward; alreadyClaimed: boolean };

/**
 * Gives a participant their reward for a campaign, exactly once.
 *
 * The unique indexes on (campaign, participant) and on session are what make
 * this safe: a double tap, a retry after a dropped connection, or the same
 * person coming back with the same email all end up with the one original
 * code rather than a second one.
 */
export async function issueReward(params: {
  campaign: Campaign;
  sessionId: string;
  participantId: string;
}): Promise<IssuedReward> {
  const { campaign, sessionId, participantId } = params;
  const source = getRewardSource(campaign);

  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await findReward(campaign.id, participantId, sessionId);
    if (existing) return { reward: existing, alreadyClaimed: existing.sessionId !== sessionId };

    const code = await source.nextCode(campaign);
    const [inserted] = await db
      .insert(rewards)
      .values({ campaignId: campaign.id, sessionId, participantId, kind: source.kind, code })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { reward: inserted, alreadyClaimed: false };
    // Nothing inserted: either a concurrent request won (found on the next
    // loop) or the generated code collided (a new one is drawn).
  }
  throw new Error("Could not issue a reward");
}

/** The reward already tied to this session, or to this person on this campaign. */
async function findReward(
  campaignId: string,
  participantId: string,
  sessionId: string,
): Promise<Reward | undefined> {
  const [row] = await db
    .select()
    .from(rewards)
    .where(
      or(
        eq(rewards.sessionId, sessionId),
        and(eq(rewards.campaignId, campaignId), eq(rewards.participantId, participantId)),
      ),
    )
    .orderBy(rewards.issuedAt)
    .limit(1);
  return row;
}
