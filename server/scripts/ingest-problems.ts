/**
 * ingest-problems.ts — Offline Problem Ingestion Script
 *
 * Reads the curated problems JSON dataset, generates embeddings via
 * the @google/genai SDK, and stores them in Postgres/pgvector.
 *
 * Usage:   npm run ingest
 * Requires: DATABASE_URL set in .env, Postgres with pgvector extension
 *
 * This is OPTIONAL — the app works without it using tag-match fallback.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-004";

interface ProblemData {
  leetcodeId: number;
  title: string;
  description?: string;
  difficulty: string;
  topicTags: string[];
  url: string;
}

async function embedText(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  if (response.embeddings && response.embeddings.length > 0) {
    return response.embeddings[0].values || [];
  }
  throw new Error("No embedding returned");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  📥 DSA Problem Ingestion Pipeline");
  console.log("═══════════════════════════════════════════\n");

  console.log("[1/4] Ensuring pgvector extension...");
  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector;");
  console.log("  ✓ pgvector extension ready\n");

  console.log("[2/4] Loading problem dataset...");
  const dataPath = join(__dirname, "..", "data", "leetcode-problems.json");
  const rawData = readFileSync(dataPath, "utf-8");
  const problems: ProblemData[] = JSON.parse(rawData);
  console.log(`  ✓ Loaded ${problems.length} problems\n`);

  console.log("[3/4] Generating embeddings and inserting...");
  const BATCH_SIZE = 5;
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < problems.length; i += BATCH_SIZE) {
    const batch = problems.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (p) => {
        try {
          const textToEmbed = `${p.title}. ${p.description || ""}`;
          const embedding = await embedText(textToEmbed);
          const vectorStr = `[${embedding.join(",")}]`;

          await prisma.$executeRawUnsafe(
            `
            INSERT INTO problems (id, platform, title, url, description, difficulty, "topicTags", "createdAt", embedding)
            VALUES (gen_random_uuid(), 'leetcode', $1, $2, $3, $4, $5, NOW(), $6::vector)
            ON CONFLICT (url)
            DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              difficulty = EXCLUDED.difficulty,
              "topicTags" = EXCLUDED."topicTags",
              embedding = EXCLUDED.embedding
            `,
            p.title,
            p.url,
            (p.description || "").slice(0, 3000),
            p.difficulty,
            p.topicTags,
            vectorStr
          );
          processed++;
        } catch (err) {
          errors++;
          console.error(`  ✗ Failed: ${p.title} — ${(err as Error).message}`);
        }
      })
    );

    const progress = Math.round(((i + batch.length) / problems.length) * 100);
    process.stdout.write(`\r  Progress: ${progress}% (${processed} inserted, ${errors} errors)`);

    if (i + BATCH_SIZE < problems.length) {
      await sleep(1500);
    }
  }

  console.log(`\n\n  ✓ Ingestion complete: ${processed} problems, ${errors} errors\n`);

  console.log("[4/4] Creating vector index...");
  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_problems_embedding
      ON problems USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 20);
    `);
    console.log("  ✓ IVFFlat index created\n");
  } catch {
    console.warn("  ⚠ Index creation skipped\n");
  }

  console.log("  ✅ Ingestion complete!");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
