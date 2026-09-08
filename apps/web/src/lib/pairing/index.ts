export {
  buildCandidatePairs,
  DEFAULT_MAX_PAIRS_PER_ASSERTION,
  DEFAULT_MIN_PREDICATE_RELATION,
  DEFAULT_MIN_SEMANTIC_SIMILARITY,
  DEFAULT_TOP_K,
} from "./pair";
export { pairDocument, type PairingRun } from "./pair-document";
export { tokenAffinity } from "./predicates";
export {
  DETERMINISTIC_ROW_LIMIT,
  readAssertionsById,
  readAssertionsMissingEmbedding,
  readFocusAssertions,
  retrieveDeterministic,
  retrieveSemantic,
  writeAssertionEmbeddings,
} from "./retrieval";
export type {
  CandidatePair,
  PairingAssertion,
  PairingExclusion,
  PairingExclusionReason,
  PairingOptions,
  PairingPath,
  PairingResult,
  PairingStats,
  RetrievedPair,
} from "./types";
export { canonicalValuesEqual, unitsComparable, valueTypesCompatible } from "./values";
