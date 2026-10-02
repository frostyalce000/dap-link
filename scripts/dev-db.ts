/**
 * Local development database.
 *
 * Runs an embedded Postgres (PGlite) and exposes it on a normal Postgres port,
 * so the app can be developed without a Supabase project or Docker. Data is
 * kept in ./.pglite between runs.
 *
 *   npm run db:dev
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.DEV_DB_PORT ?? 5433);

async function main() {
  const db = await PGlite.create("./.pglite");
  // PGlite is single-connection; the server multiplexes clients over it. The
  // app opens a small pool, so more than one must be allowed.
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 });
  await server.start();
  console.log(`Local Postgres ready on postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
