/**
 * hint.ts — Hint Generation Route
 *
 * POST /api/hint — Generates a tiered DSA hint (3 levels).
 *
 * Flow:
 * 1. Validate request body
 * 2. Check Redis cache — return cached if hit
 * 3. Stream or return full hint via Gemini
 * 4. Cache the result
 *
 * No database dependency — works without Postgres.
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { generateHint, generateHintStream } from "../services/gemini.js";
import { cacheGet, cacheSet, hashKey, CACHE_TTL } from "../services/cache.js";
import { QuotaExceededError, ModelUnavailableError, getRequestCount } from "../services/aiGuard.js";

const router = Router();

/** Zod schema for POST /api/hint request body */
const hintSchema = z.object({
  problem: z.object({
    title: z.string().min(1, "Problem title is required"),
    description: z.string().min(1, "Problem description is required"),
    examples: z.string().optional().default(""),
    url: z.string().optional(),
    platform: z.string().optional().default("leetcode"),
  }),
  code: z.string().optional(),
  level: z.number().int().min(1).max(3),
  previousHints: z.array(z.string()).optional().default([]),
  stream: z.boolean().optional().default(false),
});

type HintRequest = z.infer<typeof hintSchema>;

/**
 * POST /api/hint — Main hint generation endpoint.
 */
router.post(
  "/",
  validate(hintSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as HintRequest;
      const useStream = body.stream;

      // ── Check cache ──
      const cacheKey = `hint:${hashKey(body.problem.description, String(body.level))}`;
      const cached = await cacheGet(cacheKey);

      if (cached && !useStream) {
        res.json({ hint: cached, level: body.level, cached: true, requestCount: getRequestCount() });
        return;
      }

      // Previous hints are sent from the client
      const previousHints = body.previousHints || [];

      // ── SSE Streaming ──
      if (useStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        let fullText = "";

        try {
          if (cached) {
            // Instantly stream the cached hint
            res.write(`data: ${JSON.stringify({ token: cached })}\n\n`);
            res.write(`data: ${JSON.stringify({ done: true, requestCount: getRequestCount() })}\n\n`);
            res.end();
            return;
          }

          for await (const chunk of generateHintStream(body.problem, body.level, previousHints)) {
            fullText += chunk;
            res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
          }

          res.write(`data: ${JSON.stringify({ done: true, requestCount: getRequestCount() })}\n\n`);
          res.end();

          // Cache after stream completes (fire-and-forget)
          cacheSet(cacheKey, fullText, CACHE_TTL.HINT).catch(() => {});
        } catch (streamErr) {
          if (streamErr instanceof QuotaExceededError) {
            res.write(`data: ${JSON.stringify({ error: "quota_exceeded", message: streamErr.message })}\n\n`);
          } else if (streamErr instanceof ModelUnavailableError) {
            res.write(`data: ${JSON.stringify({ error: "model_unavailable", message: streamErr.message })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ error: "stream_failed", message: "Hint generation failed" })}\n\n`);
          }
          res.end();
        }
        return;
      }

      // ── Normal (non-streaming) response ──
      const hintContent = await generateHint(body.problem, body.level, previousHints);

      await cacheSet(cacheKey, hintContent, CACHE_TTL.HINT);

      res.json({
        hint: hintContent,
        level: body.level,
        cached: false,
        requestCount: getRequestCount(),
      });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        res.status(429).json({ error: "quota_exceeded", message: err.message });
        return;
      }
      if (err instanceof ModelUnavailableError) {
        res.status(503).json({ error: "model_unavailable", message: err.message });
        return;
      }
      next(err);
    }
  }
);

export default router;
