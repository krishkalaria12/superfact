import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { PageQuality } from "../contracts/pages.ts";
import type { ColumnBand, ReconstructedTable } from "../contracts/tables.ts";
import type { ParsedLine } from "../contracts/geometry.ts";
import { documents } from "./documents.ts";

export const pageStatus = pgEnum("page_status", ["parsed", "failed"]);

export const pageFailureReason = pgEnum("page_failure_reason", [
  "no_text_layer",
  "parse_failed",
  "render_failed",
]);

/**
 * One page of one document: the text the verbatim gate searches, the line geometry the evidence
 * viewer draws from, and the raster it draws onto.
 *
 * A failed page keeps its row and marks itself failed. Erasing it would let a document report
 * whole-document success over a hole, which the plan forbids.
 */
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    // Page box in PDF points. The raster is this box times `rasterScale`.
    width: doublePrecision("width"),
    height: doublePrecision("height"),
    text: text("text").notNull().default(""),
    lines: jsonb("lines").$type<ParsedLine[]>().notNull().default([]),
    // Reconstructed here rather than at extraction, because the geometry that resolves a grid is
    // gone by the time a page is only text. A ragged table keeps its box and drops its rows.
    bands: jsonb("bands").$type<ColumnBand[]>().notNull().default([]),
    tables: jsonb("tables").$type<ReconstructedTable[]>().notNull().default([]),
    // Recorded, not assumed: the viewer scales stored boxes by exactly this number.
    rasterKey: text("raster_key"),
    rasterUrl: text("raster_url"),
    rasterScale: doublePrecision("raster_scale"),
    quality: jsonb("quality").$type<PageQuality>(),
    status: pageStatus("status").notNull().default("parsed"),
    failureReason: pageFailureReason("failure_reason"),
    failureDetail: text("failure_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pages_document_page_idx").on(table.documentId, table.pageNumber),
    index("pages_status_idx").on(table.status),
  ],
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type PageStatus = (typeof pageStatus.enumValues)[number];
export type PageFailureReason = (typeof pageFailureReason.enumValues)[number];
