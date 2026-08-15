/**
 * config.ts — Environment Configuration
 *
 * Loads environment variables from .env and exports a typed config object.
 * DATABASE_URL and REDIS_URL are optional — the app degrades gracefully
 * without them (no persistence, no caching).
 */
import "dotenv/config";

interface Config {
  port: number;
  geminiApiKey: string;
  geminiModel: string;
  embeddingModel: string;
  databaseUrl: string | undefined;
  redisUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config: Config = {
  port: parseInt(process.env.PORT || "3001", 10),
  geminiApiKey: requireEnv("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-004",
  databaseUrl: process.env.DATABASE_URL || undefined,
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
};