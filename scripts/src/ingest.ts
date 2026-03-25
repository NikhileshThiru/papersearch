import "dotenv/config";
import { db } from "@workspace/db";
import { documentsTable, type Document } from "@workspace/db";
import { sql } from "drizzle-orm";
import { searchPapers } from "./lib/semantic-scholar.js";
import { preprocessDocument, type PreprocessedDocument } from "./lib/preprocessor.js";
import { indexBatch } from "./lib/index-writer.js";

export interface IngestedPaper {
  document: Document;
  preprocessed: PreprocessedDocument;
  wasNew: boolean;
}

const SEED_QUERIES = [
  "machine learning",
  "neural networks",
  "transformer",
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

const INDEX_BATCH_SIZE = 50;

async function flushBatch(
  batch: Array<{ document: Document; preprocessed: PreprocessedDocument }>,
  totalIndexed: { count: number },
  totalErrors: { count: number },
): Promise<void> {
  if (batch.length === 0) return;
  const { indexed, errors } = await indexBatch(batch);
  totalIndexed.count += indexed;
  totalErrors.count += errors;
  console.log(`\n[pipeline] Indexed batch: ${indexed}`);
  batch.length = 0;
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

  console.log("[pipeline] Starting PaperSearch ingest + index pipeline");
  console.log(
    `[pipeline] Queries: ${queries.length}, limit per query: ${limitPerQuery}`,
  );

  const stats: IngestionStats = { total: 0, inserted: 0, skipped: 0, errors: 0 };
  const totalIndexed = { count: 0 };
  const totalErrors = { count: 0 };

  for (const query of queries) {
    const pendingBatch: Array<{ document: Document; preprocessed: PreprocessedDocument }> = [];

    for await (const ingested of ingestQuery(query, limitPerQuery, stats)) {
      if (!ingested.wasNew) continue;

      pendingBatch.push({
        document: ingested.document,
        preprocessed: ingested.preprocessed,
      });

      if (pendingBatch.length >= INDEX_BATCH_SIZE) {
        await flushBatch(pendingBatch, totalIndexed, totalErrors);
      }
    }

    // Flush any remaining papers from this query
    await flushBatch(pendingBatch, totalIndexed, totalErrors);
  }

  console.log("\n[pipeline] ====== Ingestion stats ======");
  console.log(`[pipeline]   Total fetched  : ${stats.total}`);
  console.log(`[pipeline]   Inserted (new) : ${stats.inserted}`);
  console.log(`[pipeline]   Skipped (dup)  : ${stats.skipped}`);
  console.log(`[pipeline]   Errors         : ${stats.errors}`);

  const statsResult = await db.execute(
    sql`SELECT key, value FROM index_stats ORDER BY key`,
  );
  console.log("\n[pipeline] ====== Index stats ======");
  for (const row of statsResult.rows as Array<{ key: string; value: number }>) {
    if (row.key === "last_indexed_at") {
      console.log(`[pipeline]   ${row.key}: ${new Date(row.value * 1000).toISOString()}`);
    } else {
      console.log(`[pipeline]   ${row.key}: ${row.value}`);
    }
  }

  const termsResult = await db.execute(sql`SELECT COUNT(*) AS count FROM terms`);
  const postingsResult = await db.execute(sql`SELECT COUNT(*) AS count FROM postings`);
  console.log(`[pipeline]   terms count: ${(termsResult.rows[0] as { count: string }).count}`);
  console.log(`[pipeline]   postings count: ${(postingsResult.rows[0] as { count: string }).count}`);

  console.log("\n[pipeline] ====== Run summary ======");
  console.log(`[pipeline]   Indexed this run : ${totalIndexed.count}`);
  console.log(`[pipeline]   Errors this run  : ${totalErrors.count}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[ingest] Fatal error:", err);
  process.exit(1);
});
