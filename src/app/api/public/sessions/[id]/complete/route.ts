import { and, eq, sql } from "drizzle-orm";
import { NextResponse, after } from "next/server";
import { db } from "@/db";
import { participants, rewards, sessions, transcriptTurns, type Campaign, type Reward } from "@/db/schema";
import { analyzeSession } from "@/lib/analysis/analyze-session";
import { refreshCampaignInsightsIfStale } from "@/lib/analysis/synthesize-campaign";
import { env } from "@/lib/env";
import { ApiError, readJson, route, tooManyRequests } from "@/lib/http";
import { loadBrief } from "@/lib/interview/service";
import { authenticateSession } from "@/lib/public-session";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getClientIp, hashIp } from "@/lib/request";
import { deliverPendingRewardEmails, deliverRewardEmail } from "@/lib/reward-email";
import { issueReward } from "@/lib/rewards";
import { completeSchema } from "@/lib/validation";

// Analysis and the reward email run after the response has been sent.
export const maxDuration = 60;

/**
 * What the participant's screen gets. When the email already holds a reward
 * on this campaign from an earlier visit, the code itself is withheld: it was
 * sent to that inbox, and returning it here would let anyone who knows an
 * email address read that person's code.
 */
function rewardResponse(campaign: Campaign, reward: Reward | undefined, alreadyClaimed: boolean) {
  return NextResponse.json({
    code: alreadyClaimed ? null : (reward?.code ?? null),
    rewardHeadline: campaign.rewardHeadline,
    instructions: campaign.rewardInstructions,
    alreadyClaimed,
    // Whether a copy is being emailed, so the screen only promises one when it is.
    emailQueued: !alreadyClaimed && env.resendApiKey !== "",
  });
}

/**
 * Finishes an interview: records the participant's email, issues their reward
 * and returns the code. Safe to call more than once; a repeat call returns the
 * same result without recording anything new.
 */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/public/sessions/[id]/complete">) => {
  const started = Date.now();
  const { id } = await ctx.params;
  const session = await authenticateSession(request, id);

  const perSession = await rateLimit(`complete:${session.id}`, LIMITS.completePerSession);
  if (!perSession.ok) throw tooManyRequests(perSession.retryAfterSeconds);
  const perIp = await rateLimit(
    `complete-ip:${hashIp(getClientIp(request.headers)) ?? "unknown"}`,
    LIMITS.completePerIp,
  );
  if (!perIp.ok) throw tooManyRequests(perIp.retryAfterSeconds);

  const { email } = completeSchema.parse(await readJson(request));
  const { campaign } = await loadBrief(session);

  // Already finished (a double tap or a retry): answer with what was decided
  // the first time, whatever email this request carries.
  if (session.status === "completed") {
    const [reward] = await db.select().from(rewards).where(eq(rewards.sessionId, session.id)).limit(1);
    return rewardResponse(campaign, reward, session.isDuplicate);
  }

  // A reward is for feedback: there has to be at least one answer.
  const [{ answered }] = await db
    .select({ answered: sql<number>`count(*)::int` })
    .from(transcriptTurns)
    .where(and(eq(transcriptTurns.sessionId, session.id), eq(transcriptTurns.role, "user")));
  if (answered === 0) {
    throw new ApiError(409, "no_answers", "Answer at least one question to unlock your reward.");
  }

  const [participant] = await db
    .insert(participants)
    .values({ email })
    // A no-op update so the existing row is returned on conflict.
    .onConflictDoUpdate({ target: participants.email, set: { email } })
    .returning();

  const { reward, alreadyClaimed } = await issueReward({
    campaign,
    sessionId: session.id,
    participantId: participant!.id,
  });

  const now = new Date();
  await db
    .update(sessions)
    .set({
      participantId: participant!.id,
      status: "completed",
      completedAt: now,
      durationSeconds: Math.max(1, Math.round((now.getTime() - session.startedAt.getTime()) / 1000)),
      // This person already completed the campaign in an earlier session.
      isDuplicate: alreadyClaimed,
    })
    .where(and(eq(sessions.id, session.id), eq(sessions.status, "started")));

  // Everything below runs after the response has been sent, so the
  // participant sees their code without waiting for email or AI.
  after(async () => {
    if (!alreadyClaimed) await deliverRewardEmail(reward.id);
    const analysed = await analyzeSession(session.id);
    // The campaign summary is the slowest step. It only runs here when there
    // is clearly time left in this function; otherwise the next dashboard
    // visit brings it up to date.
    if (analysed && Date.now() - started < 25_000) {
      await refreshCampaignInsightsIfStale(campaign.id);
    }
    // Pick up any earlier emails that were held back by the provider's rate limit.
    if (Date.now() - started < 40_000) await deliverPendingRewardEmails(campaign.id, 3);
  });

  return rewardResponse(campaign, reward, alreadyClaimed);
});
