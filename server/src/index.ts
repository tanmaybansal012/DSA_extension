/**
 * index.ts — Server Entry Point
 *
 * Starts the Express server and initializes external services (Redis).
 * Postgres connection is handled lazily by Prisma on first query.
 */
import app from "./app.js";
import { config } from "./config.js";
import { initCache } from "./services/cache.js";

async function main() {
  // Initialize Redis cache (degrades gracefully if unavailable)
  await initCache();

  app.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║   DSA Hint Assistant Server                  ║
║   Running on http://localhost:${config.port} ║
║                                              ║
║   Endpoints:                                 ║
║     POST /api/hint     — Generate hints      ║
║     POST /api/similar  — Find similar        ║
║     GET  /api/history  — Hint history        ║
║     GET  /api/health   — Health check        ║
╚══════════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
