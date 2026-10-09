# PaperSearch — Product Requirements Document

**A Custom Search Engine for Academic Research Papers, Built from Scratch**

v3.0 — Complete (local project, no deployment)

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
- Ship as a portfolio project: runs locally, documented with screenshots in the README (no hosted deployment)

---

## 3. Non-Goals

- Not trying to replace Elasticsearch or compete at web scale — the goal is demonstrating the architecture
- No ML-based semantic search (dense vector retrieval) in v1 — defined stretch goal
- No user accounts or JWT auth in v1 — the API is the deliverable
- No hosted deployment — the project is documented and run locally

---

## 4. Resume Story

This project directly complements RefNet. RefNet visualizes citation networks across 250M+ papers — PaperSearch is the search layer that would power how researchers actually find those papers. Same domain, different layer of the stack.

**Resume bullet (real numbers):**

> Built a custom search engine for academic papers from scratch in TypeScript/Node.js — inverted index in PostgreSQL, BM25 ranking with field boosts, query parser with Boolean operators and position-verified phrase queries, and Levenshtein typo correction — without Elasticsearch or any search library. Indexed 1,166 papers (12K terms, 101K postings) from the Semantic Scholar API with ~7 ms median query latency.

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
| Text processing | `natural` package for tokenizer, Porter stemmer, stopword list; everything after tokenization is custom |
| Monorepo tooling | pnpm workspaces |
| API documentation | OpenAPI spec (`lib/api-spec/openapi.yaml`) + Orval codegen |
| Dev environment | Local macOS + Neovim + tmux |
| Tests | Node built-in test runner (`node --test` via tsx) |

---

## 6. Repo Structure

```
papersearch/
  artifacts/
    api-server/         @workspace/api-server — Express 5 REST API
    frontend/           @workspace/frontend — React SPA
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
- Boolean: `deep AND learning` (AND makes every term required; parentheses are ignored, no nested grouping)
- Exclusion: `machine learning -reinforcement` or `machine learning NOT reinforcement`
- Field hints: `title:transformer abstract:attention`

**Typo tolerance:** Every query word with no postings is compared (Levenshtein, distance ≤ 2) against the top 10,000 vocabulary terms by document frequency; each is replaced with its closest term's display form and the full corrected query is returned as `suggestion` (e.g. `speach recogniton` → `speech recognition`).

### 8.4 REST API (`artifacts/api-server/`)

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=` | Main search — BM25 ranked results |
| `GET /api/search/suggest?q=` | Autocomplete |
| `GET /api/papers/:paperId` | Single paper by Semantic Scholar ID |
| `GET /api/papers/:paperId/similar` | Similar papers via the paper's top TF-IDF terms |
| `GET /api/stats` | Index stats (total docs, terms, avgdl) |
| `GET /api/health` | Health check (DB + Redis) |

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

## 10. Running Locally

```bash
pnpm install
pnpm --filter @workspace/db push            # apply schema (reads root .env)
pnpm --filter @workspace/scripts pipeline   # fetch + index papers
pnpm --filter @workspace/api-server dev     # API on :3000
pnpm --filter @workspace/frontend dev       # UI on :5173 (proxies /api to :3000)
```

No hosted deployment — by decision, the project is documented in the README with screenshots instead.

---

## 11. Current Status

| Item | Status |
|------|--------|
| API server running locally | ✅ |
| Frontend running locally (Vite proxy to API) | ✅ |
| Database schema applied | ✅ |
| Semantic Scholar API key configured | ✅ |
| Ingest + index pipeline merged (single command) | ✅ |
| 1,000+ papers indexed (1,166 docs, 12,024 terms, 101,329 postings) | ✅ |
| End-to-end search verified (BM25, phrases, AND/NOT/-, field hints, typo correction, similar papers) | ✅ |
| Tests written (20 unit tests: query parser, BM25/IDF, Levenshtein) | ✅ |
| README with screenshots | ✅ |
| Railway deployment | ➖ Dropped (local-only portfolio project) |

---

## 12. Build Order

All planned work is complete. Possible future improvements:
1. Recursive-descent Boolean parser with nested grouping
2. BK-tree / trigram index for typo correction
3. Top-k pruning (WAND / MaxScore) for larger corpora

---

## 13. Interview Questions to Prepare

| Question | Answer |
|----------|--------|
| **Why BM25 over TF-IDF?** | TF-IDF doesn't normalize for document length (long docs get unfair advantage) and has unbounded TF. BM25 fixes both with length normalization (b parameter) and TF saturation (k1 parameter). |
| **Why store positions in postings?** | Phrase queries need to verify that matched terms appear consecutively. Without positions, you can't distinguish `"machine learning"` (exact phrase) from a doc that has the words in separate sentences. |
| **How do you handle concurrent ingestion + queries?** | PostgreSQL MVCC handles this natively. Index updates (UPSERTs to terms, INSERTs to postings) are wrapped in transactions. Search queries never block on writes. |
| **Why not just use Elasticsearch?** | The goal was to understand how search works at the data structure level. Elasticsearch is a black box — this makes the inverted index, posting lists, and BM25 scoring explicit and inspectable. |
| **How does typo tolerance work?** | If a query word has no postings, compute Levenshtein distance against the vocabulary (top 10K terms by doc_freq), take the closest term within distance 2, and rewrite the query with it for a "Did you mean" suggestion. A BK-tree or trigram index would make this sub-millisecond. |
| **How would you scale to 10M papers?** | Partition postings by term_id hash, shard documents across Postgres instances, add pgvector for hybrid BM25 + dense retrieval, distributed Redis for caching. |

---

*Build the hard parts yourself.*
