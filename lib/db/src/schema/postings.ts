import { pgTable, integer, varchar, real, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { termsTable } from "./terms";
import { documentsTable } from "./documents";

export const postingsTable = pgTable(
  "postings",
  {
    term_id: integer("term_id")
      .notNull()
      .references(() => termsTable.id),
    doc_id: integer("doc_id")
      .notNull()
      .references(() => documentsTable.id),
    field: varchar("field", { length: 32 }).notNull(),
    tf: real("tf").notNull(),
    positions: integer("positions").array(),
  },
  (table) => [primaryKey({ columns: [table.term_id, table.doc_id, table.field] })],
);

export const insertPostingSchema = createInsertSchema(postingsTable);

export type InsertPosting = z.infer<typeof insertPostingSchema>;
export type Posting = typeof postingsTable.$inferSelect;
