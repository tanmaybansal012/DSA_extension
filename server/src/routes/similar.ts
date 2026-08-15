/**
 * similar.ts — Similar Problems Route
 *
 * POST /api/similar — Finds problems similar to the given one.
 *
 * Flow:
 * 1. Check Redis cache
 * 2. Classify problem topics via Gemini
 * 3. Score problems.json entries by tag overlap (always works, no DB needed)
 * 4. Return top 5 similar problems
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { classifyTopic } from "../services/gemini.js";
import { cacheGet, cacheSet, hashKey, CACHE_TTL } from "../services/cache.js";
import { QuotaExceededError, ModelUnavailableError } from "../services/aiGuard.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Load problems.json at startup ──
interface ProblemEntry {
  title: string;
  difficulty: string;
  topicTags: string[];
  url: string;
  source?: string;
}

let problemsDataset: ProblemEntry[] = [];
try {
  // __dirname is server/src/routes when running with tsx
  const dataPath = join(__dirname, "..", "..", "data", "leetcode-problems.json");
  const raw = readFileSync(dataPath, "utf-8");
  problemsDataset = JSON.parse(raw);
  console.log(`[SIMILAR] Loaded ${problemsDataset.length} problems for tag-match scoring`);
} catch (err) {
  console.warn("[SIMILAR] Could not load problems.json:", (err as Error).message);
}

/** Zod schema */
const similarSchema = z.object({
  problem: z.object({
    title: z.string().min(1, "Problem title is required"),
    description: z.string().min(1, "Problem description is required"),
    examples: z.string().optional().default(""),
    url: z.string().optional(),
    platform: z.string().optional().default("leetcode"),
  }),
});

/**
 * Score problems by overlapping topic tags + difficulty tiebreaker.
 * Pure in-memory — no database.
 */
function scoreFallbackProblems(
  topics: string[],
  difficulty: string,
  excludeTitle: string,
  limit: number = 5
): ProblemEntry[] {
  if (problemsDataset.length === 0 || topics.length === 0) return [];

  const topicSet = new Set(topics);

  return problemsDataset
    .filter((p) => p.title.toLowerCase() !== excludeTitle.toLowerCase())
    .map((p) => ({
      ...p,
      score: p.topicTags.filter((t) => topicSet.has(t)).length + (p.difficulty === difficulty ? 0.5 : 0),
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

router.post(
  "/",
  validate(similarSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { problem } = req.body;

      // ── Check cache ──
      const cacheKey = `similar:${hashKey(problem.description)}`;
      const cached = await cacheGet(cacheKey);
      if (cached) {
        try {
          res.json({ ...JSON.parse(cached), cached: true });
          return;
        } catch { /* corrupted cache */ }
      }

      // ── Classify topics via Gemini ──
      const classification = await classifyTopic(problem);
      const { topics, difficulty } = classification;

      // ── Score problems.json by tag overlap ──
      const results = scoreFallbackProblems(topics, difficulty, problem.title, 5);

      const responseData = {
        problems: results.map((p) => ({
          title: p.title,
          url: p.url,
          difficulty: p.difficulty,
          source: p.source || "leetcode",
          topicTags: p.topicTags,
        })),
        classification: { topics, difficulty, confidence: classification.confidence },
        source: "tag-match",
      };

      await cacheSet(cacheKey, JSON.stringify(responseData), CACHE_TTL.SIMILAR);
      res.json({ ...responseData, cached: false });
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
