import { type Request, type Response, type NextFunction } from "express";
import { getRedisClient } from "../lib/redis.js";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

// ---------------------------------------------------------------------------
// In-memory fallback (used when Redis is unavailable)
// ---------------------------------------------------------------------------

const requestLog = new Map<string, number[]>();

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of requestLog) {
    const trimmed = timestamps.filter((t) => t > cutoff);
    if (trimmed.length === 0) {
      requestLog.delete(key);
    } else {
      requestLog.set(key, trimmed);
    }
  }
}, WINDOW_MS);

function memoryCheck(key: string): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = requestLog.get(key) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);

  if (timestamps.length >= MAX_REQUESTS) {
    const oldest = timestamps[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    requestLog.set(key, timestamps);
    return { limited: true, retryAfter };
  }

  timestamps.push(now);
  requestLog.set(key, timestamps);
  return { limited: false, retryAfter: 0 };
}

// ---------------------------------------------------------------------------
// Redis sliding-window using a sorted set
//
// Pipeline:
//   ZREMRANGEBYSCORE key 0 (now - window)  — evict expired entries
//   ZCARD key                               — count requests in window
//   ZADD key score member                   — record this request
//   EXPIRE key window_seconds               — auto-cleanup idle keys
//
// ZCARD is evaluated *before* the ZADD so the limit check is on the count
// prior to the current request (consistent with the in-memory behaviour).
// ---------------------------------------------------------------------------

async function redisCheck(key: string): Promise<{ limited: boolean; retryAfter: number }> {
  const redis = getRedisClient();
  if (!redis) return memoryCheck(key);

  const redisKey = `ratelimit:${key}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const results = await redis
      .multi()
      .zRemRangeByScore(redisKey, 0, windowStart)
      .zCard(redisKey)
      .zAdd(redisKey, { score: now, value: `${now}:${Math.random()}` })
      .expire(redisKey, Math.ceil(WINDOW_MS / 1000))
      .exec();

    const count = (results?.[1] ?? 0) as number;

    if (count >= MAX_REQUESTS) {
      return { limited: true, retryAfter: Math.ceil(WINDOW_MS / 1000) };
    }
    return { limited: false, retryAfter: 0 };
  } catch {
    // Redis error — degrade gracefully to in-memory
    return memoryCheck(key);
  }
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

function getRateLimitKey(req: Request): string {
  const apiKeyHeader = req.headers["x-api-key"];
  if (apiKeyHeader && typeof apiKeyHeader === "string") {
    return `apikey:${apiKeyHeader}`;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return `token:${authHeader.slice(7, 39)}`;
  }

  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return `ip:${ip}`;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function rateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = getRateLimitKey(req);
  const { limited, retryAfter } = await redisCheck(key);

  if (limited) {
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({ error: "rate_limit_exceeded", retryAfter });
    return;
  }

  next();
}
