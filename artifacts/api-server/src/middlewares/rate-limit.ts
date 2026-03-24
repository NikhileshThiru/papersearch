import { type Request, type Response, type NextFunction } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

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

export function rateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const key = getRateLimitKey(req);
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let timestamps = requestLog.get(key) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);

  if (timestamps.length >= MAX_REQUESTS) {
    const oldest = timestamps[0] ?? now;
    const retryAfterMs = WINDOW_MS - (now - oldest);
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    res.setHeader("Retry-After", retryAfterSec);
    res.status(429).json({
      error: "rate_limit_exceeded",
      retryAfter: retryAfterSec,
    });
    return;
  }

  timestamps.push(now);
  requestLog.set(key, timestamps);

  next();
}
