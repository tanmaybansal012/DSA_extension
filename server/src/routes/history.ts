/**
 * history.ts — Hint History Route (Phase 4)
 *
 * GET  /api/history?deviceId=...       — returns past hints for a device
 * PATCH /api/history/:id/bookmark      — toggles bookmark on a hint
 * GET  /api/topics?deviceId=...&problemTitle=... — returns topics for a problem
 *
 * History items include the full problem context (title, platform, url)
 * alongside the hint content, level, and timestamp. This powers the
 * "📜 History" tab in the popup UI.
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { getTopicsForProblem } from "../services/classifier.js";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/history?deviceId=...&limit=...&offset=...
 * Returns paginated hint history for a device, most recent first.
 */
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deviceId =
        (req.query.deviceId as string) ||
        (req.headers["x-device-id"] as string);

      if (!deviceId) {
        res.status(400).json({
          error: "deviceId query parameter or X-Device-Id header is required",
          status: 400,
        });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      // Find the user by device ID
      const user = await prisma.user.findUnique({
        where: { deviceId },
      });

      if (!user) {
        res.json({ history: [], total: 0 });
        return;
      }

      // Fetch hints with related problem data
      const [hints, total] = await Promise.all([
        prisma.hint.findMany({
          where: { userId: user.id },
          include: {
            problem: {
              select: {
                id: true,
                title: true,
                platform: true,
                url: true,
                difficulty: true,
                topicTags: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.hint.count({ where: { userId: user.id } }),
      ]);

      const history = hints.map((h) => ({
        id: h.id,
        level: h.level,
        content: h.content,
        bookmarked: h.bookmarked,
        createdAt: h.createdAt.toISOString(),
        problem: h.problem,
      }));

      res.json({ history, total });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/history/:id/bookmark
 * Toggles the bookmark status of a hint.
 */
router.patch(
  "/:id/bookmark",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);

      const hint = await prisma.hint.findUnique({ where: { id } });
      if (!hint) {
        res.status(404).json({ error: "Hint not found", status: 404 });
        return;
      }

      const updated = await prisma.hint.update({
        where: { id },
        data: { bookmarked: !hint.bookmarked },
      });

      res.json({
        id: updated.id,
        bookmarked: updated.bookmarked,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/topics?title=...&description=...
 * Returns topic tags for a problem (triggers classification if needed).
 */
router.get(
  "/topics",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const title = req.query.title as string;
      const description = req.query.description as string;

      if (!title || !description) {
        res.status(400).json({
          error: "title and description query parameters are required",
          status: 400,
        });
        return;
      }

      // Check if problem exists in DB
      const problem = await prisma.problem.findFirst({
        where: { title },
      });

      const topics = await getTopicsForProblem(
        { title, description },
        problem?.id
      );

      res.json({ topics });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
