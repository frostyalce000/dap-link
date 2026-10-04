import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { transcriptTurns, type Session, type TranscriptTurn } from "@/db/schema";
import { questionsAskedAt } from "@/lib/analysis/analyze-session";
import { getCampaignWithBrand } from "@/lib/campaigns";
import { ApiError } from "@/lib/http";
import type { InterviewBrief } from "./edna";

/** The interviewer's brief for a session, using the questions live when it began. */
export async function loadBrief(session: Session) {
  const found = await getCampaignWithBrand(session.campaignId);
  if (!found) throw new ApiError(404, "campaign_not_found", "This link is no longer available.");
  const asked = await questionsAskedAt(session.campaignId, session.startedAt);
  const brief: InterviewBrief = {
    brandName: found.brandName,
    productName: found.campaign.productName,
    productDescription: found.campaign.productDescription,
    rewardHeadline: found.campaign.rewardHeadline,
    questions: asked.map((q) => q.text),
  };
  return { campaign: found.campaign, brandName: found.brandName, brief };
}

export type IncomingTurn = {
  clientTurnId: string;
  seq: number;
  role: "assistant" | "user";
  text: string;
};

/**
 * Saves transcript turns. Idempotent on the client's turn id, so the browser
 * can safely resend a batch after a network failure; a resend with newer text
 * (a transcript that finished after the first send) replaces the old text.
 */
export async function saveTurns(sessionId: string, turns: IncomingTurn[]): Promise<void> {
  if (turns.length === 0) return;
  await db
    .insert(transcriptTurns)
    .values(turns.map((t) => ({ sessionId, ...t })))
    .onConflictDoUpdate({
      target: [transcriptTurns.sessionId, transcriptTurns.clientTurnId],
      set: { text: sql`excluded.text`, seq: sql`excluded.seq` },
    });
}

/**
 * Ceilings for one interview's transcript. A one-minute interview uses a
 * small fraction of these; they exist so a scripted client cannot fill the
 * database or inflate every later AI call that reads the transcript.
 */
export const TRANSCRIPT_LIMITS = { turns: 60, characters: 20_000 };

export async function assertTranscriptRoom(sessionId: string, incoming: IncomingTurn[]): Promise<void> {
  const [usage] = await db
    .select({
      turns: sql<number>`count(*)::int`,
      characters: sql<number>`coalesce(sum(length(${transcriptTurns.text})), 0)::int`,
    })
    .from(transcriptTurns)
    .where(eq(transcriptTurns.sessionId, sessionId));
  const added = incoming.reduce((sum, t) => sum + t.text.length, 0);
  if (usage!.turns + incoming.length > TRANSCRIPT_LIMITS.turns || usage!.characters + added > TRANSCRIPT_LIMITS.characters) {
    throw new ApiError(413, "transcript_full", "This interview has reached its length limit. Finish up to get your reward.");
  }
}

export async function getTurns(sessionId: string): Promise<TranscriptTurn[]> {
  return db
    .select()
    .from(transcriptTurns)
    .where(eq(transcriptTurns.sessionId, sessionId))
    .orderBy(asc(transcriptTurns.seq), asc(transcriptTurns.createdAt));
}
