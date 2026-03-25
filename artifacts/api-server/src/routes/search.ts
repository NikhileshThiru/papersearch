import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { queryLogsTable, termsTable, postingsTable } from "@workspace/db/schema";
import { sql, like, eq, and } from "drizzle-orm";
import natural from "natural";
import { search } from "../lib/search.js";
import { optionalAuth } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rate-limit.js";
import { SearchPapersQueryParams, SuggestTermsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get(
  "/search",
  rateLimit,
  optionalAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SearchPapersQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: parsed.error.message });
      return;
    }

    const { q, page, pageSize, yearFrom, yearTo, fieldOfStudy, minCitations } = parsed.data;

    if (!q || q === "undefined") {
      res.status(400).json({ error: "validation_error", message: "Query parameter 'q' is required" });
      return;
    }

    const start = Date.now();

    const result = await search(q, {
      page,
      pageSize,
      yearFrom,
      yearTo,
      fieldOfStudy,
      minCitations,
    });

    const latencyMs = Date.now() - start;

    db.insert(queryLogsTable)
      .values({
        user_id: req.user?.userId ?? null,
        query: q,
        filters: { yearFrom, yearTo, fieldOfStudy, minCitations },
        result_count: result.total,
        latency_ms: latencyMs,
      })
      .execute()
      .catch(() => {});

    const serialized = result.results.map((r) => ({
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

    res.json({
      query: q,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      results: serialized,
      suggestion: result.suggestion ?? null,
      latencyMs,
    });
  },
);

router.get(
  "/search/suggest",
  rateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SuggestTermsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: parsed.error.message });
      return;
    }

    const { q } = parsed.data;
    const raw = q.trim().toLowerCase();

    if (!raw) {
      res.json({ suggestions: [] });
      return;
    }

    const stemmed = natural.PorterStemmer.stem(raw);

    const rows = await db
      .selectDistinct({
        term: termsTable.term,
        display_term: termsTable.display_term,
        doc_freq: termsTable.doc_freq,
      })
      .from(termsTable)
      .innerJoin(postingsTable, eq(postingsTable.term_id, termsTable.id))
      .where(
        and(
          like(termsTable.term, `${stemmed}%`),
          eq(postingsTable.field, "title"),
        ),
      )
      .orderBy(sql`${termsTable.doc_freq} DESC`)
      .limit(10);

    res.json({ suggestions: rows.map((r) => r.display_term ?? r.term) });
  },
);

export default router;
