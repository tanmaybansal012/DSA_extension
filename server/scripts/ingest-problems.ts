/**
 * ingest-problems.ts — Offline Problem Ingestion Script
 *
 * Reads the hand-curated LeetCode problems JSON dataset, generates
 * embeddings via the configured Gemini embedding model, and stores both
 * the metadata and embeddings in Postgres (pgvector).
 *
 * Usage:   npm run ingest
 * Command: npx tsx scripts/ingest-problems.ts
 *
 * This is a one-time operation (or re-run when the dataset is updated).
 * It processes problems in batches with delays to respect API rate limits.
 *
 * Design notes:
 * - Uses upsert to be idempotent (safe to re-run)
 * - Batches of 5 to stay well within Gemini's embedding rate limits
 * - 1.5s delay between batches to avoid 429s
 * - Progress logging for visibility during the ~2 min ingestion
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const embeddingModel = genAI.getGenerativeModel({
  model: process.env.EMBEDDING_MODEL || "text-embedding-3-large",
});

interface ProblemData {
  leetcodeId: number;
  title: string;
  description: string;
  difficulty: string;
  topicTags: string[];
  url: string;
}

async function embedText(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  📥 DSA Problem Ingestion Pipeline");
  console.log("═══════════════════════════════════════════\n");

  // ── Step 1: Ensure pgvector extension exists ──
  console.log("[1/4] Ensuring pgvector extension...");
  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector;");
  console.log("  ✓ pgvector extension ready\n");

  // ── Step 2: Load dataset ──
  console.log("[2/4] Loading problem dataset...");
  const dataPath = join(__dirname, "..", "data", "leetcode-problems.json");
  const rawData = readFileSync(dataPath, "utf-8");
  const problems: ProblemData[] = JSON.parse(rawData);
  console.log(`  ✓ Loaded ${problems.length} problems\n`);

  // ── Step 3: Generate embeddings & upsert ──
  console.log("[3/4] Generating embeddings and inserting into database...");
  console.log("  (Processing in batches of 5 with 1.5s delays)\n");

  const BATCH_SIZE = 5;
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < problems.length; i += BATCH_SIZE) {
    const batch = problems.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (p) => {
        try {
          // Combine title + description for a richer embedding
          const textToEmbed = `${p.title}. ${p.description}`;
          const embedding = await embedText(textToEmbed);
          const vectorStr = `[${embedding.join(",")}]`;

          // Upsert by URL (unique constraint)
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
            p.description.slice(0, 3000),
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
    process.stdout.write(
      `\r  Progress: ${progress}% (${processed} inserted, ${errors} errors)`
    );

    // Rate limit delay between batches
    if (i + BATCH_SIZE < problems.length) {
      await sleep(1500);
    }
  }

  console.log(`\n\n  ✓ Ingestion complete: ${processed} problems, ${errors} errors\n`);

  // ── Step 4: Create vector index ──
  console.log("[4/4] Creating vector similarity index...");
  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_problems_embedding
      ON problems USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 20);
    `);
    console.log("  ✓ IVFFlat index created\n");
  } catch (indexErr) {
    // IVFFlat requires at least lists*10 rows; if not enough data, use hnsw or skip
    console.warn("  ⚠ IVFFlat index failed (may need more data). Trying HNSW...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_problems_embedding_hnsw
        ON problems USING hnsw (embedding vector_cosine_ops);
      `);
      console.log("  ✓ HNSW index created\n");
    } catch {
      console.warn("  ⚠ Index creation skipped — queries will use sequential scan.\n");
    }
  }

  console.log("═══════════════════════════════════════════");
  console.log("  ✅ Ingestion pipeline complete!");
  console.log(`  ${processed} problems with embeddings in pgvector`);
  console.log("═══════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
