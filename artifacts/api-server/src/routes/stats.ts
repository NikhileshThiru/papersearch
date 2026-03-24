import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { indexStatsTable, documentsTable, termsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import { count } from "drizzle-orm";

const router: IRouter = Router();

router.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  const [docsRow] = await db.select({ total: count() }).from(documentsTable);
  const [termsRow] = await db.select({ total: count() }).from(termsTable);

  const statsRows = await db
    .select()
    .from(indexStatsTable)
    .where(
      inArray(indexStatsTable.key, [
        "avgdl_title",
        "avgdl_abstract",
        "last_indexed_at",
      ]),
    );

  const statsMap = Object.fromEntries(statsRows.map((r) => [r.key, r.value]));

  const lastIndexedAt =
    statsMap["last_indexed_at"] != null
      ? new Date(statsMap["last_indexed_at"] * 1000).toISOString()
      : null;

  const avgdlTitle = statsMap["avgdl_title"] ?? 0;
  const avgdlAbstract = statsMap["avgdl_abstract"] ?? 0;
  const avgdl = Number(((avgdlTitle + avgdlAbstract) / 2).toFixed(4));

  res.json({
    total_docs: docsRow?.total ?? 0,
    total_terms: termsRow?.total ?? 0,
    avgdl,
    avgdl_title: avgdlTitle,
    avgdl_abstract: avgdlAbstract,
    last_indexed_at: lastIndexedAt,
    totalDocs: docsRow?.total ?? 0,
    totalTerms: termsRow?.total ?? 0,
    avgdlTitle,
    avgdlAbstract,
    lastIndexedAt,
  });
});

export default router;
