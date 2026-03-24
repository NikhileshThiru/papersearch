import { pgTable, varchar, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Key/value store for running index statistics.
 *
 * Known keys and their value encodings:
 *   total_docs      — integer count of indexed documents
 *   avgdl_title     — average token count of title fields (float)
 *   avgdl_abstract  — average token count of abstract fields (float)
 *   last_indexed_at — Unix epoch seconds (float) representing the last index run
 *
 * All numeric values (including timestamps) are stored as `real` for simplicity.
 * Callers should convert `last_indexed_at` to a Date via `new Date(value * 1000)`.
 */
export const indexStatsTable = pgTable("index_stats", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: real("value").notNull(),
});

export const insertIndexStatSchema = createInsertSchema(indexStatsTable);

export type InsertIndexStat = z.infer<typeof insertIndexStatSchema>;
export type IndexStat = typeof indexStatsTable.$inferSelect;
