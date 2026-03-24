import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const queryLogsTable = pgTable("query_logs", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").references(() => usersTable.id),
  query: text("query").notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>(),
  result_count: integer("result_count"),
  latency_ms: integer("latency_ms"),
  created_at: timestamp("created_at").defaultNow(),
});

export const insertQueryLogSchema = createInsertSchema(queryLogsTable).omit({
  id: true,
  created_at: true,
});

export type InsertQueryLog = z.infer<typeof insertQueryLogSchema>;
export type QueryLog = typeof queryLogsTable.$inferSelect;
