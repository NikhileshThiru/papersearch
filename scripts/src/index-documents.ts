import "dotenv/config";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { preprocessDocument } from "./lib/preprocessor.js";
import { indexBatch } from "./lib/index-writer.js";
import type { Document } from "@workspace/db";

const DEFAULT_BATCH_SIZE = 50;

function printHelp() {
  console.log(`
Usage: pnpm --filter @workspace/scripts run index-documents [options]

Options:
  --batch <N>       Documents per batch (default: ${DEFAULT_BATCH_SIZE})
  --limit <N>       Max documents to index this run (default: all)
  --repair-orphans  One-time repair: reset indexed_at=NULL for docs with no postings
                    (use when migrating from old schema where indexed_at defaulted to NOW())
  --help            Show this help

Examples:
  pnpm --filter @workspace/scripts run index-documents
  pnpm --filter @workspace/scripts run index-documents -- --batch 100 --limit 500
  pnpm --filter @workspace/scripts run index-documents -- --repair-orphans
`);
}

// Resets indexed_at to NULL for documents that have no postings, covering the
// case where old schema rows had indexed_at = NOW() by default.
async function backfillIndexedAtForOrphans(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE documents
    SET indexed_at = NULL
    WHERE indexed_at IS NOT NULL
      AND id NOT IN (SELECT DISTINCT doc_id FROM postings)
  `);
  return (result as { rowCount?: number }).rowCount ?? 0;
}

async function fetchUnindexedDocuments(limit: number): Promise<Document[]> {
  const result = await db.execute(sql`
    SELECT * FROM documents WHERE indexed_at IS NULL ORDER BY id ASC LIMIT ${limit}
  `);
  return result.rows as Document[];
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const batchFlag = args.indexOf("--batch");
  const batchSize =
    batchFlag !== -1
      ? parseInt(args[batchFlag + 1] ?? String(DEFAULT_BATCH_SIZE), 10)
      : DEFAULT_BATCH_SIZE;

  const limitFlag = args.indexOf("--limit");
  const globalLimit =
    limitFlag !== -1 ? parseInt(args[limitFlag + 1] ?? "0", 10) : Infinity;

  console.log("[indexer] Starting PaperSearch incremental indexer");
  console.log(
    `[indexer] Batch size: ${batchSize}, global limit: ${globalLimit === Infinity ? "all" : globalLimit}`,
  );

  if (args.includes("--repair-orphans")) {
    const resetCount = await backfillIndexedAtForOrphans();
    console.log(`[indexer] --repair-orphans: reset ${resetCount} document(s) to un-indexed`);
  }

  let totalIndexed = 0;
  let totalErrors = 0;

  while (true) {
    const remaining =
      globalLimit === Infinity
        ? batchSize
        : Math.min(batchSize, globalLimit - totalIndexed);
    if (remaining <= 0) break;

    const docs = await fetchUnindexedDocuments(remaining);

    if (docs.length === 0) {
      console.log("\n[indexer] No more un-indexed documents found.");
      break;
    }

    console.log(`\n[indexer] Indexing batch of ${docs.length} documents`);

    const batch = docs.map((document) => ({
      document,
      preprocessed: preprocessDocument(
        document.title,
        document.abstract,
        document.authors as Array<{ name: string; id?: string }> | null,
      ),
    }));

    const { indexed, skipped, errors } = await indexBatch(batch);
    totalIndexed += indexed;
    totalErrors += errors;

    console.log(
      `\n[indexer] Batch complete — indexed: ${indexed}, skipped: ${skipped}, errors: ${errors}`,
    );

    if (indexed === 0 && skipped === 0 && errors === docs.length) {
      console.error("[indexer] All documents in batch failed. Stopping.");
      break;
    }
  }

  const statsResult = await db.execute(
    sql`SELECT key, value FROM index_stats ORDER BY key`,
  );
  console.log("\n[indexer] ====== Index stats ======");
  for (const row of statsResult.rows as Array<{ key: string; value: number }>) {
    if (row.key === "last_indexed_at") {
      console.log(`[indexer]   ${row.key}: ${new Date(row.value * 1000).toISOString()}`);
    } else {
      console.log(`[indexer]   ${row.key}: ${row.value}`);
    }
  }

  const termsResult = await db.execute(sql`SELECT COUNT(*) AS count FROM terms`);
  const postingsResult = await db.execute(sql`SELECT COUNT(*) AS count FROM postings`);
  console.log(`[indexer]   terms count: ${(termsResult.rows[0] as { count: string }).count}`);
  console.log(`[indexer]   postings count: ${(postingsResult.rows[0] as { count: string }).count}`);

  console.log("\n[indexer] ====== Run summary ======");
  console.log(`[indexer]   Indexed this run : ${totalIndexed}`);
  console.log(`[indexer]   Errors this run  : ${totalErrors}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[indexer] Fatal error:", err);
  process.exit(1);
});
