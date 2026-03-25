# PaperSearch — Product Requirements Document

**A Custom Search Engine for Academic Research Papers, Built from Scratch**

v2.0 — Updated to reflect actual implementation

---

## 1. Project Overview

PaperSearch is a fully custom search engine backend for academic research papers — built without Elasticsearch, Solr, or any search library. Every layer of the search stack is implemented from scratch in TypeScript/Node.js: document ingestion, text preprocessing, an inverted index stored in PostgreSQL, BM25 ranking, query parsing with Boolean operators and phrase matching, and typo-tolerant search via Levenshtein edit distance.

The project is intentionally scoped to demonstrate deep understanding of how search engines actually work at the data structure level, not just how to integrate an existing tool. The code is evidence of the thinking.

---

## 2. Goals

- Build a production-grade search backend without any search library (no Elasticsearch, no Whoosh, no Solr)
- Implement BM25 ranking from scratch with correct IDF and TF normalization
- Support multi-field search, Boolean operators, phrase queries, and typo tolerance
- Build a document ingestion pipeline that fetches, preprocesses, and indexes academic papers from Semantic Scholar
- Expose a clean REST API with rate limiting and full OpenAPI documentation
- Deploy permanently on Railway connected to GitHub

---

## 3. Non-Goals

- Not trying to replace Elasticsearch or compete at web scale — the goal is demonstrating the architecture
- No ML-based semantic search (dense vector retrieval) in v1 — defined stretch goal
- No user accounts or JWT auth in v1 — the API is the deliverable

---

## 4. Resume Story

This project directly complements RefNet. RefNet visualizes citation networks across 250M+ papers — PaperSearch is the search layer that would power how researchers actually find those papers. Same domain, different layer of the stack.

**Resume bullets (fill in real numbers after deployment):**

> Built a custom search engine for academic papers from scratch in TypeScript/Node.js — inverted index, BM25 ranking, query parser with Boolean operators and phrase queries — without Elasticsearch or any search library. Indexed 1,000+ research papers from Semantic Scholar API. Deployed REST API on Railway.

---

## 5. Tech Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript / Node.js |
| Backend framework | Express 5 |
| Primary database | PostgreSQL (inverted index, documents, index stats) |
| ORM | Drizzle ORM |
| Caching / rate limiting | Redis |
| Data ingestion | Semantic Scholar Graph API (`x-api-key` auth) |
| Text processing | Custom preprocessor — tokenization, stopwords, stemming (no external NLP lib) |
| Monorepo tooling | pnpm workspaces |
| API documentation | OpenAPI spec (`lib/api-spec/openapi.yaml`) + Orval codegen |
| Dev environment | Local macOS + Neovim + tmux |
| Deployment | Railway, connected to GitHub main branch, auto-deploy on push |

---

## 6. Repo Structure

```
papersearch/
  artifacts/
    api-server/         @workspace/api-server — Express 5 REST API
    frontend/           @workspace/frontend — React SPA
    mockup-sandbox/     Throwaway UI prototype (ignore)
  lib/
    db/                 @workspace/db — Drizzle ORM schema + pg connection
    api-spec/           @workspace/api-spec — openapi.yaml + Orval codegen config
    api-zod/            @workspace/api-zod — Zod schemas (generated, do not edit)
    api-client-react/   @workspace/api-client-react — React Query hooks (generated, do not edit)
  scripts/
    src/
      ingest.ts         Combined ingest + index pipeline (single command)
      index-documents.ts  Standalone backfill/repair tool only
      lib/
        semantic-scholar.ts   Semantic Scholar API client
        preprocessor.ts       Tokenization, stemming, stopword removal
        index-writer.ts       Writes to terms + postings tables
  CLAUDE.md             AI assistant context file
  PRD.md                This document
```

---

## 7. System Architecture

### 7.1 High-Level Flow

