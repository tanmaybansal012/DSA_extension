/**
 * validate.ts — Zod Validation Middleware Factory
 *
 * Creates Express middleware that validates req.body against a Zod schema.
 * On validation failure, returns a 400 with structured error details showing
 * exactly which fields failed and why — useful for debugging API calls
 * from the extension during development.
 */
import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));

        res.status(400).json({
          error: "Validation failed",
          status: 400,
          details,
        });
        return;
      }
      next(err);
    }
  };
}
