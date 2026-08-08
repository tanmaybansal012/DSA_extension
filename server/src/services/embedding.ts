/**
 * embedding.ts — Embedding Generation & Vector Search Service
 *
 * Handles two core RAG operations (Phase 2):
 * 1. Generating embeddings via Gemini model configuration
 * 2. Running cosine-similarity nearest-neighbor queries against pgvector
 *
 * The embedding model produces fixed-length vectors stored in Postgres via
 * the pgvector extension, keeping the stack simple without a separate vector DB.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import { PrismaClient } from "@prisma/client";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const embeddingModel = genAI.getGenerativeModel({
  model: config.embeddingModel,
});

const prisma = new PrismaClient();

/**
 * Generate a 768-dim embedding vector for the given text.
 * Used both during ingestion (offline) and at query time (online).
 */
export async function embedText(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
}

/**
 * Find the top N most similar problems using pgvector's cosine distance.
 *
 * Uses raw SQL because Prisma doesn't natively support pgvector operators.
 * The `<=>` operator computes cosine distance (1 - cosine_similarity),
 * so we ORDER BY it ascending to get the most similar first.
 *
 * We exclude the source problem itself if it exists in the DB (by title match)
 * to avoid returning the exact same problem as "similar".
 */
export async function findSimilarProblems(
  queryEmbedding: number[],
  excludeTitle: string,
  limit: number = 3
): Promise<
  Array<{
    id: string;
    title: string;
    difficulty: string | null;
    topicTags: string[];
    url: string | null;
    description: string | null;
    similarity: number;
  }>
> {
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  const results = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      title: string;
      difficulty: string | null;
      topic_tags: string[];
      url: string | null;
      description: string | null;
      similarity: number;
    }>
  >(
    `
    SELECT
      id,
      title,
      difficulty,
      "topicTags" as topic_tags,
      url,
      description,
      1 - (embedding <=> $1::vector) as similarity
    FROM "Problem"
    WHERE embedding IS NOT NULL
      AND title != $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3
    `,
    vectorStr,
    excludeTitle,
    limit
  );

  return results.map((r) => ({
    id: r.id,
    title: r.title,
    difficulty: r.difficulty,
    topicTags: r.topic_tags,
    url: r.url,
    description: r.description,
    similarity: r.similarity,
  }));
}

/**
 * Find foundational problems for a specific concept.
 * Prefers problems with <= 2 tags to ensure they are "pure" teaching examples.
 * Falls back to any problem with the tag if no pure examples are found.
 */
export async function findFoundationalProblemsForConcept(
  concept: string,
  excludeUrl: string | undefined,
  limit: number = 3
): Promise<
  Array<{
    id: string;
    title: string;
    difficulty: string | null;
    topicTags: string[];
    url: string | null;
    description: string | null;
  }>
> {
  const safeExcludeUrl = excludeUrl || "";
  
  // Try finding problems with <= 2 tags
  const strictResults = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT
      id, title, difficulty, "topicTags" as topic_tags, url, description
    FROM "Problem"
    WHERE $1 = ANY("topicTags")
      AND array_length("topicTags", 1) <= 2
      AND (url != $2 OR url IS NULL)
    ORDER BY 
      CASE difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Hard' THEN 3 ELSE 4 END,
      id
    LIMIT $3
    `,
    concept,
    safeExcludeUrl,
    limit
  );

  let results = strictResults;

  if (results.length === 0) {
    // Fallback: any problem with the concept
    results = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        id, title, difficulty, "topicTags" as topic_tags, url, description
      FROM "Problem"
      WHERE $1 = ANY("topicTags")
        AND (url != $2 OR url IS NULL)
      ORDER BY 
        CASE difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Hard' THEN 3 ELSE 4 END,
        id
      LIMIT $3
      `,
      concept,
      safeExcludeUrl,
      limit
    );
  }

  return results.map((r) => ({
    id: r.id,
    title: r.title,
    difficulty: r.difficulty,
    topicTags: r.topic_tags,
    url: r.url,
    description: r.description,
  }));
}
