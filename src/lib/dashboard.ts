import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaignInsights,
  campaigns,
  participants,
  rewards,
  sessionInsights,
  sessions,
} from "@/db/schema";
import type { StoredCampaignInsights } from "@/lib/analysis/synthesize-campaign";
import { formatLocation } from "@/lib/format";

/** "A response" everywhere on the dashboard: completed, and not a repeat by the same person. */
const isResponse = and(eq(sessions.status, "completed"), eq(sessions.isDuplicate, false));

export type Distribution<K extends string> = Record<K, number>;

export type CampaignOverview = {
  started: number;
  responses: number;
  completionRate: number | null;
  averageDurationSeconds: number | null;
  analysed: number;
  awaitingAnalysis: number;
  sentiment: Distribution<"positive" | "mixed" | "neutral" | "negative">;
  purchaseIntent: Distribution<"high" | "medium" | "low" | "unclear">;
  priceSensitivity: Distribution<"high" | "medium" | "low" | "unclear">;
  price: { count: number; median: number; low: number; high: number; currency: string | null } | null;
  locations: { label: string; count: number }[];
  locationsKnown: number;
  sources: { label: string; count: number }[];
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function getCampaignOverview(campaignId: string): Promise<CampaignOverview> {
  const [totalsRows, insightRows, locationRows, sourceRows] = await Promise.all([
    db
      .select({
        started: count(),
        completed: sql<number>`count(*) filter (where ${sessions.status} = 'completed')::int`,
        responses: sql<number>`count(*) filter (where ${sessions.status} = 'completed' and not ${sessions.isDuplicate})::int`,
        averageDuration: sql<number | null>`avg(${sessions.durationSeconds}) filter (where ${sessions.status} = 'completed' and not ${sessions.isDuplicate})::float`,
      })
      .from(sessions)
      .where(eq(sessions.campaignId, campaignId)),
    db
      .select({
        sentiment: sessionInsights.sentiment,
        purchaseIntent: sessionInsights.purchaseIntent,
        priceSensitivity: sessionInsights.priceSensitivity,
        willingnessToPay: sessionInsights.willingnessToPay,
        currency: sessionInsights.willingnessToPayCurrency,
      })
      .from(sessionInsights)
      .where(eq(sessionInsights.campaignId, campaignId)),
    db
      .select({ country: sessions.geoCountry, city: sessions.geoCity, total: count() })
      .from(sessions)
      .where(and(eq(sessions.campaignId, campaignId), isResponse))
      .groupBy(sessions.geoCountry, sessions.geoCity)
      .orderBy(desc(count())),
    db
      .select({ source: sessions.source, total: count() })
      .from(sessions)
      .where(and(eq(sessions.campaignId, campaignId), isResponse))
      .groupBy(sessions.source)
      .orderBy(desc(count())),
  ]);

  const totals = totalsRows[0]!;
  const sentiment = { positive: 0, mixed: 0, neutral: 0, negative: 0 };
  const purchaseIntent = { high: 0, medium: 0, low: 0, unclear: 0 };
  const priceSensitivity = { high: 0, medium: 0, low: 0, unclear: 0 };
  for (const row of insightRows) {
    if (row.sentiment in sentiment) sentiment[row.sentiment as keyof typeof sentiment]++;
    if (row.purchaseIntent in purchaseIntent) purchaseIntent[row.purchaseIntent as keyof typeof purchaseIntent]++;
    if (row.priceSensitivity in priceSensitivity) priceSensitivity[row.priceSensitivity as keyof typeof priceSensitivity]++;
  }

  // Prices are only comparable within one currency, so the summary uses the
  // most common one and ignores the rest.
  const priced = insightRows.filter((row) => row.willingnessToPay !== null);
  const currency = mostCommon(priced.map((row) => row.currency));
  const amounts = priced.filter((row) => row.currency === currency).map((row) => Number(row.willingnessToPay));
  const price =
    amounts.length > 0
      ? {
          count: amounts.length,
          median: median(amounts),
          low: Math.min(...amounts),
          high: Math.max(...amounts),
          currency,
        }
      : null;

  const known = locationRows.filter((row) => row.country);
  return {
    started: totals.started,
    responses: totals.responses,
    completionRate: totals.started > 0 ? totals.completed / totals.started : null,
    averageDurationSeconds: totals.averageDuration,
    analysed: insightRows.length,
    awaitingAnalysis: Math.max(0, totals.responses - insightRows.length),
    sentiment,
    purchaseIntent,
    priceSensitivity,
    price,
    locations: known.slice(0, 6).map((row) => ({
      label: formatLocation(row.city, row.country) ?? "",
      count: row.total,
    })),
    locationsKnown: known.reduce((sum, row) => sum + row.total, 0),
    sources: sourceRows
      .filter((row) => row.source)
      .slice(0, 5)
      .map((row) => ({ label: row.source!, count: row.total })),
  };
}

export async function getCampaignInsights(campaignId: string) {
  const [row] = await db
    .select()
    .from(campaignInsights)
    .where(eq(campaignInsights.campaignId, campaignId))
    .limit(1);
  if (!row) return null;
  return {
    data: row.data as StoredCampaignInsights,
    sessionsIncluded: row.sessionsIncluded,
    generatedAt: row.generatedAt,
  };
}

export async function listResponses(campaignId: string, limit: number) {
  return db
    .select({
      id: sessions.id,
      completedAt: sessions.completedAt,
      mode: sessions.mode,
      durationSeconds: sessions.durationSeconds,
      geoCity: sessions.geoCity,
      geoCountry: sessions.geoCountry,
      analysisStatus: sessions.analysisStatus,
      analysisAttempts: sessions.analysisAttempts,
      email: participants.email,
      sentiment: sessionInsights.sentiment,
      purchaseIntent: sessionInsights.purchaseIntent,
      priceSensitivity: sessionInsights.priceSensitivity,
      willingnessToPay: sessionInsights.willingnessToPay,
      currency: sessionInsights.willingnessToPayCurrency,
      summary: sessionInsights.summary,
    })
    .from(sessions)
    .leftJoin(participants, eq(participants.id, sessions.participantId))
    .leftJoin(sessionInsights, eq(sessionInsights.sessionId, sessions.id))
    .where(and(eq(sessions.campaignId, campaignId), isResponse))
    .orderBy(desc(sessions.completedAt))
    .limit(limit);
}

/** One response with everything shown on its detail page. Scoped to the campaign. */
export async function getResponse(campaignId: string, sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const [row] = await db
    .select({
      session: sessions,
      email: participants.email,
      insight: sessionInsights,
      rewardCode: rewards.code,
      rewardEmailStatus: rewards.emailStatus,
    })
    .from(sessions)
    .leftJoin(participants, eq(participants.id, sessions.participantId))
    .leftJoin(sessionInsights, eq(sessionInsights.sessionId, sessions.id))
    .leftJoin(rewards, eq(rewards.sessionId, sessions.id))
    .where(and(eq(sessions.id, sessionId), eq(sessions.campaignId, campaignId)))
    .limit(1);
  return row ?? null;
}

export async function listCampaigns(merchantId: string) {
  return db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      status: campaigns.status,
      productName: campaigns.productName,
      productImageUrl: campaigns.productImageUrl,
      rewardHeadline: campaigns.rewardHeadline,
      createdAt: campaigns.createdAt,
      responses: sql<number>`(
        select count(*)::int from ${sessions}
        where ${sessions.campaignId} = ${campaigns.id}
          and ${sessions.status} = 'completed' and not ${sessions.isDuplicate}
      )`,
    })
    .from(campaigns)
    .where(eq(campaigns.merchantId, merchantId))
    .orderBy(desc(campaigns.createdAt));
}
