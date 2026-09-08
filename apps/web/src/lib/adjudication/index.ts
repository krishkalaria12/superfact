export { adjudicatePairs, orderPair, type AdjudicationResult } from "./adjudicate.ts";
export { compareAssertions, DECISIVE_FIELDS } from "./compare.ts";
export {
  ADJUDICATION_SYSTEM_PROMPT,
  adjudicationPrompt,
  CONTRADICTION_REVIEW_SYSTEM_PROMPT,
  contradictionReviewPrompt,
} from "./prompts.ts";
export type {
  AdjudicationAssertion,
  AdjudicationModel,
  AdjudicationPair,
  AdjudicationRequest,
  AdjudicationSkip,
  AdjudicationSkipReason,
  AdjudicationStats,
  DeterministicComparison,
} from "./types.ts";
