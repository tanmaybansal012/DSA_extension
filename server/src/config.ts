/**
 * config.ts — Environment Configuration
 *
 * Loads environment variables from .env and exports a typed config object.
 * Validates that all required variables are present at startup to fail fast
 * rather than crashing later when a missing key is first used.
 */
import "dotenv/config";

interface Config {
  port: number;
  geminiApiKey: string;
  geminiModel: string;
  embeddingModel: string;
  databaseUrl: string;
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
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-large",
  databaseUrl: requireEnv("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
};
