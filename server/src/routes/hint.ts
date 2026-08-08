/**
 * hint.ts — Hint Generation Route
 *
 * POST /api/hint — Generates a tiered DSA hint for a given problem.
 *
 * Flow (all phases combined):
 * 1. Validate request body with Zod
 * 2. Check Redis cache (Phase 5) — if hit, return instantly
 * 3. Check if SSE streaming is requested (Phase 3)
 *    - If streaming: pipe tokens via Server-Sent Events
 *    - If not: return full response as JSON
 * 4. Persist the hint to Postgres (Phase 4)
 * 5. Trigger topic classification for the problem (Phase 5)
 * 6. Cache the result in Redis (Phase 5)
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import {
  generateHint,
  generateHintStream,
} from "../services/gemini.js";
import {
  cacheGet,
  cacheSet,
  hashKey,
  CACHE_TTL,
} from "../services/cache.js";
import { getTopicsForProblem } from "../services/classifier.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
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
  level: z.number().int().min(1).max(4),
  deviceId: z.string().optional(),
  stream: z.boolean().optional().default(false),
});

type HintRequest = z.infer<typeof hintSchema>;

/**
 * Upsert a user by device ID and a problem by title+platform.
 * Returns both IDs for linking the hint record.
 */
async function ensureUserAndProblem(
  deviceId: string | undefined,
  problem: HintRequest["problem"]
) {
  // Upsert user (anonymous device-based identity)
  let userId: string | null = null;
  if (deviceId) {
    const user = await prisma.user.upsert({
      where: { deviceId },
      create: { deviceId },
      update: {},
    });
    userId = user.id;
  }

  // Upsert problem by title + platform
  const existingProblem = await prisma.problem.findFirst({
    where: {
      title: problem.title,
      platform: problem.platform,
    },
  });

  let problemId: string;
  if (existingProblem) {
    problemId = existingProblem.id;
  } else {
    const created = await prisma.problem.create({
      data: {
        title: problem.title,
        platform: problem.platform || "leetcode",
        url: problem.url || null,
        description: problem.description.slice(0, 3000),
        difficulty: null,
        topicTags: [],
      },
    });
    problemId = created.id;
  }

  return { userId, problemId };
}

/**
 * POST /api/hint — Main hint generation endpoint.
 */
router.post(
  "/",
  validate(hintSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as HintRequest;
      const deviceId =
        body.deviceId || (req.headers["x-device-id"] as string) || undefined;
      const useStream = body.stream;

      // ── Phase 5: Check cache ──
      const cacheKey = `hint:${hashKey(body.problem.description, String(body.level))}`;
      const cached = await cacheGet(cacheKey);

      if (cached && !useStream) {
        // Cache hit — return instantly
        // Still persist to DB for history tracking
        const { userId, problemId } = await ensureUserAndProblem(
          deviceId,
          body.problem
        );
        if (userId) {
          await prisma.hint.create({
            data: {
              userId,
              problemId,
              level: body.level,
              content: cached,
            },
          });
        }

        // Fire-and-forget topic classification
        getTopicsForProblem(body.problem, problemId).catch((e) =>
          console.error("[HINT] Topic classification error:", e.message)
        );

        res.json({
          hint: cached,
          level: body.level,
          cached: true,
        });
        return;
      }

      // ── Phase 3: SSE Streaming ──
      if (useStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no", // Disable nginx buffering if proxied
        });

        let fullResponse = "";

        try {
          for await (const chunk of generateHintStream(
            body.problem,
            body.code,
            body.level
          )) {
            fullResponse += chunk;
            res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
          }

          // Signal completion
          res.write(`data: [DONE]\n\n`);
          res.end();

          // Persist after stream completes (fire-and-forget)
          (async () => {
            try {
              const { userId, problemId } = await ensureUserAndProblem(
                deviceId,
                body.problem
              );
              if (userId) {
                await prisma.hint.create({
                  data: {
                    userId,
                    problemId,
                    level: body.level,
                    content: fullResponse,
                  },
                });
              }
              // Cache the full response
              await cacheSet(cacheKey, fullResponse, CACHE_TTL.HINT);
              // Topic classification
              getTopicsForProblem(body.problem, problemId).catch(() => {});
            } catch (e) {
              console.error("[HINT] Post-stream persistence error:", e);
            }
          })();
        } catch (streamErr) {
          // Stream error — send error event and close
          res.write(
            `data: ${JSON.stringify({ error: "Stream generation failed" })}\n\n`
          );
          res.end();
        }
        return;
      }

      // ── Normal (non-streaming) response ──
      const hint = await generateHint(body.problem, body.code, body.level);

      // Persist to DB (Phase 4)
      const { userId, problemId } = await ensureUserAndProblem(
        deviceId,
        body.problem
      );
      if (userId) {
        await prisma.hint.create({
          data: {
            userId,
            problemId,
            level: body.level,
            content: hint,
          },
        });
      }

      // Cache the response (Phase 5)
      await cacheSet(cacheKey, hint, CACHE_TTL.HINT);

      // Fire-and-forget topic classification (Phase 5)
      getTopicsForProblem(body.problem, problemId).catch((e) =>
        console.error("[HINT] Topic classification error:", e.message)
      );

      res.json({
        hint,
        level: body.level,
        cached: false,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
