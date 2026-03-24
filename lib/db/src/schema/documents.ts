import { pgTable, serial, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  paper_id: varchar("paper_id", { length: 64 }).unique().notNull(),
  title: text("title").notNull(),
  abstract: text("abstract"),
  authors: jsonb("authors").$type<Array<{ name: string; id?: string }>>(),
  year: integer("year"),
  venue: varchar("venue", { length: 512 }),
  citation_count: integer("citation_count").default(0),
  fields_of_study: jsonb("fields_of_study").$type<string[]>(),
  external_ids: jsonb("external_ids").$type<Record<string, string>>(),
  /**
   * NULL until the document has been run through the inverted index builder.
   * The indexer sets this to NOW() inside the same transaction as posting inserts,
   * so `indexed_at IS NULL` is a reliable marker for "needs indexing."
   * Zero-token documents are also marked with indexed_at = NOW() to prevent
   * infinite reprocessing.
   */
  indexed_at: timestamp("indexed_at"),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  indexed_at: true,
});

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
