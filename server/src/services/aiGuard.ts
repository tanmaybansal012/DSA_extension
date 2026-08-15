/**
 * aiGuard.ts — Centralized Gemini API Error Handling (Task 4)
 *
 * Provides:
 * - QuotaExceededError / ModelUnavailableError typed errors
 * - withQuotaGuard() wrapper with exponential backoff retry
 * - In-memory daily request counter
 *
 * Every Gemini call in the codebase must go through withQuotaGuard().
 */

/** Thrown when all retry attempts for a 429 are exhausted */
export class QuotaExceededError extends Error {
  constructor(message = "Daily AI quota exceeded. Try again later or check your API key's quota in Google AI Studio.") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/** Thrown on 404 — model string is stale/decommissioned */
export class ModelUnavailableError extends Error {
  constructor(model: string) {
    super(`Model "${model}" is no longer available. Update GEMINI_MODEL in your .env file.`);
    this.name = "ModelUnavailableError";
  }
}

// ── In-memory daily request counter ──
let dailyCount = 0;
let counterResetDate = new Date().toDateString();

export function getRequestCount(): number {
  maybeResetCounter();
  return dailyCount;
}

export function incrementRequestCount(): void {
  maybeResetCounter();
  dailyCount++;
}

function maybeResetCounter(): void {
  const today = new Date().toDateString();
  if (today !== counterResetDate) {
    dailyCount = 0;
    counterResetDate = today;
  }
}

// ── Retry wrapper ──

interface QuotaGuardOptions {
  retries?: number;
}

/**
 * Wraps any async function (typically a Gemini SDK call) with:
 * - 429 detection → exponential backoff (1s, 3s, 8s)
 * - 404 detection → immediate ModelUnavailableError
 * - Network/timeout errors → up to 2 retries
 * - Request counting
 */
export async function withQuotaGuard<T>(
  fn: () => Promise<T>,
  opts?: QuotaGuardOptions
): Promise<T> {
  const maxRetries = opts?.retries ?? 3;
  const backoffs = [1000, 3000, 8000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      incrementRequestCount();
      return await fn();
    } catch (err: any) {
      const status = extractStatus(err);
      const message = extractMessage(err);

      // 404 — model not found. Never retry.
      if (status === 404 || message.includes("not found") || message.includes("no longer available")) {
        const modelMatch = message.match(/models\/([^\s"']+)/);
        throw new ModelUnavailableError(modelMatch?.[1] || "unknown");
      }

      // 429 — quota / rate limit
      if (status === 429 || message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
        if (attempt < maxRetries) {
          const retryAfterMs = extractRetryAfter(err) || backoffs[attempt] || 8000;
          console.warn(`[AI_GUARD] 429 — retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await sleep(retryAfterMs);
          continue;
        }
        throw new QuotaExceededError();
      }

      // Network / timeout / other transient errors — retry up to 2 times
      if (attempt < Math.min(maxRetries, 2)) {
        console.warn(`[AI_GUARD] Transient error — retrying (attempt ${attempt + 1}): ${message}`);
        await sleep(backoffs[attempt] || 1000);
        continue;
      }

      // Non-retryable or retries exhausted — rethrow original
      throw err;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("[AI_GUARD] Unexpected: all retries exhausted without throwing");
}

// ── Helpers ──

function extractStatus(err: any): number | undefined {
  return err?.status ?? err?.statusCode ?? err?.response?.status ?? err?.code;
}

function extractMessage(err: any): string {
  if (typeof err?.message === "string") return err.message;
  if (typeof err?.error?.message === "string") return err.error.message;
  return String(err);
}

function extractRetryAfter(err: any): number | undefined {
  const header = err?.response?.headers?.["retry-after"] ?? err?.headers?.["retry-after"];
  if (header) {
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
