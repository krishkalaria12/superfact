export {
  buildCandidatePairs,
  DEFAULT_MIN_PREDICATE_RELATION,
  DEFAULT_MIN_SEMANTIC_SIMILARITY,
  DEFAULT_TOP_K,
} from "./pair.ts";
export { pairDocument, type PairingRun } from "./pair-document.ts";
export { tokenAffinity } from "./predicates.ts";
export {
  readAssertionsById,
  readAssertionsMissingEmbedding,
  readFocusAssertions,
  retrieveDeterministic,
  retrieveSemantic,
  writeAssertionEmbeddings,
} from "./retrieval.ts";
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
} from "./types.ts";
export { canonicalValuesEqual, unitsComparable, valueTypesCompatible } from "./values.ts";
