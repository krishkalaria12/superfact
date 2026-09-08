import type { ValueType } from "@superfact/db/schema/assertions";

/**
 * The columns pairing reads off an assertion. Deliberately narrow: retrieval never sees evidence,
 * qualifiers, or modality, because none of those decide whether a pair is worth judging — they
 * decide the verdict, which is phase 07's job.
 */
export type PairingAssertion = {
  id: string;
  documentId: string;
  subject: string;
  predicate: string;
  valueType: ValueType;
  unit: string | null;
  canonicalValue: string | null;
  canonicalNumber: number | null;
};

/** Which retrieval path proposed a pair. A pair found by both is the strongest kind there is. */
export type PairingPath = "deterministic" | "semantic";

/** One proposal from one path, before any prefilter has looked at it. */
export type RetrievedPair = {
  sourceAssertionId: string;
  targetAssertionId: string;
  path: PairingPath;
  /** Cosine similarity. Set by the semantic path only; the deterministic path has no opinion. */
  similarity: number | null;
};

/**
 * A pair the adjudicator will be asked about.
 *
 * `valuesEqual` and `unitsComparable` are reported separately on purpose. Two claims can carry the
 * same canonical number in different currencies, and that is a unit reconciliation rather than a
 * coincidence — collapsing the two flags into one would hide exactly the case phase 07 explains.
 */
export type CandidatePair = {
  /** The two ids sorted, so one pair has one identity whichever side retrieved it. */
  key: string;
  sourceAssertionId: string;
  targetAssertionId: string;
  paths: PairingPath[];
  similarity: number | null;
  valuesEqual: boolean;
  unitsComparable: boolean;
  predicateRelation: number;
  score: number;
};

/**
 * Why a proposed pair did not reach the adjudicator.
 *
 * `cap` is the one that matters most: a cap that keeps firing means the adjudicator is being
 * starved of pairs, which is the phase's named risk, and it is only visible if it is recorded.
 */
export type PairingExclusionReason =
  | "same_document"
  | "unknown_assertion"
  | "value_type"
  | "value_mismatch"
  | "predicate"
  | "similarity_floor"
  | "cap";

/** One reason, aggregated per assertion, so a run's exclusions stay a summary rather than a dump. */
export type PairingExclusion = {
  assertionId: string;
  reason: PairingExclusionReason;
  count: number;
  /** The highest score among the excluded, so a cap that cut something good is legible. */
  bestScore: number;
};

export type PairingStats = {
  focus: number;
  corpus: number;
  retrieved: number;
  deterministic: number;
  semantic: number;
  pairs: number;
  capped: number;
  dropped: number;
};

export type PairingResult = {
  pairs: CandidatePair[];
  excluded: PairingExclusion[];
  stats: PairingStats;
};

export type PairingOptions = {
  maxPairsPerAssertion?: number;
  minSemanticSimilarity?: number;
  minPredicateRelation?: number;
};