1. **Ingestion + Indexing (single pipeline):** `pnpm ingest` fetches papers from Semantic Scholar → preprocesses text → inserts into `documents` table → immediately indexes into `terms` + `postings` tables in the same run
2. **Query Engine:** REST API receives search query → query parser → posting list lookup → BM25 scoring → ranked results
3. **API Layer:** Express handles HTTP, rate limiting (Redis), response serialization

### 7.2 Database Schema

**`documents`** — paper metadata
```sql
id             SERIAL PRIMARY KEY
paper_id       VARCHAR(64) UNIQUE NOT NULL  -- Semantic Scholar paper ID
title          TEXT NOT NULL
abstract       TEXT
authors        JSONB                        -- [{name, id}]
year           INTEGER
venue          VARCHAR(512)
citation_count INTEGER DEFAULT 0
fields_of_study JSONB
external_ids   JSONB                        -- {DOI, ArXiv, ...}
indexed_at     TIMESTAMP                    -- NULL until indexed
```

**`terms`** — vocabulary
```sql
id       SERIAL PRIMARY KEY
term     VARCHAR(256) UNIQUE NOT NULL  -- stemmed token
doc_freq INTEGER NOT NULL              -- docs containing this term
idf      FLOAT NOT NULL                -- precomputed IDF score
```

**`postings`** — per-term per-document entries
```sql
term_id   INTEGER REFERENCES terms(id)
doc_id    INTEGER REFERENCES documents(id)
field     VARCHAR(32)    -- 'title' | 'abstract' | 'authors'
tf        FLOAT NOT NULL -- normalized term frequency
positions INTEGER[]      -- token positions for phrase queries
PRIMARY KEY (term_id, doc_id, field)
```

**`index_stats`** — BM25 normalization data
```sql
key   VARCHAR(64) PRIMARY KEY
value FLOAT NOT NULL
-- Stores: total_docs, avgdl_title, avgdl_abstract, last_indexed_at
```

---

## 8. Core Components

### 8.1 Ingestion Pipeline (`scripts/src/ingest.ts`)

Single command runs both steps end-to-end:

```bash
pnpm --filter @workspace/scripts run ingest
pnpm --filter @workspace/scripts run ingest -- --query "transformer" --limit 50
pnpm --filter @workspace/scripts run ingest -- --limit 200
```

**Steps:**
1. **Fetch** — Semantic Scholar Graph API with `x-api-key` header, paginated, exponential backoff on 429s
2. **Preprocess** — tokenize, remove stopwords, stem, record token positions
3. **Store** — `INSERT ... ON CONFLICT DO NOTHING` (safe deduplication)
4. **Index** — immediately batch-indexes new documents into `terms` + `postings` (batch size: 50)

`index-documents.ts` remains as a standalone repair/backfill tool for re-indexing already-ingested documents.

### 8.2 Inverted Index + BM25

The index maps stemmed tokens to posting lists: `(doc_id, field, tf, positions)`.

**BM25 scoring:**
```
score(t, d) = IDF(t) × (tf(t,d) × (k1 + 1)) / (tf(t,d) + k1 × (1 - b + b × |d| / avgdl))
```
- `k1 = 1.5` (TF saturation), `b = 0.75` (length normalization)
- IDF: `log((N - df + 0.5) / (df + 0.5) + 1)`

**Field boosting:** title matches > abstract matches > author matches.

### 8.3 Query Engine (`artifacts/api-server/src/lib/`)

**Query parser** supports:
- Basic terms: `neural networks` → `[neural, network]`
- Phrase queries: `"exact phrase"` → position-verified
- Boolean: `bert AND (classification OR generation)`
- Exclusion: `machine learning -reinforcement`
- Field hints: `title:transformer abstract:attention`

**Typo tolerance:** If a query term returns 0 results, Levenshtein edit distance against `terms` table. Returns suggestion with distance ≤ 1 (short terms) or ≤ 2 (longer terms).

