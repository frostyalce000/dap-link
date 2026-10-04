/**
 * Drizzle wraps database errors and puts the SQL and its parameters in the
 * message, so the underlying Postgres error is read from `cause` instead.
 */
type PgError = { code?: string; constraint_name?: string };

function pgCause(err: unknown): PgError | undefined {
  if (!(err instanceof Error)) return undefined;
  const cause = (err as { cause?: unknown }).cause;
  return cause && typeof cause === "object" ? (cause as PgError) : undefined;
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = pgCause(err);
  return cause?.code === "23505" && cause.constraint_name === constraint;
}

/**
 * A short, log-safe description of an error: its name plus any database or
 * HTTP status code. Never the message, which for a failed query contains the
 * parameters, and those can be participant emails or answers.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const cause = pgCause(err);
  const status = (err as { status?: unknown }).status;
  return [err.name, cause?.code && `pg ${cause.code}`, cause?.constraint_name, typeof status === "number" && `status ${status}`]
    .filter(Boolean)
    .join(" ");
}
