import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, type Session } from "@/db/schema";
import { ApiError } from "@/lib/http";

/**
 * Participants have no account. When an interview starts the browser is given
 * a random bearer token; only its hash is stored. Every later call for that
 * interview must present the token, so one participant cannot read or write
 * another's session by guessing ids.
 */
export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function authenticateSession(request: Request, sessionId: string): Promise<Session> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  // The same error for every failure, so the response reveals nothing about
  // which session ids exist.
  const denied = new ApiError(401, "invalid_session", "This session has expired. Please reload the page.");
  if (!token || !UUID.test(sessionId)) throw denied;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) throw denied;

  const expected = Buffer.from(session.tokenHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw denied;
  return session;
}
