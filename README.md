# PaperSearch

A custom search engine for academic research papers, built from scratch in TypeScript/Node.js — no Elasticsearch, no search libraries.

This project implements every layer of the search stack manually: a BM25 inverted index stored in PostgreSQL, a query parser supporting Boolean operators (`AND`, `OR`, `-exclusion`, `"phrase matching"`), field-scoped search (`title:transformer`), and typo tolerance via Levenshtein edit distance against the vocabulary. The goal was to understand how search actually works at the data structure level, not to wrap an existing tool.

## Tech Stack

- TypeScript / Node.js
- Express 5
- PostgreSQL (inverted index, documents, index stats)
- Drizzle ORM
- Redis (rate limiting)
- Semantic Scholar Graph API (paper ingestion)
- pnpm workspaces (monorepo)
- Railway (deployment)

## How It Works

Papers are fetched from the Semantic Scholar API and stored in a `documents` table. Each document is preprocessed — tokenized, stopwords removed, terms stemmed with Porter stemmer — and the resulting tokens are written to a `terms` table (vocabulary with IDF scores) and a `postings` table (per-term per-document entries with TF and token positions). At query time, the API parses the raw query string, looks up posting lists for each token, scores candidate documents using BM25 with per-field boosts (title weighted higher than abstract), and returns ranked results. If a query token has no matches, Levenshtein distance is used to suggest the closest term in the vocabulary.

## Running Locally

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, REDIS_URL, SEMANTIC_SCHOLAR_API_KEY

# 3. Apply database schema
pnpm --filter @workspace/db push

# 4. Start the API server
pnpm --filter @workspace/api-server dev

# 5. Run the ingestion + indexing pipeline
pnpm --filter @workspace/scripts run ingest -- --limit 50

# 6. Try a search
curl "http://localhost:3000/api/search?q=neural+network"
```

## Project Structure

```
artifacts/   Deployable applications — Express API server and React frontend
lib/         Shared packages — database schema, OpenAPI spec, generated API client
scripts/     CLI tools — paper ingestion pipeline and index repair utilities
```

---

Live demo: [Railway URL — coming soon]
