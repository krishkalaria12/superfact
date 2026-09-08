import { tokenAffinity } from "./predicates.ts";
import type {
  CandidatePair,
  PairingAssertion,
  PairingExclusion,
  PairingExclusionReason,
  PairingOptions,
  PairingPath,
  PairingResult,
  RetrievedPair,
} from "./types.ts";
import { canonicalValuesEqual, unitsComparable, valueTypesCompatible } from "./values.ts";

/** How many neighbours the semantic path asks pgvector for, per assertion. */
export const DEFAULT_TOP_K = 20;

/** Below this cosine similarity a vector neighbour is noise rather than the same claim reworded. */
export const DEFAULT_MIN_SEMANTIC_SIMILARITY = 0.5;

/** Predicate affinity a value match needs before it counts as more than a numeric coincidence. */
export const DEFAULT_MIN_PREDICATE_RELATION = 0.5;

/** A semantic neighbour with no useful lexical anchor must clear this stronger vector threshold. */
export const DEFAULT_STRONG_SEMANTIC_SIMILARITY = 0.72;

/**
 * Deterministic matches rank above semantic-only pairs so inspection remains stable and the most
 * concrete relationships appear first. Ranking affects order only; every surviving pair proceeds.
 */
const DETERMINISTIC_FLOOR = 0.75;
const SEMANTIC_CEILING = 0.7;
const GENERIC_PREDICATE =
  /^(?:has|have|had|is|are|was|were|includes?|contains?|lists?|shows?|uses?|provides?|represents?|label|value)$/i;

function pairKey(left: string, right: string): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

type Merged = {
  sourceAssertionId: string;
  targetAssertionId: string;
  paths: Set<PairingPath>;
  similarity: number | null;
};

class ExclusionLog {
  private readonly entries = new Map<string, PairingExclusion>();

