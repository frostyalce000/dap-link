/** Browser-side calls to the public interview API. */

export type SessionHandle = { sessionId: string; token: string };

export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const OFFLINE_MESSAGE = "You seem to be offline. Check your connection and try again.";

async function post<T>(path: string, body: unknown, token?: string, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) return data as T;
      const error = new RequestError(
        response.status,
        data?.error?.code ?? "unknown",
        data?.error?.message ?? "Something went wrong. Please try again.",
      );
      // Only server-side failures are worth an automatic retry.
      if (response.status < 500) throw error;
      lastError = error;
    } catch (err) {
      if (err instanceof RequestError && err.status < 500) throw err;
      lastError = err;
    }
    if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  if (lastError instanceof RequestError) throw lastError;
  throw new RequestError(0, "network", OFFLINE_MESSAGE);
}

export type VoiceSecret = { clientSecret: string; model: string };

export type StartResult = SessionHandle & {
  opening: { clientTurnId: string; text: string } | null;
  /** Present for a voice interview; null if voice could not be set up. */
  voice: VoiceSecret | null;
};

export function startSession(input: {
  slug: string;
  mode: "voice" | "text";
  consent: { version: string; responses: true; aiAnalysis: true; approximateLocation: boolean };
  source: string | null;
  referrer: string | null;
}): Promise<StartResult> {
  return post("/api/public/sessions", input, undefined, 1);
}

export type Turn = { clientTurnId: string; seq: number; role: "assistant" | "user"; text: string };

export function saveTurns(s: SessionHandle, turns: Turn[]): Promise<{ saved: number }> {
  return post(`/api/public/sessions/${s.sessionId}/turns`, { turns }, s.token, 3);
}

export type ChatReply = { reply: string; questionNumber: number | null; done: boolean };

export function sendChat(
  s: SessionHandle,
  body: { clientTurnId: string; message: string } | { open: true },
): Promise<ChatReply> {
  // Safe to retry: the server recognises a repeated clientTurnId.
  return post(`/api/public/sessions/${s.sessionId}/chat`, body, s.token, 2);
}

export type RewardResult = {
  code: string;
  rewardHeadline: string;
  instructions: string;
  alreadyClaimed: boolean;
  emailQueued: boolean;
};

export function completeSession(s: SessionHandle, email: string): Promise<RewardResult> {
  // Safe to retry: completing twice returns the same code.
  return post(`/api/public/sessions/${s.sessionId}/complete`, { email }, s.token, 3);
}
