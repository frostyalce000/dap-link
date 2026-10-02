import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** An error that is safe to show to the caller. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function tooManyRequests(retryAfterSeconds: number): ApiError {
  return new ApiError(429, "rate_limited", "Too many requests. Please try again shortly.", {
    "Retry-After": String(retryAfterSeconds),
  });
}

/**
 * Wraps a route handler so every failure becomes a consistent JSON error.
 * Unexpected errors are logged by name only: request bodies can contain
 * participant emails and answers, which should not end up in logs.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status, headers: err.headers },
        );
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "That request wasn't valid." } },
          { status: 400 },
        );
      }
      console.error("[api] unexpected error:", err instanceof Error ? err.name : "unknown", err instanceof Error ? err.message : "");
      return NextResponse.json(
        { error: { code: "server_error", message: "Something went wrong on our side. Please try again." } },
        { status: 500 },
      );
    }
  };
}

/** Parses a JSON body, treating malformed JSON as a 400 rather than a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "That request wasn't valid.");
  }
}
