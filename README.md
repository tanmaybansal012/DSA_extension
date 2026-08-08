# DSA Hint Assistant (Code Mentor AI)

DSA Hint Assistant is a Chrome Extension backed by a Node.js/Express backend. It helps competitive programmers and interview prep learners get tiered hints, discover similar problems, and classify DSA topics directly from the browser.

## What It Does

- Provides tiered DSA hints for a problem statement.
- Streams hints via Server-Sent Events (SSE) for fast, real-time responses.
- Recommends similar problems using pgvector semantic search.
- Saves hint history and bookmarks on the backend.
- Classifies problems into DSA topic tags and caches results in Redis.

## Project Structure

- `background.js` — extension background logic.
- `content.js` — scrapes problem data from the browser page.
- `popup.html` / `popup.js` — extension UI and frontend interaction.
- `manifest.json` — Chrome extension manifest.
- `server/` — backend code, database schema, and ingestion scripts.

### Backend Structure

- `server/src/app.ts` — Express setup, middleware, and routes.
- `server/src/index.ts` — server startup and Redis initialization.
- `server/src/routes/` — API routes for hints, similar problems, history, and health.
- `server/src/services/` — Gemini, embedding, classification, and caching services.
- `server/prisma/schema.prisma` — database schema for users, problems, and hints.
- `server/scripts/ingest-problems.ts` — offline ingestion of problem data and embeddings.

## Prerequisites

To run the backend locally, install:

1. Node.js 18+
2. PostgreSQL 15+ with `pgvector`
3. Redis 6+
4. A Gemini API key

## Setup

### 1. Install Backend Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment Variables

```bash
copy .env.example .env
```

Then edit `.env` and set:

- `GEMINI_API_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `GEMINI_MODEL` (optional)
- `EMBEDDING_MODEL` (optional)

### 3. Set Up the Database

```bash
npx prisma migrate dev --name init
```

If the migration fails because `vector` is missing, install the `pgvector` extension in your Postgres instance.

### 4. Ingest Problem Data

```bash
npm run ingest 
```

This script loads the curated problem dataset and generates embeddings for RAG search.

### 5. Start the Backend 

```bash
npm run dev
```

The backend starts on `http://localhost:3001` by default.

## Load the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `DSA_extension` project root.

## Architecture

The backend provides the API and data services for the extension:

- `POST /api/hint` — generates tiered hints and stores history.
- `POST /api/similar` — finds similar problems using RAG or fallback LLM.
- `GET /api/history` — returns hint history for a device.
- `GET /api/health` — basic health check.

The main server services are:

- `gemini.ts` — Gemini hint generation, streaming, and classification.
- `embedding.ts` — embedding generation and pgvector similarity search.
- `cache.ts` — Redis caching layer.
- `classifier.ts` — topic classification and caching logic.

## Notes

- The Chrome extension does not call Gemini directly from the browser.
- The backend manages API requests, LLM calls, classification, and RAG retrieval.
- Use `GEMINI_MODEL` and `EMBEDDING_MODEL` in `.env` to override defaults.
- `GEMINI_MODEL` default is `gemini-2.5-flash` and `EMBEDDING_MODEL` default is `text-embedding-3-large`.

## Important

The server README inside `server/` has been removed; this root README contains the full backend setup and architecture documentation for the project.