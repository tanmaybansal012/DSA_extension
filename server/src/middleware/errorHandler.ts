/**
 * errorHandler.ts — Global Error-Handling Middleware
 *
 * Catches all unhandled errors from route handlers and returns clean
 * JSON error responses. Handles QuotaExceededError and ModelUnavailableError
 * with appropriate HTTP status codes.
 */
import { Request, Response, NextFunction } from "express";
import { QuotaExceededError, ModelUnavailableError } from "../services/aiGuard.js";

/** Custom error class with HTTP status code */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the full error server-side for debugging
  console.error(`[ERROR] ${err.name}: ${err.message}`);
  if (!(err instanceof AppError) && !(err instanceof QuotaExceededError) && !(err instanceof ModelUnavailableError)) {
    console.error(err.stack);
  }

  // QuotaExceededError → 429
  if (err instanceof QuotaExceededError) {
    res.status(429).json({
      error: "quota_exceeded",
      message: err.message,
    });
    return;
  }

  // ModelUnavailableError → 503
  if (err instanceof ModelUnavailableError) {
    res.status(503).json({
      error: "model_unavailable",
      message: err.message,
    });
    return;
  }

  // Determine status code
  const statusCode = err instanceof AppError ? err.statusCode : 500;

  // Send a sanitized response — never expose stack traces
  const message =
    statusCode === 500
      ? "Internal server error"
      : err.message || "Something went wrong";

  res.status(statusCode).json({
    error: message,
    status: statusCode,
  });
}
