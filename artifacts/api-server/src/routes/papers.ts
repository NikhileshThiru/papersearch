import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { documentsTable, postingsTable, termsTable } from "@workspace/db/schema";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { search } from "../lib/search.js";
import { rateLimit } from "../middlewares/rate-limit.js";

const router: IRouter = Router();

router.get("/papers/:id", rateLimit, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);

  const rows = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.paper_id, id))
    .limit(1);

  const doc = rows[0];
  if (!doc) {
    res.status(404).json({ error: "not_found", message: "Paper not found" });
    return;
  }

  res.json({
    id: doc.id,
    paperId: doc.paper_id,
    title: doc.title,
    authors: Array.isArray(doc.authors)
      ? doc.authors.map((a: { name: string }) => a.name).join(", ")
      : (doc.authors ?? ""),
    year: doc.year,
    abstract: doc.abstract,
    venue: doc.venue,
    citationCount: doc.citation_count,
    fieldOfStudy: Array.isArray(doc.fields_of_study) ? (doc.fields_of_study[0] ?? null) : null,
    externalIds: doc.external_ids,
    indexedAt: doc.indexed_at?.toISOString() ?? null,
  });
});

router.get(
  "/papers/:id/similar",
  rateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params["id"]);
    const limit = Math.min(20, Math.max(1, Number(req.query["limit"] ?? 5)));

    const rows = await db
      .select({ id: documentsTable.id })
      .from(documentsTable)
      .where(eq(documentsTable.paper_id, id))
      .limit(1);

    const doc = rows[0];
    if (!doc) {
      res.status(404).json({ error: "not_found", message: "Paper not found" });
      return;
    }

    // The paper's top TF-IDF topic terms (title/abstract) that also appear in at
    // least one other paper — terms unique to this paper can never match anything else.
    const weight = sql<number>`max(${termsTable.idf} * ${postingsTable.tf})`;
    const termRows = await db
      .select({
        term: termsTable.term,
        display_term: termsTable.display_term,
        weight,
      })
      .from(postingsTable)
      .innerJoin(termsTable, eq(postingsTable.term_id, termsTable.id))
      .where(
        and(
          eq(postingsTable.doc_id, doc.id),
          ne(postingsTable.field, "authors"),
          gt(termsTable.doc_freq, 1),
        ),
      )
      .groupBy(termsTable.term, termsTable.display_term)
      .orderBy(desc(weight))
      .limit(10);

    if (termRows.length === 0) {
      res.json({ papers: [] });
      return;
    }

    // Use unstemmed forms: search() stems the query again.
    const queryStr = termRows.map((t) => t.display_term ?? t.term).join(" ");
    const result = await search(queryStr, { pageSize: limit + 1 });

    const filtered = result.results
      .filter((r) => r.paper_id !== id)
      .slice(0, limit);

    const serialized = filtered.map((r) => ({
      id: r.id,
      paperId: r.paper_id,
      title: r.title,
      authors: Array.isArray(r.authors)
        ? r.authors.map((a) => a.name).join(", ")
        : (r.authors ?? ""),
      year: r.year,
      abstract: r.abstract,
      venue: r.venue,
      citationCount: r.citation_count,
      fieldOfStudy: r.fields_of_study?.[0] ?? null,
      score: r.score,
    }));

    res.json({ papers: serialized });
  },
);

export default router;
