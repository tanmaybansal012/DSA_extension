# Code Mentor AI — DSA Hint Assistant

A Chrome Extension that provides AI-powered progressive hints for LeetCode and Codeforces problems. Uses a local Node.js backend powered by Google's Gemini 2.5 Flash.

## Features

- **3-Level Progressive Hints**: Nudge → Approach → Near-solution, each building on the previous
- **Similar Problem Discovery**: Finds related problems from a curated dataset using AI topic classification
- **Real-time Streaming**: Hints stream in via Server-Sent Events as they're generated
- **Smart Caching**: Redis caching (optional) to avoid duplicate API calls
- **Dark/Light Theme**: Toggle between themes in the extension popup

## Quick Start

### 1. Backend Setup

```bash
cd server
npm install
```

### 2. Configure API Key

```bash
copy .env.example .env
```

Edit `.env` and set your Gemini API key:
```
GEMINI_API_KEY=your_key_here
```

Get a key at [Google AI Studio](https://aistudio.google.com/apikey).

> **Note**: Postgres and Redis are **optional**. The app works fully without them — hints, similar problems, and topic classification all work standalone.

### 3. Start the Backend

```bash
npm run dev
```

The server starts on `http://localhost:3001`.

### 4. Load the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `DSA_extension` project root folder

### 5. Use It

1. Navigate to any LeetCode or Codeforces problem
2. Click the extension icon
3. Click **Get Hint** for a Level 1 nudge
4. Click **Level 2** / **Level 3** for progressively detailed hints
5. Click **Similar** to find related practice problems

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | ✅ Yes | — | Google AI Studio API key |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model for hints & classification |
| `EMBEDDING_MODEL` | No | `text-embedding-004` | Model for embeddings (only used by ingestion script) |
| `DATABASE_URL` | No | — | Postgres URL (enables hint history persistence) |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis URL (enables response caching) |
| `PORT` | No | `3001` | Server port |

## Architecture

```
Chrome Extension (popup.js)
    │
    ├── GET  /api/health   → Health check
    ├── POST /api/hint     → Stream/generate hints (SSE)
    ├── POST /api/similar  → Find similar problems
    └── GET  /api/history  → Hint history
    │
Backend (Node.js / Express / TypeScript)
    │
    ├── services/gemini.ts    → @google/genai SDK wrapper
    ├── services/aiGuard.ts   → Retry/quota error handling
    ├── services/cache.ts     → Redis caching (optional)
    ├── services/classifier.ts → Topic classification
    └── data/leetcode-problems.json → Curated problem dataset
```

## SDK

This project uses the **official `@google/genai` SDK** (not the deprecated `@google/generative-ai` package).

## Project Structure

```
DSA_extension/
├── manifest.json          # Chrome extension manifest v3
├── popup.html/css/js      # Extension UI
├── content.js             # Problem scraper (LeetCode, Codeforces)
├── background.js          # Service worker
└── server/
    ├── src/
    │   ├── app.ts         # Express setup
    │   ├── index.ts       # Server entry point
    │   ├── config.ts      # Environment config
    │   ├── routes/        # API route handlers
    │   ├── services/      # Gemini, caching, classification
    │   └── middleware/     # Validation, rate limiting, errors
    ├── data/              # Problem dataset
    └── scripts/           # Ingestion script (optional)
```