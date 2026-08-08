/**
 * gemini.ts — Gemini API Client Service
 *
 * Wraps the @google/generative-ai SDK to provide domain-specific methods:
 * - generateHint(): builds the tiered hint prompt and calls Gemini
 * - generateSimilar(): builds the similar-problems prompt (Phase 1 fallback)
 * - generateHintStream(): SSE-compatible streaming generation (Phase 3)
 * - classifyTopics(): structured JSON topic classification (Phase 5)
 *
 * The API key is loaded from server environment — never exposed to the client.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

/** The main text generation model */
const model = genAI.getGenerativeModel({
  model: config.geminiModel,
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 1024,
  },
});

interface ProblemContext {
  title: string;
  description: string;
  examples?: string;
}

/**
 * Build the hint prompt — mirrors the exact prompt structure from the
 * original popup.js to preserve hint quality and formatting.
 */
function buildHintPrompt(
  problem: ProblemContext,
  code: string | undefined,
  level: number
): string {
  return `
You are a DSA mentor. A student is solving this problem:

**Problem:** ${problem.title}
**Description:** ${problem.description}
**Examples:**
${problem.examples || "N/A"}

${code ? `**Their current code:**\n\`\`\`\n${code}\n\`\`\`` : ""}

Provide a **Level ${level}** hint (1=very subtle nudge, 2=high-level approach, 3=specific algorithm, 4=step-by-step skeleton).

Structure your response EXACTLY like this:
## 💡 Hint Level ${level}

### 🧠 Key Insight
[One sentence pointing them in the right direction without giving away the answer]

### 🗺️ Approach
[2-3 bullet points on the thinking process]

### 📊 Complexity Target
- Time: O(?)
- Space: O(?)

### 🔑 Data Structure / Algorithm
[Name the technique without giving the full solution]

${level >= 3 ? "### 🪜 Step-by-Step Skeleton\n[Pseudocode outline — no real code]" : ""}

### ⚠️ Common Pitfalls
[1-2 edge cases to watch out for]
`.trim();
}

/**
 * Generate a hint for a given problem, code attempt, and hint level.
 * Returns the full hint text.
 */
export async function generateHint(
  problem: ProblemContext,
  code: string | undefined,
  level: number
): Promise<string> {
  const prompt = buildHintPrompt(problem, code, level);
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Stream a hint using Gemini's streaming API.
 * Returns an async iterable of text chunks for SSE delivery (Phase 3).
 */
export async function* generateHintStream(
  problem: ProblemContext,
  code: string | undefined,
  level: number
): AsyncGenerator<string> {
  const prompt = buildHintPrompt(problem, code, level);
  const result = await model.generateContentStream(prompt);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield text;
    }
  }
}

/**
 * Generate similar problem suggestions using the LLM directly.
 * This is the Phase 1 fallback — Phase 2 replaces this with RAG retrieval.
 */
export async function generateSimilarLLM(
  problem: ProblemContext
): Promise<string> {
  const prompt = `
You are a competitive programming coach. A student solved this problem:

**Problem:** ${problem.title}
**Description:** ${problem.description.slice(0, 500)}

Recommend exactly 3 similar LeetCode problems to practice the same concept.
For each, provide:
- Problem number and name
- Why it's similar (one line)
- Difficulty (Easy / Medium / Hard)

Format clearly with ### for each problem.
`.trim();

  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Classify a problem into DSA topics using structured JSON output.
 * Returns an array of topic strings. Uses a single cheap Gemini call
 * with a constrained output format. Results are cached in Redis (Phase 5).
 */
export async function classifyTopics(
  problem: ProblemContext
): Promise<string[]> {
  const topicLabels = [
    "array",
    "string",
    "two-pointer",
    "sliding-window",
    "binary-search",
    "dynamic-programming",
    "greedy",
    "backtracking",
    "recursion",
    "graphs",
    "trees",
    "linked-list",
    "stack",
    "queue",
    "heap",
    "hash-table",
    "sorting",
    "math",
    "bit-manipulation",
    "union-find",
    "trie",
    "divide-and-conquer",
    "design",
    "simulation",
    "prefix-sum",
    "monotonic-stack",
    "binary-indexed-tree",
    "segment-tree",
  ];

  const prompt = `
You are a DSA topic classifier. Given a coding problem, identify which topics/techniques are needed to solve it.

**Problem:** ${problem.title}
**Description:** ${problem.description.slice(0, 800)}

Choose from ONLY these labels: ${topicLabels.join(", ")}

Return a JSON array of 1-4 matching topic labels. Return ONLY the JSON array, nothing else.
Example: ["two-pointer", "array", "sorting"]
`.trim();

  const classifierModel = genAI.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 200,
      responseMimeType: "application/json",
    },
  });

  const result = await classifierModel.generateContent(prompt);
  const text = result.response.text();

  try {
    const topics = JSON.parse(text);
    if (Array.isArray(topics)) {
      // Filter to only valid labels
      return topics.filter((t: string) => topicLabels.includes(t));
    }
  } catch {
    console.error("[CLASSIFIER] Failed to parse topic classification:", text);
  }

  return [];
}

/**
 * Generate a short "why it's similar" explanation given retrieved matches.
 * Used by the RAG pipeline (Phase 2) to add an LLM-generated one-liner
 * grounded on actual retrieved problems, not hallucinated ones.
 */
export async function generateSimilarityReason(
  sourceProblem: ProblemContext,
  matchTitle: string,
  matchDescription: string
): Promise<string> {
  const prompt = `
In one concise sentence, explain why "${matchTitle}" is similar to "${sourceProblem.title}" for DSA practice.
Context: Source problem is about: ${sourceProblem.description.slice(0, 200)}
Similar problem is about: ${matchDescription.slice(0, 200)}
Return ONLY the one-sentence explanation.
`.trim();

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
