/**
 * history.ts — Hint History Route
 *
 * Simplified: returns empty results since we're running without a database.
 * History is tracked client-side in the extension's local storage.
 */
import { Router, Request, Response } from "express";

const router = Router();

/**
 * GET /api/history — Returns empty (no DB persistence)
 */
router.get("/", (_req: Request, res: Response): void => {
  res.json({ history: [], total: 0, message: "History is stored locally in the extension" });
});

/**
 * PATCH /api/history/:id/bookmark — No-op without DB
 */
router.patch("/:id/bookmark", (_req: Request, res: Response): void => {
  res.status(501).json({ error: "Bookmarks require database configuration" });
});

export default router;
