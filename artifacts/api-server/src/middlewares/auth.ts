import { type Request, type Response, type NextFunction } from "express";
import * as jose from "jose";
import { logger } from "../lib/logger";

export interface AuthUser {
  userId: number;
  email: string;
  plan: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getJwtSecret(): Uint8Array {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("JWT_SECRET environment variable is required in production");
    }
    return new TextEncoder().encode("papersearch-dev-secret-DO-NOT-USE-IN-PRODUCTION");
  }
  return new TextEncoder().encode(secret);
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next();
  }
  const token = header.slice(7);
  try {
    const secret = getJwtSecret();
    const { payload } = await jose.jwtVerify(token, secret);
    req.user = {
      userId: payload["userId"] as number,
      email: payload["email"] as string,
      plan: payload["plan"] as string,
    };
  } catch (err) {
    logger.warn({ err }, "Invalid JWT — continuing as anonymous");
  }
  next();
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Missing Bearer token" });
    return;
  }
  const token = header.slice(7);
  try {
    const secret = getJwtSecret();
    const { payload } = await jose.jwtVerify(token, secret);
    req.user = {
      userId: payload["userId"] as number,
      email: payload["email"] as string,
      plan: payload["plan"] as string,
    };
    next();
  } catch (err) {
    logger.warn({ err }, "JWT verification failed");
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
  }
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, async () => {
    if (req.user?.plan !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Admin access required" });
      return;
    }
    next();
  });
}

export function signToken(payload: AuthUser): Promise<string> {
  const secret = getJwtSecret();
  return new jose.SignJWT({
    userId: payload.userId,
    email: payload.email,
    plan: payload.plan,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}
