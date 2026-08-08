/**
 * errorHandler.ts — Global Error-Handling Middleware
 *
 * Catches all unhandled errors from route handlers and returns clean
 * JSON error responses. Never leaks stack traces or internal details
 * to the client — those are logged server-side only.
 */
import { Request, Response, NextFunction } from "express";

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
  if (!(err instanceof AppError)) {
    console.error(err.stack);
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
