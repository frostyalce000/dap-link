import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One connection pool per server instance, reused across hot reloads in dev.
 *
 * `prepare: false` is required by Supabase's transaction pooler, which is what
 * serverless functions should connect through so that many concurrent
 * invocations share a small number of real database connections. The client
 * connects lazily, on the first query.
 */
const globalForDb = globalThis as unknown as {
  __dapSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__dapSql ??
  postgres(process.env.DATABASE_URL ?? "", {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__dapSql = client;

export const db = drizzle(client, { schema });
export { schema };
