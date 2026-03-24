import { pgTable, serial, varchar, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const termsTable = pgTable("terms", {
  id: serial("id").primaryKey(),
  term: varchar("term", { length: 256 }).unique().notNull(),
  doc_freq: integer("doc_freq").notNull(),
  idf: real("idf").notNull(),
});

export const insertTermSchema = createInsertSchema(termsTable).omit({ id: true });

export type InsertTerm = z.infer<typeof insertTermSchema>;
export type Term = typeof termsTable.$inferSelect;
