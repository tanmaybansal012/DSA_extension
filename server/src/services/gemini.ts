/**
 * gemini.ts — Gemini API Client Service (Rewritten for @google/genai)
 *
 * Uses the official Google GenAI SDK: `@google/genai`
 * All calls go through withQuotaGuard() for centralized error handling.
 *
 * Exports:
 * - generateHint()       — returns a single hint string
 * - generateHintStream() — async generator for SSE streaming
 * - classifyTopic()      — returns structured JSON classification
 */
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { withQuotaGuard } from "./aiGuard.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const MODEL = config.geminiModel;

// ── Topic labels (shared with classifier + similar route) ──
export const TOPIC_LABELS = [
  "array", "string", "two-pointer", "sliding-window", "binary-search",
  "dynamic-programming", "greedy", "backtracking", "recursion", "graphs",
  "trees", "linked-list", "stack", "queue", "heap", "hash-table",
  "sorting", "math", "bit-manipulation", "union-find", "trie",
  "divide-and-conquer", "design", "simulation", "prefix-sum",
  "monotonic-stack", "binary-indexed-tree", "segment-tree",
] as const;

export interface ProblemContext {
  title: string;
  description: string;
  examples?: string;
  platform?: string;
}

interface ClassificationResult {
  topics: string[];
  difficulty: "Easy" | "Medium" | "Hard";
  confidence: number;
}

// ── System instructions ──

const HINT_SYSTEM_INSTRUCTION = "You are an expert Data Structures and Algorithms mentor.\n" +
  "You provide hints for coding problems, guiding the user to the answer without giving away the exact code initially.\n" +
  "Format your response as standard Markdown. For mathematical notations, time complexities, or variables with exponents/subscripts, use standard HTML tags `<sup>` (e.g. `O(N<sup>2</sup>)`) and `<sub>` (e.g. `nums<sub>i</sub>`). DO NOT use LaTeX `$..$` or `^` or `_` symbols for math rendering.\n" +
  "Keep hints concise and directly actionable.\n\n" +
  "STRICT RULES:\n" +
  "- At Level 1 (Nudge): Point at the relevant concept/pattern ONLY. No approach, no algorithm name, no code, no pseudocode. Example: \"Think about what data structure gives O(1) lookups here.\"\n" +
  "- At Level 2 (Approach): Describe the algorithmic approach and WHY it works. Still NO code, NO pseudocode, NO step-by-step implementation.\n" +
  "- At Level 3 (Near-solution): Outline the algorithm step-by-step at pseudocode level. Still NOT a full working code solution.\n" +
  "- NEVER reveal full working code at any level.\n" +
  "- Each level MUST build on previous hints — do NOT repeat information.\n" +
  "- Use markdown formatting (bold, code spans, lists) for readability.";

const CLASSIFIER_SYSTEM_INSTRUCTION = `You are a DSA topic classifier. Given a coding problem, identify which topics/techniques are needed to solve it.

You MUST choose from ONLY these labels: ${TOPIC_LABELS.join(", ")}

Return a JSON object with this exact schema:
{
  "topics": ["tag1", "tag2"],
  "difficulty": "Easy" | "Medium" | "Hard",
  "confidence": 0.0 to 1.0
}

Rules:
- topics: 1-4 labels from the allowed list above. Do NOT invent new labels.
- difficulty: your assessment of the problem difficulty.
- confidence: how confident you are in the classification.
- Return ONLY valid JSON, no markdown fences, no explanation.`;

// ── Hint prompt builder ──

function buildHintPrompt(
  problem: ProblemContext,
  level: number,
  previousHints: string[]
): string {
  const previousContext = previousHints.length > 0
    ? `\n**Previous Hints Given to Student:**\n${previousHints.map((h, i) => `[Level ${i + 1}]: ${h}`).join('\n')}\n`
    : "";

  return `Problem: ${problem.title}
Platform: ${problem.platform || "leetcode"}
Description: ${problem.description}
Examples: ${problem.examples || "N/A"}
${previousContext}
Provide a Level ${level} hint. Your hint must build on any previous hints and advance the student's understanding. Do NOT repeat previous hints.`.trim();
}

// ── Exported functions ──

/**
 * Generate a single hint string for the requested level (1, 2, or 3).
 */
export async function generateHint(
  problem: ProblemContext,
  level: number,
  previousHints: string[]
): Promise<string> {
  const prompt = buildHintPrompt(problem, level, previousHints);

  return withQuotaGuard(async () => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: HINT_SYSTEM_INSTRUCTION,
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    });

    return response.text ?? "";
  });
}

/**
 * Stream a hint via async generator for SSE delivery.
 * Yields text chunks as they arrive from the model.
 */
export async function* generateHintStream(
  problem: ProblemContext,
  level: number,
  previousHints: string[]
): AsyncGenerator<string> {
  const prompt = buildHintPrompt(problem, level, previousHints);

  // withQuotaGuard wraps the initial stream creation (where auth/quota errors surface)
  const stream = await withQuotaGuard(async () => {
    return ai.models.generateContentStream({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: HINT_SYSTEM_INSTRUCTION,
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
    });
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}

/**
 * Classify a problem into DSA topics with difficulty and confidence.
 * Forces JSON output via system instruction.
 */
export async function classifyTopic(
  problem: ProblemContext
): Promise<ClassificationResult> {
  const prompt = `Problem: ${problem.title}\nDescription: ${problem.description.slice(0, 800)}`;

  const raw = await withQuotaGuard(async () => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: CLASSIFIER_SYSTEM_INSTRUCTION,
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            topics: { type: "array", items: { type: "string" } },
            difficulty: { type: "string" },
            confidence: { type: "number" }
          },
          required: ["topics", "difficulty", "confidence"]
        }
      },
    });

    return response.text ?? "";
  });

  try {
    // Extract the JSON object from the response (handles prefixes like "Here is the JSON:")
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in response");
    
    const parsed = JSON.parse(match[0]);

    return {
      topics: Array.isArray(parsed.topics)
        ? parsed.topics.filter((t: string) => TOPIC_LABELS.includes(t as any))
        : [],
      difficulty: ["Easy", "Medium", "Hard"].includes(parsed.difficulty)
        ? parsed.difficulty
        : "Medium",
      confidence: typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5,
    };
  } catch (err) {
    console.error("[GEMINI] Failed to parse classifyTopic JSON:", raw);
    return { topics: [], difficulty: "Medium", confidence: 0 };
  }
}