  record(assertionId: string, reason: PairingExclusionReason, score: number): void {
    const key = `${assertionId} ${reason}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.count += 1;
      existing.bestScore = Math.max(existing.bestScore, score);
      return;
    }
    this.entries.set(key, { assertionId, reason, count: 1, bestScore: score });
  }

  get total(): number {
    return [...this.entries.values()].reduce((sum, entry) => sum + entry.count, 0);
  }

  toArray(): PairingExclusion[] {
    return [...this.entries.values()].sort(
      (a, b) => b.bestScore - a.bestScore || b.count - a.count,
    );
  }
}

/**
 * Turns both retrieval paths into the pairs worth adjudicating.
 *
 * Pure by design -- the two paths hand in ids, this decides what survives -- so the prefilter the
 * whole phase rests on can be read and tested without a database or a model behind it.
 *
 * The prefilter drops on two grounds only: incompatible value types, and predicates too unrelated
 * to be talking about the same thing. It never drops on a difference of time, unit, or scope. Those
 * differences are not noise to filter out; they are the reconciliations phase 07 exists to explain,
 * and a prefilter that removed them would leave the adjudicator nothing but easy pairs.
 */
export function buildCandidatePairs(input: {
  focus: readonly PairingAssertion[];
  corpus: readonly PairingAssertion[];
  retrieved: readonly RetrievedPair[];
  options?: PairingOptions;
}): PairingResult {
  const minSimilarity = input.options?.minSemanticSimilarity ?? DEFAULT_MIN_SEMANTIC_SIMILARITY;
  const minRelation = input.options?.minPredicateRelation ?? DEFAULT_MIN_PREDICATE_RELATION;

  const byId = new Map<string, PairingAssertion>(
    [...input.focus, ...input.corpus].map((assertion) => [assertion.id, assertion]),
  );
  const excluded = new ExclusionLog();

  // Union first. A pair both paths found is one pair carrying both, not two rows racing for a slot.
  const merged = new Map<string, Merged>();
  for (const proposal of input.retrieved) {
    if (proposal.sourceAssertionId === proposal.targetAssertionId) continue;

    const key = pairKey(proposal.sourceAssertionId, proposal.targetAssertionId);
    const existing = merged.get(key);
    if (existing) {
      existing.paths.add(proposal.path);
      existing.similarity = Math.max(existing.similarity ?? 0, proposal.similarity ?? 0) || null;
      continue;
    }
    merged.set(key, {
      sourceAssertionId: proposal.sourceAssertionId,
      targetAssertionId: proposal.targetAssertionId,
      paths: new Set([proposal.path]),
      similarity: proposal.similarity,
    });
  }

  const kept = new Map<string, CandidatePair[]>();

  for (const [key, pair] of merged) {
    const source = byId.get(pair.sourceAssertionId);
    const target = byId.get(pair.targetAssertionId);
    if (!source || !target) {
      excluded.record(pair.sourceAssertionId, "unknown_assertion", 0);
      continue;
    }

    // One document restating its own number is not a reconciliation. Cross-document pairs are what
    // the product is about, and an intra-document pair would spend the same adjudication budget.
    if (source.documentId === target.documentId) {
      excluded.record(source.id, "same_document", 0);
      continue;
    }

    const similarity = pair.similarity;
    const valuesEqual = canonicalValuesEqual(source, target);
    const comparableUnits = unitsComparable(source.unit, target.unit);
    const predicateRelation = tokenAffinity(source.predicate, target.predicate);
    const subjectRelation = tokenAffinity(source.subject, target.subject);
    const score = valuesEqual
      ? DETERMINISTIC_FLOOR +
        (1 - DETERMINISTIC_FLOOR) * ((predicateRelation + subjectRelation) / 2)
      : SEMANTIC_CEILING * (similarity ?? 0);

    if (!valueTypesCompatible(source.valueType, target.valueType)) {
      excluded.record(source.id, "value_type", score);
      continue;
    }

    const semanticSupport = pair.paths.has("semantic") && (similarity ?? 0) >= minSimilarity;
    const deterministicSupport = pair.paths.has("deterministic") && valuesEqual;

    if (!deterministicSupport && !semanticSupport) {
      // A deterministic proposal whose values do not actually compare means the retrieval query and
      // the normalizer disagree; naming it separately keeps that visible instead of blaming the
      // similarity floor for it.
      const reason: PairingExclusionReason =
        pair.paths.has("deterministic") && !valuesEqual ? "value_mismatch" : "similarity_floor";
      excluded.record(source.id, reason, score);
      continue;
    }

    // Weak vector similarity between generic phrases is the main source of cross-domain noise.
    // Keep lexical paraphrases at the normal floor, and keep genuinely strong vector matches even
    // when they share no words. A merely nearby embedding must have an anchor in either the subject
    // or predicate before it consumes an adjudication call.
    const genericPredicate =
      GENERIC_PREDICATE.test(source.predicate.trim()) ||
      GENERIC_PREDICATE.test(target.predicate.trim());
    const hasClaimAnchor =
      subjectRelation >= 0.25 || (!genericPredicate && predicateRelation >= minRelation);
    if (
      semanticSupport &&
      !deterministicSupport &&
      !hasClaimAnchor &&
      (similarity ?? 0) < DEFAULT_STRONG_SEMANTIC_SIMILARITY
    ) {
      excluded.record(source.id, "claim_relation", score);
      continue;
    }

    // An exact value match between unrelated predicates is arithmetic, not agreement. The semantic
    // path can still rescue the pair on its own evidence.
    if (deterministicSupport && !semanticSupport && predicateRelation < minRelation) {
      excluded.record(source.id, "predicate", score);
      continue;
    }

    const paths: PairingPath[] = [];
    if (deterministicSupport) paths.push("deterministic");
    if (semanticSupport) paths.push("semantic");

    const candidate: CandidatePair = {
      key,
      sourceAssertionId: source.id,
      targetAssertionId: target.id,
      paths,
      similarity,
      valuesEqual,
      unitsComparable: comparableUnits,
      predicateRelation,
      score,
    };

    const bucket = kept.get(source.id);
    if (bucket) bucket.push(candidate);
    else kept.set(source.id, [candidate]);
  }

  const pairs = [...kept.values()].flat();
  pairs.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  return {
    pairs,
    excluded: excluded.toArray(),
    stats: {
      focus: input.focus.length,
      corpus: input.corpus.length,
      retrieved: input.retrieved.length,
      deterministic: pairs.filter((pair) => pair.paths.includes("deterministic")).length,
      semantic: pairs.filter((pair) => pair.paths.includes("semantic")).length,
      pairs: pairs.length,
      capped: 0,
      dropped: excluded.total,
    },
  };
}
