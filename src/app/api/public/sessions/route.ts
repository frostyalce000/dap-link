import { NextResponse } from "next/server";
import { db } from "@/db";
import { consents, sessions } from "@/db/schema";
import { getPublishedCampaignBySlug } from "@/lib/campaigns";
import { ApiError, readJson, route, tooManyRequests } from "@/lib/http";
import { buildChatOpening, type InterviewBrief } from "@/lib/interview/edna";
import { saveTurns } from "@/lib/interview/service";
import { createVoiceSecret } from "@/lib/interview/voice";
import { createSessionToken } from "@/lib/public-session";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getApproximateGeo, getClientIp, getDeviceType, hashIp } from "@/lib/request";
import { startSessionSchema } from "@/lib/validation";

/**
 * Starts an interview. Called when the participant taps the start button,
 * which is also the moment they give consent, so the consent record is written
 * in the same transaction as the session it belongs to.
 */
export const POST = route(async (request: Request) => {
  const input = startSessionSchema.parse(await readJson(request));

  const found = await getPublishedCampaignBySlug(input.slug);
  if (!found) throw new ApiError(404, "campaign_not_found", "This link is no longer available.");
  const { campaign, brandName, questions } = found;

  const ipHash = hashIp(getClientIp(request.headers));
  const perIp = await rateLimit(`start:${campaign.id}:${ipHash ?? "unknown"}`, LIMITS.sessionStartPerIp);
  if (!perIp.ok) throw tooManyRequests(perIp.retryAfterSeconds);

  const brief: InterviewBrief = {
    brandName,
    productName: campaign.productName,
    productDescription: campaign.productDescription,
    rewardHeadline: campaign.rewardHeadline,
    questions: questions.map((q) => q.text),
  };

  // Voice calls carry the real cost, so they have daily ceilings per
  // campaign, per merchant and overall. Past one, the participant is offered
  // the typed interview instead of being turned away.
  let voiceAllowed = input.mode === "voice";
  if (voiceAllowed) {
    const ceilings = await Promise.all([
      rateLimit(`voice:campaign:${campaign.id}`, LIMITS.voicePerCampaign),
      rateLimit(`voice:merchant:${campaign.merchantId}`, LIMITS.voicePerMerchant),
      rateLimit("voice:all", LIMITS.voiceTotal),
    ]);
    voiceAllowed = ceilings.every((c) => c.ok);
  }

  // For a voice interview the realtime secret is requested now, while the
  // session is being written, so the call can connect one round trip sooner.
  const voicePromise = voiceAllowed ? createVoiceSecret(brief) : null;

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  // Location is only recorded when the participant left that option on.
  const geo = input.consent.approximateLocation
    ? getApproximateGeo(request.headers)
    : { country: null, region: null, city: null };
  const { token, tokenHash } = createSessionToken();

  const session = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(sessions)
      .values({
        campaignId: campaign.id,
        tokenHash,
        mode: input.mode,
        source: input.source?.slice(0, 80) || null,
        referrer: input.referrer?.slice(0, 300) || null,
        userAgent,
        deviceType: getDeviceType(userAgent),
        ipHash,
        geoCountry: geo.country,
        geoRegion: geo.region,
        geoCity: geo.city,
      })
      .returning();
    await tx.insert(consents).values({
      sessionId: created!.id,
      version: input.consent.version,
      responses: true,
      aiAnalysis: true,
      approximateLocation: input.consent.approximateLocation,
      microphone: input.mode === "voice",
      audioRecording: false,
    });
    return created!;
  });

  // The typed interview opens with a templated first message so there is no
  // wait for a model reply before the participant can start.
  let opening: { clientTurnId: string; text: string } | null = null;
  if (input.mode === "text") {
    opening = { clientTurnId: "opening", text: buildChatOpening(brief) };
    await saveTurns(session.id, [{ ...opening, seq: 0, role: "assistant" }]);
  }

  // Null when voice could not be set up; the browser then switches to typing.
  const voice = await voicePromise;

  return NextResponse.json({ sessionId: session.id, token, opening, voice }, { status: 201 });
});
