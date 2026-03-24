import { db } from "@workspace/db";
import { documentsTable, type Document } from "@workspace/db";
import { sql } from "drizzle-orm";
import { searchPapers } from "./lib/semantic-scholar.js";
import { preprocessDocument, type PreprocessedDocument } from "./lib/preprocessor.js";

export interface IngestedPaper {
  document: Document;
  preprocessed: PreprocessedDocument;
  wasNew: boolean;
}

const SEED_QUERIES = [
  "machine learning",
  "deep learning",
  "natural language processing",
  "computer vision",
  "distributed systems",
  "reinforcement learning",
  "graph neural networks",
  "transformer attention",
  "information retrieval",
  "knowledge graphs",
];

interface IngestionStats {
  total: number;
  inserted: number;
  skipped: number;
  errors: number;
}

function printHelp() {
  console.log(`
Usage: pnpm --filter @workspace/scripts run ingest [options]

Options:
  --query <text>   Run a single custom query instead of the default seed queries
  --limit <N>      Maximum papers to fetch *per query* (default: 100)
  --help           Show this help message

Note: --limit applies per-query. With default seed queries (${SEED_QUERIES.length} queries)
and --limit 100, the pipeline may ingest up to ${SEED_QUERIES.length * 100} papers total.

Examples:
  pnpm --filter @workspace/scripts run ingest -- --query "transformer" --limit 50
  pnpm --filter @workspace/scripts run ingest -- --limit 200
`);
}

/**
 * Fetch, preprocess, deduplicate, and store papers for a single query.
 *
 * Uses INSERT ... ON CONFLICT (paper_id) DO NOTHING for safe concurrent inserts.
 * Yields IngestedPaper objects containing the stored document + preprocessed
 * tokens/positions so the caller (e.g., an indexer) can consume them without
 * a second preprocessing pass.
 */
export async function* ingestQuery(
  query: string,
  limit: number,
  stats: IngestionStats,
): AsyncGenerator<IngestedPaper> {
  console.log(`\n[ingest] Query: "${query}" (limit per query: ${limit})`);

  for await (const paper of searchPapers(query, { limit })) {
    stats.total++;

    try {
      const preprocessed = preprocessDocument(
        paper.title,
        paper.abstract,
        paper.authors.map((a) => ({ name: a.name, id: a.authorId })),
      );

      const values = {
        paper_id: paper.paperId,
        title: paper.title,
        abstract: paper.abstract ?? null,
        authors: paper.authors.map((a) => ({
          name: a.name,
          id: a.authorId ?? undefined,
        })),
        year: paper.year ?? null,
        venue: paper.venue ?? null,
        citation_count: paper.citationCount ?? 0,
        fields_of_study: paper.fieldsOfStudy ?? null,
        external_ids: paper.externalIds
          ? (Object.fromEntries(
              Object.entries(paper.externalIds).filter(([, v]) => v !== undefined),
            ) as Record<string, string>)
          : null,
      };

      const [row] = await db
        .insert(documentsTable)
        .values(values)
        .onConflictDoNothing({ target: documentsTable.paper_id })
        .returning();

      if (row) {
        stats.inserted++;
        process.stdout.write("+");
        yield { document: row, preprocessed, wasNew: true };
      } else {
        const [existing] = await db
          .select()
          .from(documentsTable)
          .where(sql`${documentsTable.paper_id} = ${paper.paperId}`)
          .limit(1);

        stats.skipped++;
        process.stdout.write(".");
        yield { document: existing!, preprocessed, wasNew: false };
      }
    } catch (err) {
      stats.errors++;
      console.error(`\n[ingest] Error processing paper ${paper.paperId}:`, err);
    }
  }

  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const limitFlag = args.indexOf("--limit");
  const limitPerQuery =
    limitFlag !== -1 ? parseInt(args[limitFlag + 1] ?? "100", 10) : 100;

  const queryFlag = args.indexOf("--query");
  const queries: string[] =
    queryFlag !== -1 && args[queryFlag + 1]
      ? [args[queryFlag + 1]!]
      : SEED_QUERIES;

  console.log("[ingest] Starting PaperSearch ingestion pipeline");
  console.log(
    `[ingest] Queries: ${queries.length}, limit per query: ${limitPerQuery}`,
  );

  const stats: IngestionStats = {
    total: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  for (const query of queries) {
    for await (const ingested of ingestQuery(query, limitPerQuery, stats)) {
      if (ingested.wasNew) {
        const { title, abstract, authors } = ingested.preprocessed;
        process.stdout.write(
          ` [tokens: title:${title.tokens.length} abstract:${abstract.tokens.length} authors:${authors.tokens.length}]\n`,
        );
      }
    }
  }

  console.log("\n[ingest] ====== Ingestion complete ======");
  console.log(`[ingest]   Total fetched  : ${stats.total}`);
  console.log(`[ingest]   Inserted (new) : ${stats.inserted}`);
  console.log(`[ingest]   Skipped (dup)  : ${stats.skipped}`);
  console.log(`[ingest]   Errors         : ${stats.errors}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[ingest] Fatal error:", err);
  process.exit(1);
});
