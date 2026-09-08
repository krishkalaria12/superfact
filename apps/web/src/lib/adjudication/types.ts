import type { ComparisonField, PublishedAssertion } from "@superfact/db/contracts";
import type { EdgeReasonCode, EdgeVerdict } from "@superfact/db/schema/edges";
import type { z } from "zod";

/**
 * Adjudication reads whole published assertions, not the narrow projection pairing used.
 *
 * Retrieval only had to decide whether a pair was worth judging, so it read values and predicates.
 * Judging needs everything the document said: both evidence quotes, both qualifier sets, both
 * periods, and modality and attribution above all. A forecast and a report of that forecast are
 * different claims, and the fields that say so have to be in front of the model.
 */
export type AdjudicationAssertion = PublishedAssertion;

/** One pair, as adjudication receives it from the pairing stage. */
export type AdjudicationPair = {
  source: AdjudicationAssertion;
  target: AdjudicationAssertion;
};

/**
 * What code worked out about a pair before any model saw it.
 *
 * A field lands in `matched`, in `mismatched`, or in neither. That third state is the load-bearing
 * one: "these periods differ" and "one of these has no period" are different situations, and
 * collapsing them would let a contradiction be declared over a qualifier nobody ever compared.
 */
export type DeterministicComparison = {
  matched: ComparisonField[];
  mismatched: ComparisonField[];
  /** Fields no rule could compare, because one side or both said nothing about them. */
  unknown: ComparisonField[];
  /** Both canonical numbers present and equal within tolerance. */
  valuesEqual: boolean;
  /** Both canonical numbers present and pointing the same way. Null when either is absent. */
  sameSign: boolean | null;
  /** |a - b| / max(|a|, |b|). Null unless both sides normalized to a number. */
  relativeDelta: number | null;
  /** Both periods present and sharing at least one day. Null when either period is absent. */
  periodsOverlap: boolean | null;
  /** Set when code settled the pair outright and no model call is needed. */
  settled: { verdict: EdgeVerdict; reasonCode: EdgeReasonCode; explanation: string } | null;
};

export type AdjudicationRequest<T> = {
  name: "pair_adjudication" | "contradiction_review";
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /**
   * Raise the reasoning budget. Set for the contradiction second pass and nothing else: escalation
   * answers to one condition rather than to a general risk score.
   */
  escalate?: boolean;
};

export interface AdjudicationModel {
  generate<T>(request: AdjudicationRequest<T>): Promise<unknown>;
}

/** Why a pair produced no edge. Every one of these is counted and logged, never swallowed. */
export type AdjudicationSkipReason =
  | "unknown_assertion"
  | "not_published"
  | "invalid_output"
  | "model_error";

export type AdjudicationSkip = {
  pairKey: string;
  reason: AdjudicationSkipReason;
  detail: string;
};

export type AdjudicationStats = {
  pairs: number;
  settled: number;
  judged: number;
  reviewed: number;
  downgraded: number;
  withheld: number;
  corroborates: number;
  contradicts: number;
  reconciles: number;
  insufficient: number;
  skipped: number;
};
