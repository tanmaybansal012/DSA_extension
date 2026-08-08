/**
 * classifier.ts — Topic Classification Service (Phase 5)
 *
 * Orchestrates topic classification for problems:
 * 1. Check Redis cache first (topics barely change once computed)
 * 2. If cache miss, call Gemini for structured JSON classification
 * 3. Store result on the Problem record in Postgres
 * 4. Cache the result in Redis (7-day TTL)
 *
 * The classification uses a fixed set of ~28 DSA topic labels and
 * Gemini's JSON response mode for reliable structured output.
 */
import { PrismaClient } from "@prisma/client";
import { classifyTopics as geminiClassify } from "./gemini.js";
import {
  cacheGet,
  cacheSet,
  hashKey,
  CACHE_TTL,
} from "./cache.js";

const prisma = new PrismaClient();

interface ProblemContext {
  title: string;
  description: string;
  examples?: string;
}

/**
 * Get topic tags for a problem. Uses a 3-tier lookup:
 * 1. Redis cache (fastest)
 * 2. Postgres problem record (if already classified)
 * 3. Gemini API call (slowest, triggers cache write)
 */
export async function getTopicsForProblem(
  problem: ProblemContext,
  problemId?: string
): Promise<string[]> {
  const cacheKey = `topics:${hashKey(problem.description)}`;

  // Tier 1: Check Redis cache
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Tier 2: Check if the problem already has topics in the DB
  if (problemId) {
    const dbProblem = await prisma.problem.findUnique({
      where: { id: problemId },
      select: { topicTags: true },
    });
    if (dbProblem?.topicTags && dbProblem.topicTags.length > 0) {
      // Cache the DB result so next lookup is faster
      await cacheSet(cacheKey, JSON.stringify(dbProblem.topicTags), CACHE_TTL.TOPICS);
      return dbProblem.topicTags;
    }
  }

  // Tier 3: Call Gemini to classify
  console.log(`[CLASSIFIER] Classifying topics for: ${problem.title}`);
  const topics = await geminiClassify(problem);

  // Persist to DB if we have a problem ID
  if (problemId && topics.length > 0) {
    await prisma.problem.update({
      where: { id: problemId },
      data: { topicTags: topics },
    });
  }

  // Cache the result
  if (topics.length > 0) {
    await cacheSet(cacheKey, JSON.stringify(topics), CACHE_TTL.TOPICS);
  }

  return topics;
}

/**
 * Decompose a problem into 2-4 foundational concept tags.
 * Wraps getTopicsForProblem but specifically designed for RAG query analysis.
 * Uses caching but does not touch Postgres since no problemId is passed.
 */
export async function decomposeIntoConcepts(
  problem: ProblemContext
): Promise<string[]> {
  try {
    const concepts = await getTopicsForProblem(problem);
    return concepts;
  } catch (err) {
    console.error("[CLASSIFIER] Failed to decompose concepts:", (err as Error).message);
    return [];
  }
}
