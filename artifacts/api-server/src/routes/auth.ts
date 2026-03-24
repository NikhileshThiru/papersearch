import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { signToken } from "../middlewares/auth";
import { RegisterBody, LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/register", async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { email, apiKey } = parsed.data;

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "conflict", message: "Email already registered" });
    return;
  }

  const api_key_hash = await bcrypt.hash(apiKey, 10);

  const [user] = await db
    .insert(usersTable)
    .values({ email, api_key_hash, plan: "free" })
    .returning();

  if (!user) {
    res.status(500).json({ error: "internal_error", message: "Failed to create user" });
    return;
  }

  const token = await signToken({
    userId: user.id,
    email: user.email,
    plan: user.plan ?? "free",
  });

  res.status(201).json({
    token,
    userId: user.id,
    email: user.email,
    plan: user.plan ?? "free",
  });
});

router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.message });
    return;
  }

  const { email, apiKey } = parsed.data;

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const user = users[0];
  if (!user) {
    res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(apiKey, user.api_key_hash);
  if (!valid) {
    res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
    return;
  }

  const token = await signToken({
    userId: user.id,
    email: user.email,
    plan: user.plan ?? "free",
  });

  res.json({
    token,
    userId: user.id,
    email: user.email,
    plan: user.plan ?? "free",
  });
});

export default router;
