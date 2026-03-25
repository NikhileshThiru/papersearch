# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (run from repo root)
```bash
pnpm install                  # Install all dependencies
pnpm typecheck                # Typecheck libs (tsc --build) then all artifacts
pnpm build                    # Typecheck + build all packages
```

### API Server (`artifacts/api-server`)
```bash
pnpm dev                      # Build + start in development mode
pnpm build                    # esbuild compile to dist/index.mjs
pnpm start                    # Run compiled server (requires build first)
pnpm typecheck                # Type-check only
```

### Frontend (`artifacts/frontend`)
```bash
pnpm dev                      # Vite dev server on 0.0.0.0 (PORT env, default 5173)
pnpm build                    # Vite production build → dist/public/
pnpm serve                    # Preview production build
pnpm typecheck
```

### Database (`lib/db`)
```bash
pnpm push                     # Apply Drizzle schema to DB (requires DATABASE_URL)
pnpm push-force               # Force-apply (drops conflicting constraints)
```

### Scripts (`scripts`)
```bash
pnpm ingest                   # Fetch papers from Semantic Scholar API → DB
pnpm index-documents          # Build inverted index from un-indexed documents
```

### Code generation (`lib/api-spec`)
```bash
pnpm codegen                  # Regenerate api-client-react hooks + api-zod schemas from openapi.yaml
```

### Running a single script
```bash
cd scripts && tsx ./src/<script-name>.ts
```

## Architecture

This is a **pnpm monorepo** for an academic paper search engine. There are no test files currently.

### Package structure

```
lib/
  db/               @workspace/db          — Drizzle ORM schema + pg connection
  api-spec/         @workspace/api-spec    — openapi.yaml + Orval codegen config
  api-zod/          @workspace/api-zod     — Zod schemas (generated, do not edit)
  api-client-react/ @workspace/api-client-react — React Query hooks (generated, do not edit)

artifacts/
  api-server/       @workspace/api-server  — Express 5 REST API
  frontend/         @workspace/frontend    — React 18 SPA
  mockup-sandbox/   @workspace/mockup-sandbox — UI prototype/playground

scripts/            @workspace/scripts     — Data ingestion + indexing CLI tools
```

TypeScript project references: the root `tsconfig.json` references `lib/*` packages for incremental builds. Artifact packages reference lib packages directly via their source `exports` (no build step required for libs).

### Search engine

The search engine is a custom BM25 inverted index stored in PostgreSQL:
- **`terms`** table: vocabulary (term string, IDF, doc frequency)
- **`postings`** table: per-term per-document entries (TF, field, positions array)
- **`index_stats`**: total document count and average doc length (used for BM25 normalization)
- **`documents`**: paper metadata; `indexed_at` is null until `index-documents` processes the row

Query parsing (`api-server/src/lib/query-parser.ts`) supports boolean operators, phrases, and exclusions. Ranking (`api-server/src/lib/search.ts`) applies BM25 with field boosts (title > abstract > authors) and typo tolerance via Levenshtein suggestions.

### API contract flow

The single source of truth is `lib/api-spec/openapi.yaml`. Changes to the API require:
1. Update `openapi.yaml`
2. Run `pnpm codegen` in `lib/api-spec` to regenerate `api-zod` and `api-client-react`
3. Implement the endpoint changes in `api-server`

The generated files in `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` should never be edited manually.

### Frontend

- **Routing**: Wouter (lightweight, replaces React Router)
- **Server state**: `@tanstack/react-query` via hooks from `@workspace/api-client-react`
- **UI components**: Radix UI primitives + custom wrappers in `src/components/ui/`
- **Path alias**: `@/` maps to `src/`
- The `lib/api-client-react` custom fetcher (`src/custom-fetch.ts`) exposes `setBaseUrl()` and `setAuthTokenGetter()` for configuring the API base URL and auth at runtime

### Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | api-server, db, scripts | PostgreSQL connection string |
| `PORT` | api-server, frontend | Server port |
| `JWT_SECRET` | api-server | Required in production; auto-generated in development |
| `REDIS_URL` | api-server | Optional; used only for health check |
| `BASE_PATH` | frontend | URL base path (default `/`) |
| `BASE_URL` | frontend | API base URL (default `/api`) |
| `NODE_ENV` | api-server | `development` relaxes JWT_SECRET requirement |
