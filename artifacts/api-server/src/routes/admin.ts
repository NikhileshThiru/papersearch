import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import { db } from "@workspace/db";
import { queryLogsTable, documentsTable } from "@workspace/db/schema";
import { isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth.js";
import { GetQueryLogsQueryParams } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get(
  "/admin/query-logs",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GetQueryLogsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", message: parsed.error.message });
      return;
    }

    const { page, pageSize } = parsed.data;
    const offset = (page - 1) * pageSize;

    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(queryLogsTable);

    const logs = await db
      .select()
      .from(queryLogsTable)
      .orderBy(sql`created_at DESC`)
      .limit(pageSize)
      .offset(offset);

    res.json({
      total,
      page,
      pageSize,
      logs: logs.map((l) => ({
        id: l.id,
        userId: l.user_id,
        query: l.query,
        filters: l.filters,
        resultCount: l.result_count,
        latencyMs: l.latency_ms,
        createdAt: l.created_at?.toISOString() ?? null,
      })),
    });
  },
);

router.post(
  "/admin/reindex",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(documentsTable)
      .where(isNull(documentsTable.indexed_at));

    if (count === 0) {
      res.status(202).json({ message: "No documents need reindexing.", queued: 0 });
      return;
    }

    try {
      const child = spawn(
        "pnpm",
        ["--filter", "@workspace/scripts", "run", "index-documents"],
        {
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        },
      );
      child.unref();

      logger.info({ queued: count }, "Reindex triggered");

      res.status(202).json({
        message: `Reindex started for ${count} document(s).`,
        queued: count,
      });
    } catch (err) {
      logger.error({ err }, "Failed to spawn reindex process");
      res.status(500).json({ error: "internal_error", message: "Failed to start reindex" });
    }
  },
);

export default router;
