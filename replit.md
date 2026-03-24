# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server for PaperSearch. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, pino-http logging, routes at `/api`
- Depends on: `@workspace/db`, `@workspace/api-zod`, `jose`, `bcryptjs`, `natural`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.mjs`)

#### Routes (all mounted under `/api`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check (db ping) |
| GET | `/search?q=...` | BM25 search with filters (page, pageSize, yearFrom, yearTo, fieldOfStudy, minCitations) |
| GET | `/search/suggest?q=...` | Autocomplete term prefix suggestions |
| GET | `/papers/:id` | Paper detail by Semantic Scholar paper_id |
| GET | `/papers/:id/similar` | Similar papers via term overlap |
| GET | `/stats` | Index statistics (total docs, terms, avgdl, last indexed) |
| POST | `/auth/register` | Register new user (email + API key → JWT) |
| POST | `/auth/login` | Login (email + API key → JWT) |
| GET | `/admin/query-logs` | Paginated query log (admin JWT required) |
| POST | `/admin/reindex` | Trigger reindex (admin JWT required) |

#### Middleware

- `src/middlewares/auth.ts` — JWT (HS256 via jose): `optionalAuth`, `requireAuth`, `requireAdmin`, `signToken`
- `src/middlewares/rate-limit.ts` — in-memory sliding window (60 req/min per IP, 429 with Retry-After)

#### Libraries

- `src/lib/search.ts` — BM25 search engine (query parse → posting fetch → scoring → pagination)
- `src/lib/query-parser.ts` — query syntax parser (phrases, exclusions, AND, field:hint)
- `src/lib/bm25-constants.ts` — K1=1.5, B=0.75, FIELD_BOOSTS={title:2, abstract:1, authors:0.5}

#### Authentication

JWT secret: `JWT_SECRET` env var (falls back to a dev default). Tokens expire in 7 days. Admin access requires `plan="admin"` in the users table.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas
  - `documents.ts` — academic papers (paper_id, title, abstract, authors, year, venue, citation_count, fields_of_study, external_ids)
  - `terms.ts` — inverted index vocabulary (term, doc_freq, idf)
  - `postings.ts` — posting lists (term_id, doc_id, field, tf, positions[])
  - `users.ts` — API users (email, api_key, plan)
  - `query_logs.ts` — search query audit log (user_id, query, filters, result_count, latency_ms)
  - `index_stats.ts` — key/value stats (total_docs, avgdl_title, avgdl_abstract, last_indexed_at)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
