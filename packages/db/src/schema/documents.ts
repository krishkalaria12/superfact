import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const documentStatus = pgEnum("document_status", ["pending", "parsing", "ready", "failed"]);

/**
 * Why a document produced nothing. Stable codes rather than prose, because the failures view
 * groups by them and the reviewer's first question about a refusal is which kind it was.
 *
 * `scanned_unsupported` is the one the plan names outright: a PDF with no text layer is refused
 * whole instead of half-parsed into assertions nothing can ground.
 */
export const documentFailureReason = pgEnum("document_failure_reason", [
  "not_a_pdf",
  "encrypted",
  "corrupted",
  "scanned_unsupported",
  "parse_failed",
]);

/**
 * One uploaded PDF.
 *
 * `contentHash` is unique, so re-uploading the same bytes resolves to this row instead of a second
 * one — the anchor for the reuse phase 08 builds on. `pipelineVersion` records the version that
 * last processed the document and stays null until a run completes, which is how a stale document
 * is told from an unprocessed one.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentHash: text("content_hash").notNull().unique(),
    filename: text("filename").notNull(),
    byteSize: integer("byte_size").notNull(),
    pageCount: integer("page_count"),
    storageKey: text("storage_key").notNull(),
    storageUrl: text("storage_url").notNull(),
    status: documentStatus("status").notNull().default("pending"),
    failureReason: documentFailureReason("failure_reason"),
    failureDetail: text("failure_detail"),
    pipelineVersion: text("pipeline_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("documents_status_idx").on(table.status)],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
export type DocumentFailureReason = (typeof documentFailureReason.enumValues)[number];
