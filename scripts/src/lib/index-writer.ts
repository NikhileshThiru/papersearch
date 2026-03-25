import { pool, db, type PoolClient } from "@workspace/db";
import { indexStatsTable, type Document } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { computeTf } from "@workspace/db";
import { preprocessDocument, type PreprocessedDocument } from "./preprocessor.js";

export type IndexField = "title" | "abstract" | "authors";

async function recomputeAllIdfs(totalDocs: number): Promise<void> {
  await db.execute(sql`
    UPDATE terms
    SET idf = ln((${totalDocs} - doc_freq + 0.5) / (doc_freq + 0.5) + 1)
  `);
}

/**
 * Index a single document. All writes (terms, postings, stats, indexed_at) are
 * committed in one transaction.
 *
 * Returns 'skipped' if the document was already indexed (idempotent).
 *
 * doc_freq correctness: unique terms are collected across all fields first, then
 * each term is upserted once so doc_freq increments by 1 per document, not per field.
 */
export async function indexDocument(
  document: Document,
  preprocessed: PreprocessedDocument,
): Promise<"indexed" | "skipped"> {
  const client: PoolClient = await pool.connect();

  try {
    await client.query("BEGIN");

    // Idempotency: lock the row and bail if already indexed.
    const lockResult = await client.query<{ indexed_at: Date | null }>(
      `SELECT indexed_at FROM documents WHERE id = $1 FOR UPDATE`,
      [document.id],
    );
    if (lockResult.rows[0]?.indexed_at !== null) {
      await client.query("ROLLBACK");
      return "skipped";
    }

    // Collect unique terms and per-field term counts.
    // Also track the first unstemmed form seen for each stem (for display_term).
    type TermEntry = { count: number; positions: number[] };
    type FieldEntry = { field: IndexField; tokens: string[]; termCounts: Map<string, TermEntry> };

    const fieldData: FieldEntry[] = [];
    const allTerms = new Set<string>();
    const termToOriginal = new Map<string, string>();

    for (const [field, tokenized] of [
      ["title", preprocessed.title],
      ["abstract", preprocessed.abstract],
      ["authors", preprocessed.authors],
    ] as const) {
      const { tokens, originals, positions } = tokenized;
      if (tokens.length === 0) continue;

      const termCounts = new Map<string, TermEntry>();
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        const pos = positions[i]!;
        if (!termToOriginal.has(token)) {
          termToOriginal.set(token, originals[i]!);
        }
        const existing = termCounts.get(token);
        if (existing) {
          existing.count++;
          existing.positions.push(pos);
        } else {
          termCounts.set(token, { count: 1, positions: [pos] });
        }
        allTerms.add(token);
      }

      fieldData.push({ field, tokens, termCounts });
    }

    // Upsert each unique term once → doc_freq is per-document.
    // display_term is stored only on INSERT (first unstemmed form seen); not overwritten on conflict.
    const termIdMap = new Map<string, number>();
    for (const term of allTerms) {
      const result = await client.query<{ id: number }>(
        `INSERT INTO terms (term, doc_freq, idf, display_term)
         VALUES ($1, 1, 0, $2)
         ON CONFLICT (term) DO UPDATE SET doc_freq = terms.doc_freq + 1, idf = 0
         RETURNING id`,
        [term, termToOriginal.get(term) ?? term],
      );
      termIdMap.set(term, result.rows[0]!.id);
    }

    // Upsert per-field postings, refreshing tf and positions if row exists.
    for (const { field, tokens, termCounts } of fieldData) {
      const totalTokens = tokens.length;
      for (const [term, { count, positions: termPositions }] of termCounts) {
        const termId = termIdMap.get(term)!;
        const tf = computeTf(count, totalTokens);
        await client.query(
          `INSERT INTO postings (term_id, doc_id, field, tf, positions)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (term_id, doc_id, field) DO UPDATE SET tf = EXCLUDED.tf, positions = EXCLUDED.positions`,
          [termId, document.id, field, tf, termPositions],
        );
      }
    }

    // Increment total_docs.
    await client.query(
      `INSERT INTO index_stats (key, value) VALUES ('total_docs', 1)
       ON CONFLICT (key) DO UPDATE SET value = index_stats.value + 1`,
    );

    // Update running avgdl (Welford's online formula) inside the same transaction.
    const totalDocsResult = await client.query<{ value: number }>(
      `SELECT value FROM index_stats WHERE key = 'total_docs' LIMIT 1`,
    );
    const newTotalDocs = totalDocsResult.rows[0]
      ? Math.round(totalDocsResult.rows[0].value)
      : 1;

    for (const [statKey, fieldLen] of [
      ["avgdl_title", preprocessed.title.tokens.length],
      ["avgdl_abstract", preprocessed.abstract.tokens.length],
    ] as const) {
      await client.query(
        `INSERT INTO index_stats (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = index_stats.value + ($2 - index_stats.value) / $3`,
        [statKey, fieldLen, newTotalDocs],
      );
    }

    // Mark as indexed (durable marker — used to detect un-indexed docs).
    await client.query(
      `UPDATE documents SET indexed_at = NOW() WHERE id = $1`,
      [document.id],
    );

    await client.query("COMMIT");
    return "indexed";
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function indexBatch(
  docs: Array<{ document: Document; preprocessed: PreprocessedDocument }>,
): Promise<{ indexed: number; skipped: number; errors: number }> {
  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  for (const { document, preprocessed } of docs) {
    try {
      const status = await indexDocument(document, preprocessed);
      if (status === "indexed") {
        indexed++;
        process.stdout.write("i");
      } else {
        skipped++;
        process.stdout.write("s");
      }
    } catch (err) {
      errors++;
      console.error(`\n[indexer] Error indexing doc ${document.id}:`, err);
    }
  }

  if (indexed > 0) {
    const [totalDocsRow] = await db
      .select({ value: indexStatsTable.value })
      .from(indexStatsTable)
      .where(eq(indexStatsTable.key, "total_docs"))
      .limit(1);

    const totalDocs = totalDocsRow ? Math.round(totalDocsRow.value) : 0;
    if (totalDocs > 0) {
      await recomputeAllIdfs(totalDocs);
    }

    const nowEpoch = Date.now() / 1000;
    await db.execute(sql`
      INSERT INTO index_stats (key, value) VALUES ('last_indexed_at', ${nowEpoch})
      ON CONFLICT (key) DO UPDATE SET value = ${nowEpoch}
    `);
  }

  return { indexed, skipped, errors };
}

export { preprocessDocument };
export type { PreprocessedDocument };
