import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, merchants, questions, type Campaign, type Question } from "@/db/schema";

export type PublicCampaign = {
  campaign: Campaign;
  brandName: string;
  questions: Question[];
};

/** A published campaign as participants see it, or null if there is none. */
export async function getPublishedCampaignBySlug(slug: string): Promise<PublicCampaign | null> {
  const [row] = await db
    .select({ campaign: campaigns, brandName: merchants.brandName })
    .from(campaigns)
    .innerJoin(merchants, eq(merchants.id, campaigns.merchantId))
    .where(and(eq(campaigns.slug, slug.toLowerCase()), eq(campaigns.status, "published")))
    .limit(1);
  if (!row) return null;
  return { ...row, questions: await getActiveQuestions(row.campaign.id) };
}

export async function getCampaignWithBrand(campaignId: string): Promise<PublicCampaign | null> {
  const [row] = await db
    .select({ campaign: campaigns, brandName: merchants.brandName })
    .from(campaigns)
    .innerJoin(merchants, eq(merchants.id, campaigns.merchantId))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row) return null;
  return { ...row, questions: await getActiveQuestions(campaignId) };
}

export async function getActiveQuestions(campaignId: string): Promise<Question[]> {
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.campaignId, campaignId), isNull(questions.archivedAt)))
    .orderBy(asc(questions.position));
}

/**
 * A campaign only if it belongs to this merchant. Every dashboard read and
 * write goes through this, so one merchant can never load another's data by
 * changing an id in the URL.
 */
export async function getOwnedCampaign(merchantId: string, campaignId: string): Promise<Campaign | null> {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return null;
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.merchantId, merchantId)))
    .limit(1);
  return row ?? null;
}