### 8.4 REST API (`artifacts/api-server/`)

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=` | Main search — BM25 ranked results |
| `GET /api/search/suggest?prefix=` | Autocomplete |
| `GET /api/papers/:id` | Single paper by ID |
| `GET /api/papers/:id/similar` | Similar papers by term overlap |
| `GET /api/stats` | Index stats (total docs, terms, avgdl) |
| `GET /health` | Health check (DB + Redis) |

**Sample response:**
```json
{
  "query": "attention mechanism transformer",
  "total": 8432,
  "took_ms": 47,
  "results": [
    {
      "id": "204e3073...",
      "title": "Attention Is All You Need",
      "authors": ["Ashish Vaswani", "Noam Shazeer"],
      "year": 2017,
      "venue": "NeurIPS",
      "citation_count": 89542,
      "score": 18.74
    }
  ],
  "suggestion": null
}
```

---

## 9. Environment Variables

| Variable | Used By | Notes |
|----------|---------|-------|
| `DATABASE_URL` | api-server, db, scripts | PostgreSQL connection string |
| `REDIS_URL` | api-server | Rate limiting + caching |
| `JWT_SECRET` | api-server | Auto-generated in dev |
| `SEMANTIC_SCHOLAR_API_KEY` | scripts | Required for ingestion — get from semanticscholar.org |
| `PORT` | api-server, frontend | Server port |
| `NODE_ENV` | api-server | `development` relaxes JWT_SECRET requirement |

---

## 10. Deployment

**Development (local):**
```bash
pnpm install
pnpm --filter @workspace/db push     # apply schema
pnpm --filter @workspace/api-server dev  # start server on port 3000
pnpm --filter @workspace/scripts run ingest  # populate + index papers
```

**Production (Railway):**
- Connected to GitHub `main` branch — auto-deploys on push
- PostgreSQL and Redis provisioned as Railway services
- Environment variables set in Railway dashboard

---

## 11. Current Status

| Item | Status |
|------|--------|
| API server running locally | ✅ |
| Database schema applied | ✅ |
| Semantic Scholar API key configured | ✅ |
| Ingest + index pipeline merged (single command) | ✅ |
| README.md written | ✅ |
| End-to-end search verified | ⏳ In progress |
| Tests written | ❌ Not yet |
| Railway deployment | ❌ Not yet |
| 1,000+ papers indexed | ❌ Not yet |

---

## 12. Build Order (Remaining)

1. Run pipeline: `pnpm --filter @workspace/scripts run ingest`
2. Verify search: `curl "http://localhost:3000/api/search?q=neural+network"`
3. Write tests for query parser, BM25 scorer, Levenshtein
4. Deploy to Railway
5. Update status table above with real numbers

---

## 13. Interview Questions to Prepare

| Question | Answer |
|----------|--------|
| **Why BM25 over TF-IDF?** | TF-IDF doesn't normalize for document length (long docs get unfair advantage) and has unbounded TF. BM25 fixes both with length normalization (b parameter) and TF saturation (k1 parameter). |
| **Why store positions in postings?** | Phrase queries need to verify that matched terms appear consecutively. Without positions, you can't distinguish `"machine learning"` (exact phrase) from a doc that has the words in separate sentences. |
| **How do you handle concurrent ingestion + queries?** | PostgreSQL MVCC handles this natively. Index updates (UPSERTs to terms, INSERTs to postings) are wrapped in transactions. Search queries never block on writes. |
| **Why not just use Elasticsearch?** | The goal was to understand how search works at the data structure level. Elasticsearch is a black box — this makes the inverted index, posting lists, and BM25 scoring explicit and inspectable. |
| **How does typo tolerance work?** | If a query term returns 0 posting list results, compute Levenshtein edit distance against terms in the terms table filtered by similar doc_freq. Return closest match with distance ≤ 1 for short terms, ≤ 2 for longer ones. |
| **How would you scale to 10M papers?** | Partition postings by term_id hash, shard documents across Postgres instances, add pgvector for hybrid BM25 + dense retrieval, distributed Redis for caching. |

---

*Build the hard parts yourself.*
