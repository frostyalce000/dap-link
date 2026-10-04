import { NextResponse } from "next/server";
import { ApiError, readJson, route, tooManyRequests } from "@/lib/http";
import { assertTranscriptRoom, saveTurns } from "@/lib/interview/service";
import { authenticateSession } from "@/lib/public-session";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { turnsSchema } from "@/lib/validation";

/**
 * Saves voice transcript turns as they are produced. The browser sends each
 * turn as soon as its transcript is final, so an interview that is dropped
 * half way still has everything said up to that point.
 */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/public/sessions/[id]/turns">) => {
  const { id } = await ctx.params;
  const session = await authenticateSession(request, id);
  if (session.status === "completed") {
    throw new ApiError(409, "already_completed", "This interview is already finished.");
  }
  // Typed interviews are written by the chat endpoint only, so a script
  // cannot invent answers for them.
  if (session.mode === "text") {
    throw new ApiError(409, "wrong_mode", "This interview is being typed.");
  }

  const limit = await rateLimit(`turns:${session.id}`, LIMITS.turnsPerSession);
  if (!limit.ok) throw tooManyRequests(limit.retryAfterSeconds);

  const { turns } = turnsSchema.parse(await readJson(request));
  await assertTranscriptRoom(session.id, turns);
  await saveTurns(session.id, turns);
  return NextResponse.json({ saved: turns.length });
});
