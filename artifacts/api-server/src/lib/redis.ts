import { createClient } from "redis";
import { logger } from "./logger.js";

type RedisClient = ReturnType<typeof createClient>;

let _client: RedisClient | null = null;

export function getRedisClient(): RedisClient | null {
  return _client;
}

export async function connectRedis(): Promise<void> {
  const url =
    process.env["REDIS_URL"] ??
    process.env["REDIS_TLS_URL"] ??
    process.env["REDIS_PRIVATE_URL"];

  if (!url) {
    logger.info("REDIS_URL not set — Redis disabled (rate limiting uses in-memory fallback)");
    return;
  }

  try {
    const client = createClient({ url });
    client.on("error", (err) => {
      logger.warn({ err }, "Redis client error");
    });
    await client.connect();
    _client = client;
    logger.info("Redis connected");
  } catch (err) {
    logger.warn({ err }, "Redis connection failed — rate limiting will use in-memory fallback");
  }
}

export async function disconnectRedis(): Promise<void> {
  if (_client) {
    await _client.disconnect();
    _client = null;
  }
}
