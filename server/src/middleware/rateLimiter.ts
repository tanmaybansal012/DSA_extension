/**
 * rateLimiter.ts — Per-Client Rate Limiting
 *
 * Uses express-rate-limit keyed by the X-Device-Id header that the Chrome
 * extension generates and sends with every request. This provides per-device
 * throttling without requiring authentication.
 *
 * Default: 30 requests per minute per device — generous enough for normal
 * use but prevents abuse if the extension is distributed.
 */
import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // 30 requests per window per device
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,

  // Key by the anonymous device ID sent from the extension.
  // Falls back to IP if header is missing (e.g. testing via curl).
  keyGenerator: (req) => {
    return (req.headers["x-device-id"] as string) || req.ip || "anonymous";
  },

  // Return a clean JSON error on rate limit hit
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too many requests. Please wait a moment and try again.",
      status: 429,
    });
  },
});
