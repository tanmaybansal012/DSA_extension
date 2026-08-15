/**
 * classifier.ts — Topic Classification Service
 *
 * Orchestrates topic classification for problems:
 * 1. Check Redis cache first
 * 2. Call Gemini for structured JSON classification
 * 3. Cache the result in Redis (7-day TTL)
 *
 * No database dependency — works standalone.
 */
import { classifyTopic } from "./gemini.js";
import type { ProblemContext } from "./gemini.js";
import { cacheGet, cacheSet, hashKey, CACHE_TTL } from "./cache.js";

/**
 * Get topic tags for a problem. Uses a 2-tier lookup:
 * 1. Redis cache (fastest)
 * 2. Gemini API call (triggers cache write)
 */
export async function getTopicsForProblem(
  problem: ProblemContext,
  _problemId?: string
): Promise<string[]> {
  const cacheKey = `topics:${hashKey(problem.description)}`;

  // Tier 1: Check Redis cache
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Corrupted cache — fall through
    }
  }

  // Tier 2: Call Gemini to classify
  console.log(`[CLASSIFIER] Classifying topics for: ${problem.title}`);
  const result = await classifyTopic(problem);
  const topics = result.topics;

  // Cache the result
  if (topics.length > 0) {
    await cacheSet(cacheKey, JSON.stringify(topics), CACHE_TTL.TOPICS);
  }

  return topics;
}
