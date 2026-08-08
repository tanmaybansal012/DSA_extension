/**
 * health.ts — Health Check Route
 *
 * GET /api/health — returns server status, timestamp, and version.
 * The extension's Settings tab pings this to show connection status.
 */
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    services: {
      server: "running",
    },
  });
});

export default router;
