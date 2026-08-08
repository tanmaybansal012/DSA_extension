/**
 * cache.ts — Redis Caching Layer (Phase 5)
 *
 * Provides a simple get/set interface backed by Redis (via ioredis).
 * Used to cache:
 *   - Hint responses: keyed by hash(problem description + level), TTL 24h
 *   - Similar problems: keyed by hash(problem description), TTL 24h
 *   - Topic classifications: keyed by hash(problem description), TTL 7 days
 *
 * Each cache operation logs hit/miss to console so cache effectiveness
 * is easy to demonstrate during development and interviews.
 */
import Redis from "ioredis";
import crypto from "crypto";
import { config } from "../config.js";

let redis: Redis | null = null;

/**
 * Initialize Redis connection. Called at server startup.
 * If Redis is unavailable, the cache layer degrades gracefully —
 * all operations become no-ops and the app works without caching.
 */
export async function initCache(): Promise<void> {
  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 200, 2000);
      },
    });

    redis.on("error", (err) => {
      console.error("[CACHE] Redis connection error:", err.message);
    });

    // Test connection
    await redis.ping();
    console.log("[CACHE] Redis connected successfully");
  } catch (err) {
    console.warn(
      "[CACHE] Redis unavailable — running without cache:",
      (err as Error).message
    );
    redis = null;
  }
}

/**
 * Create a deterministic hash key from input strings.
 * Uses SHA-256 truncated to 16 chars for brevity in Redis.
 */
export function hashKey(...parts: string[]): string {
  return crypto
    .createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Get a cached value. Returns null on cache miss or if Redis is unavailable.
 */
export async function cacheGet(key: string): Promise<string | null> {
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    if (value) {
      console.log(`[CACHE] HIT  — ${key}`);
    } else {
      console.log(`[CACHE] MISS — ${key}`);
    }
    return value;
  } catch (err) {
    console.error("[CACHE] Get error:", (err as Error).message);
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds.
 */
export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  if (!redis) return;

  try {
    await redis.setex(key, ttlSeconds, value);
    console.log(`[CACHE] SET  — ${key} (TTL: ${ttlSeconds}s)`);
  } catch (err) {
    console.error("[CACHE] Set error:", (err as Error).message);
  }
}

/** TTL presets for different cache types */
export const CACHE_TTL = {
  HINT: 24 * 60 * 60, // 24 hours
  SIMILAR: 24 * 60 * 60, // 24 hours
  TOPICS: 7 * 24 * 60 * 60, // 7 days — topics rarely change
} as const;
