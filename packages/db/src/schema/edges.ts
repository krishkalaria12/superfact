import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { assertions } from "./assertions.ts";

/**
 * Four verdicts. Nuance belongs in `reasonCode`; a fifth verdict costs precision on the three the
 * assignment actually asks about, and there is no labelled data to justify finer classes.
 */
export const edgeVerdict = pgEnum("edge_verdict", [
  "corroborates",
  "contradicts",
  "reconciles",
  "insufficient",
]);

/**
 * The nuance the retired seven-verdict enum tried to encode.
 *
 * `equivalent_value` and `attribution_mismatch` extend the plan's list: corroboration between two
 * differently-worded statements of the same number needs a code of its own, and the risk register
 * calls out attribution collapsing a forecast into a report of that forecast.
 */
export const edgeReasonCode = pgEnum("edge_reason_code", [
  "exact_duplicate",
  "equivalent_value",
  "time_supersession",
  "vintage_difference",
  "unit_mismatch",
  "scope_mismatch",
  "projection_vs_actual",
  "attribution_mismatch",
  "missing_context",
]);

/**
 * The system's interpretation of one pair of assertions. Interpretation lives here so assertion
 * rows can stay immutable — a re-run replaces edges and leaves the evidence untouched.
 *
 * `priorVerdict` and `priorExplanation` hold the first adjudication pass when the reversed-burden
 * second pass overturned it. A downgrade from `contradicts` to `reconciles` is the most
 * persuasive thing the product shows, and it is only legible if both passes survive.
 */
export const edges = pgTable(
  "edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceAssertionId: uuid("source_assertion_id")
      .notNull()
      .references(() => assertions.id, { onDelete: "cascade" }),
    targetAssertionId: uuid("target_assertion_id")
      .notNull()
      .references(() => assertions.id, { onDelete: "cascade" }),

    verdict: edgeVerdict("verdict").notNull(),
    reasonCode: edgeReasonCode("reason_code").notNull(),
    // Which of entity, time, scope, unit, modality, and attribution lined up, and which did not.
    // A contradiction is only allowed to stand when the decisive fields are in `matchedFields`.
    matchedFields: text("matched_fields").array().notNull().default([]),
    mismatchedFields: text("mismatched_fields").array().notNull().default([]),
    // A short comparison, never raw chain-of-thought.
    explanation: text("explanation").notNull(),
    confidence: doublePrecision("confidence"),

    priorVerdict: edgeVerdict("prior_verdict"),
    priorExplanation: text("prior_explanation"),

    pipelineVersion: text("pipeline_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Direction carries meaning — `time_supersession` says which side supersedes — so the pair is
    // stored ordered and the writer is responsible for picking the order.
    uniqueIndex("edges_pair_idx").on(table.sourceAssertionId, table.targetAssertionId),
    index("edges_source_idx").on(table.sourceAssertionId),
    index("edges_target_idx").on(table.targetAssertionId),
    index("edges_verdict_idx").on(table.verdict),
  ],
);

export type Edge = typeof edges.$inferSelect;
export type NewEdge = typeof edges.$inferInsert;
export type EdgeVerdict = (typeof edgeVerdict.enumValues)[number];
export type EdgeReasonCode = (typeof edgeReasonCode.enumValues)[number];
