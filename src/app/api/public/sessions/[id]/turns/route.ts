import { NextResponse } from "next/server";
import { ApiError, readJson, route, tooManyRequests } from "@/lib/http";
import { saveTurns } from "@/lib/interview/service";
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

  const limit = await rateLimit(`turns:${session.id}`, LIMITS.turnsPerSession);
  if (!limit.ok) throw tooManyRequests(limit.retryAfterSeconds);

  const { turns } = turnsSchema.parse(await readJson(request));
  await saveTurns(session.id, turns);
  return NextResponse.json({ saved: turns.length });
});
