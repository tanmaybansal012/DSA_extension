/**
 * app.ts — Express Application Setup
 *
 * Wires together all middleware, routes, and error handling.
 * Separated from index.ts so the app can be imported for testing
 * without actually starting the server.
 */
import express from "express";
import cors from "cors";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import healthRouter from "./routes/health.js";
import hintRouter from "./routes/hint.js";
import similarRouter from "./routes/similar.js";
import historyRouter from "./routes/history.js";

const app = express();

// ── CORS ──
// Allow requests from the Chrome extension (chrome-extension:// scheme)
// and localhost for development. In production, restrict this further.
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman, extension popup)
      if (!origin) return callback(null, true);
      // Allow chrome-extension:// origins and localhost
      if (
        origin.startsWith("chrome-extension://") ||
        origin.includes("localhost")
      ) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ── Body Parsing ──
app.use(express.json({ limit: "50kb" })); // Problem descriptions can be long

// ── Rate Limiting ──
app.use("/api/", apiLimiter);

// ── Routes ──
app.use("/api/health", healthRouter);
app.use("/api/hint", hintRouter);
app.use("/api/similar", similarRouter);
app.use("/api/history", historyRouter);

// ── Error Handling ── (must be last)
app.use(errorHandler);

export default app;
