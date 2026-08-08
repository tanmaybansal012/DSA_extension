/**
 * similar.ts — Similar Problems Route
 *
 * POST /api/similar — Finds problems similar to the given one.
 *
 * Flow (Phase 2 RAG pipeline):
 * 1. Check Redis cache (Phase 5)
 * 2. Generate embedding for the query problem's description
 * 3. Run cosine-similarity search against pgvector
 * 4. Optionally generate "why it's similar" one-liner via Gemini
 * 5. Cache the result in Redis
 *
 * Falls back to LLM-based guessing if embeddings aren't available
 * (e.g. the ingestion script hasn't been run yet).
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { generateSimilarLLM, generateSimilarityReason } from "../services/gemini.js";
import { embedText, findSimilarProblems, findFoundationalProblemsForConcept } from "../services/embedding.js";
import { decomposeIntoConcepts } from "../services/classifier.js";
import {
  cacheGet,
  cacheSet,
  hashKey,
  CACHE_TTL,
} from "../services/cache.js";

const router = Router();

/** Zod schema for POST /api/similar */
const similarSchema = z.object({
  problem: z.object({
    title: z.string().min(1, "Problem title is required"),
    description: z.string().min(1, "Problem description is required"),
    examples: z.string().optional().default(""),
    url: z.string().optional(),
  }),
});

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
        res.json({ ...JSON.parse(cached), cached: true });
        return;
      }

      // ── Try Decomposed RAG retrieval first ──
      try {
        const concepts = await decomposeIntoConcepts(problem);
        
        if (concepts.length > 0) {
          const conceptsResult: any[] = [];
          const seenUrls = new Set<string>();
          let totalProblems = 0;

          for (const concept of concepts) {
            if (totalProblems >= 9) break;

            const conceptProblems = await findFoundationalProblemsForConcept(concept, problem.url, 3);
            const filteredProblems = conceptProblems.filter((p) => {
              if (!p.url) return true;
              if (seenUrls.has(p.url)) return false;
              seenUrls.add(p.url);
              return true;
            });

            if (filteredProblems.length > 0) {
              conceptsResult.push({
                concept,
                label: concept
                  .split("-")
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" "),
                problems: filteredProblems.slice(0, 9 - totalProblems),
              });
              totalProblems += filteredProblems.length;
            }
          }

          if (conceptsResult.length > 0) {
            const result = {
              concepts: conceptsResult,
              source: "rag-decomposed" as const,
            };

            await cacheSet(cacheKey, JSON.stringify(result), CACHE_TTL.SIMILAR);
            res.json({ ...result, cached: false });
            return;
          }
        }
        
        // ── Fallback to pgvector search if decomposition yielded 0 problems ──
        const queryEmbedding = await embedText(
          `${problem.title}. ${problem.description}`
        );
        const matches = await findSimilarProblems(
          queryEmbedding,
          problem.title,
          3
        );

        if (matches.length > 0) {
          // Generate "why it's similar" one-liners for each match
          const enrichedMatches = await Promise.all(
            matches.map(async (match) => {
              let reason = "";
              try {
                reason = await generateSimilarityReason(
                  problem,
                  match.title,
                  match.description || ""
                );
              } catch {
                reason = `Both involve ${match.topicTags.slice(0, 2).join(" and ")} techniques.`;
              }

              return {
                title: match.title,
                difficulty: match.difficulty,
                topicTags: match.topicTags,
                url: match.url,
                similarity: Math.round(match.similarity * 100),
                reason,
              };
            })
          );

          const result = {
            similar: enrichedMatches,
            source: "rag" as const,
          };

          // Cache the result
          await cacheSet(cacheKey, JSON.stringify(result), CACHE_TTL.SIMILAR);

          res.json({ ...result, cached: false });
          return;
        }
      } catch (ragErr) {
        // RAG failed (e.g. no embeddings ingested yet) — fall through to LLM
        console.warn(
          "[SIMILAR] RAG retrieval failed, falling back to LLM:",
          (ragErr as Error).message
        );
      }

      // ── Fallback: LLM-based guessing ──
      const llmResult = await generateSimilarLLM(problem);
      const result = {
        similar: llmResult,
        source: "llm" as const,
      };

      await cacheSet(cacheKey, JSON.stringify(result), CACHE_TTL.SIMILAR);

      res.json({ ...result, cached: false });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
