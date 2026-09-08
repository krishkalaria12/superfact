import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import type { Bbox } from "../contracts/geometry.ts";
import type { Qualifiers, TableContext } from "../contracts/context.ts";
import { documents } from "./documents.ts";
import { pages } from "./pages.ts";

/**
 * Two values, not five. "GDP will be 6.5%" and "the RBI projects 6.5%" share a modality and
 * differ in attribution, so attribution gets its own column instead of a modality value.
 */
export const assertionModality = pgEnum("assertion_modality", ["observed", "projected"]);

/** Whether the claim came out of running prose or out of a reconstructed table cell. */
export const assertionSource = pgEnum("assertion_source", ["prose", "table"]);

/** Two publication states. A rejection is stored with its reason, never silently dropped. */
export const assertionStatus = pgEnum("assertion_status", ["published", "rejected"]);

/**
 * Why the grounding gate refused to publish. The first two are the deterministic verbatim gate,
 * the third the context-completeness gate, the last two the normalizer.
 */
export const assertionRejectionReason = pgEnum("assertion_rejection_reason", [
  "quote_not_found",
  "line_not_found",
  "missing_context",
  "value_not_in_source",
  "normalization_failed",
]);

/**
 * What kind of thing the value is. The pairing prefilter drops pairs across incompatible types
 * before a model is asked anything, which is most of what makes phase 06 tractable.
 */
export const valueType = pgEnum("value_type", [
  "money",
  "percent",
  "number",
  "date",
  "duration",
  "text",
]);

/**
 * How wide the period is. Time is stored as an interval plus its precision so a fiscal year, a
 * quarter, and a calendar year stay comparable instead of collapsing to one date.
 */
export const periodPrecision = pgEnum("period_precision", [
  "day",
  "month",
  "quarter",
  "half_year",
  "fiscal_year",
  "year",
]);

/**
 * One proposition, as one document stated it once.
 *
 * Rows are immutable and per-occurrence: two documents saying the identical thing produce two
 * rows, and whether they agree is a question for `edges`. Nothing here is ever rewritten to
 * reflect an interpretation.
 *
 * `verified` and `contextComplete` are deterministic — the verbatim gate and the
 * context-completeness gate set them, no model involved — and both must be true for
 * `status` to be `published`.
 */
export const assertions = pgTable(
  "assertions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // Denormalized from `pages` so an exported fact reads without a join.
    pageNumber: integer("page_number").notNull(),

    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),

    // What the document printed, kept beside what the normalizer made of it. Losing `rawValue`
    // would make a published fact unauditable against its own page.
    rawValue: text("raw_value").notNull(),
    canonicalValue: text("canonical_value"),
    // Set only for types that compare numerically; the deterministic pairing path reads it.
    canonicalNumber: doublePrecision("canonical_number"),
    unit: text("unit"),
    valueType: valueType("value_type").notNull().default("text"),
    // Which converter produced `canonicalValue`, so a wrong scale is traceable to one rule.
    normalizationRule: text("normalization_rule"),

    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    periodPrecision: periodPrecision("period_precision"),

    // Keys are named by the model per document, not fixed by this schema: a macro report yields
    // `fiscal_year` and `geography` where Delhivery yields `segment` and `quarter`.
    qualifiers: jsonb("qualifiers").$type<Qualifiers>().notNull().default({}),
    modality: assertionModality("modality").notNull().default("observed"),
    attributedTo: text("attributed_to"),

    source: assertionSource("source").notNull().default("prose"),
    // A number becomes an assertion only with its table title, headers, and unit attached.
    tableContext: jsonb("table_context").$type<TableContext>(),

    evidenceQuote: text("evidence_quote").notNull(),
    // The union of the cited lines' boxes. Per-line boxes stay recoverable from `pages.lines`.
    evidenceBbox: jsonb("evidence_bbox").$type<Bbox>(),
    evidenceLineIds: text("evidence_line_ids").array().notNull(),

    verified: boolean("verified").notNull().default(false),
    contextComplete: boolean("context_complete").notNull().default(false),
    status: assertionStatus("status").notNull().default("rejected"),
    rejectionReason: assertionRejectionReason("rejection_reason"),
    rejectionDetail: text("rejection_detail"),

    // The extractor's own score, and how prominent the claim is in its document. Neither ever
    // decides a verdict; ranking the fact list is all they are for. Double precision because
    // float4 does not survive a write-then-read intact, and a score that drifts is a score
    // nobody trusts.
    confidence: doublePrecision("confidence"),
    salience: doublePrecision("salience"),

    // Subject and predicate text only. Numbers never go through vectors.
    embedding: vector("embedding", { dimensions: 1536 }),

    pipelineVersion: text("pipeline_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("assertions_document_id_idx").on(table.documentId),
    index("assertions_page_id_idx").on(table.pageId),
    index("assertions_subject_idx").on(table.subject),
    index("assertions_predicate_idx").on(table.predicate),
    index("assertions_status_idx").on(table.status),
    // No HNSW index. Exact search is fine at this scale; add one when something is actually slow.
  ],
);

export type Assertion = typeof assertions.$inferSelect;
export type NewAssertion = typeof assertions.$inferInsert;
export type AssertionModality = (typeof assertionModality.enumValues)[number];
export type AssertionSource = (typeof assertionSource.enumValues)[number];
export type AssertionStatus = (typeof assertionStatus.enumValues)[number];
export type AssertionRejectionReason = (typeof assertionRejectionReason.enumValues)[number];
export type ValueType = (typeof valueType.enumValues)[number];
export type PeriodPrecision = (typeof periodPrecision.enumValues)[number];

/** Embedding width, fixed at schema time. Changing it means a migration and a full re-embed. */
export const EMBEDDING_DIMENSIONS = 1536;
