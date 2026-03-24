import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createClient } from "redis";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function checkDb(): Promise<"ok" | "error"> {
  try {
    await db.execute(sql`SELECT 1`);
    return "ok";
  } catch {
    return "error";
  }
}

async function checkRedis(): Promise<"ok" | "error" | "not_configured"> {
  const redisUrl =
    process.env["REDIS_URL"] ??
    process.env["REDIS_TLS_URL"] ??
    process.env["REDIS_PRIVATE_URL"];

  if (!redisUrl) {
    return "not_configured";
  }

  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();
    await client.ping();
    return "ok";
  } catch (err) {
    logger.warn({ err }, "Redis health check failed");
    return "error";
  } finally {
    try {
      await client?.disconnect();
    } catch {
    }
  }
}

async function healthCheck(_req: Request, res: Response): Promise<void> {
  const [dbStatus, redisStatus] = await Promise.all([checkDb(), checkRedis()]);

  const overallStatus =
    dbStatus === "ok" && redisStatus !== "error" ? "ok" : "degraded";

  res.json({
    status: overallStatus,
    db: dbStatus,
    redis: redisStatus,
  });
}

router.get("/healthz", healthCheck);
router.get("/health", healthCheck);

export default router;
