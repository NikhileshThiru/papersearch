import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { documentsTable, postingsTable, termsTable } from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
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

    const postings = await db
      .select({ term_id: postingsTable.term_id })
      .from(postingsTable)
      .where(eq(postingsTable.doc_id, doc.id));

    const termIds = [...new Set(postings.map((p) => p.term_id))];
    if (termIds.length === 0) {
      res.json({ papers: [] });
      return;
    }

    const termRows = await db
      .select({ term: termsTable.term })
      .from(termsTable)
      .where(inArray(termsTable.id, termIds.slice(0, 20)))
      .orderBy(sql`idf DESC`)
      .limit(10);

    if (termRows.length === 0) {
      res.json({ papers: [] });
      return;
    }

    const queryStr = termRows.map((t) => t.term).join(" ");
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
