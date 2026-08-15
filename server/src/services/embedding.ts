/**
 * embedding.ts — Embedding Generation Service (Simplified)
 *
 * Uses @google/genai for embedding generation.
 * No database dependency — embeddings are used for in-memory comparison only.
 */
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { withQuotaGuard } from "./aiGuard.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const EMBEDDING_MODEL = config.embeddingModel;

/**
 * Generate an embedding vector for the given text.
 */
export async function embedText(text: string): Promise<number[]> {
  return withQuotaGuard(async () => {
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });

    if (response.embeddings && response.embeddings.length > 0) {
      return response.embeddings[0].values || [];
    }
    throw new Error("No embedding returned from API");
  });
}
