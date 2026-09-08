import type { ClaimEdge, ComparisonField } from "@superfact/db/contracts";
import { comparisonFieldSchema, reasonCodeSchema, verdictSchema } from "@superfact/db/contracts";
import type { EdgeReasonCode } from "@superfact/db/schema/edges";
import { z } from "zod";

import { mapWithConcurrency } from "../concurrency.ts";
import { compareAssertions, DECISIVE_FIELDS } from "./compare.ts";
import {
  ADJUDICATION_SYSTEM_PROMPT,
  adjudicationPrompt,
  CONTRADICTION_REVIEW_SYSTEM_PROMPT,
  contradictionReviewPrompt,
} from "./prompts.ts";
import type {
  AdjudicationAssertion,
  AdjudicationModel,
  AdjudicationPair,
  AdjudicationSkip,
  AdjudicationStats,
  DeterministicComparison,
} from "./types.ts";

/** Pairs judged at once. Each is two model calls at worst, so this is the model's rate limit talking. */
const CONCURRENCY = 4;

/**
 * The model proposes an interpretation; this module decides what it is allowed to mean.
 *
 * A verdict of `contradicts` is the one the product is judged on, so it is the one code refuses to
 * take on trust. Deterministic comparison owns every claim about what differs, the model owns only
 * the reading of that difference, and a contradiction that cannot show matched decisive context is
 * withheld before it is ever written.
 */

const firstPassSchema = z.object({
  verdict: verdictSchema,
  reasonCode: reasonCodeSchema,
  /**
   * Fields the model can show line up from the two quotes. Consulted only where deterministic
   * comparison came back unknown; it can add context, never erase a difference code found.
   */
  contextMatches: z.array(comparisonFieldSchema),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
});

const reviewSchema = z.object({
  reconcilable: z.boolean(),
  reasonCode: reasonCodeSchema,
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
});

/**
 * Why a contradiction was withheld, named by the field that stopped it.
 *
 * Time is absent on purpose. Both time codes in the enum assert a relationship — one period
 * supersedes the other, or the vintages differ — and withholding a contradiction has established
 * neither. `missing_context` is the honest code for "we did not resolve when each was true".
 */
const WITHHELD_REASON: Partial<Record<ComparisonField, EdgeReasonCode>> = {
  unit: "unit_mismatch",
  scope: "scope_mismatch",
  modality: "projection_vs_actual",
  attribution: "attribution_mismatch",
};

/** Reason codes that say which side wins, so the stored pair has to be ordered to match. */
const DIRECTIONAL = new Set<EdgeReasonCode>([
  "time_supersession",
  "vintage_difference",
  "projection_vs_actual",
]);

type Judged = {
  edge: ClaimEdge;
  settled: boolean;
  reviewed: boolean;
  downgraded: boolean;
  /** The model said `contradicts` and the invariant refused it. Counted so the refusals are visible. */
  withheld: boolean;
};

type Resolved = {
  verdict: ClaimEdge["verdict"];
  reasonCode: EdgeReasonCode;
  matchedFields: ComparisonField[];
  mismatchedFields: ComparisonField[];
  explanation: string;
  confidence: number | null;
  priorPass: ClaimEdge["priorPass"];
};

function skip(
  pairKey: string,
  reason: AdjudicationSkip["reason"],
  error: unknown,
): AdjudicationSkip {
  return { pairKey, reason, detail: error instanceof Error ? error.message : String(error) };
}

/**
 * Which side of a directional relationship comes first.
 *
 * The edge table stores one row per ordered pair and `time_supersession` says which side supersedes,
 * so the order carries meaning and cannot be left to whichever document happened to be uploaded
 * second. Source is always the side that wins: the later period, or the observation over the
 * forecast. Non-directional codes order by id, which is arbitrary but stable — the same pair
 * produces the same row whichever document's run reaches it.
 */
export function orderPair(
  source: AdjudicationAssertion,
  target: AdjudicationAssertion,
  reasonCode: EdgeReasonCode,
): { first: AdjudicationAssertion; second: AdjudicationAssertion } {
  const ordered = { first: source, second: target };
  const swapped = { first: target, second: source };

  if (!DIRECTIONAL.has(reasonCode)) {
    return source.id < target.id ? ordered : swapped;
  }

  if (reasonCode === "projection_vs_actual") {
    if (source.modality === target.modality) return source.id < target.id ? ordered : swapped;
    return source.modality === "observed" ? ordered : swapped;
  }

  const sourceEnd = source.period?.end ?? "";
  const targetEnd = target.period?.end ?? "";
  if (sourceEnd === targetEnd) return source.id < target.id ? ordered : swapped;
  return sourceEnd > targetEnd ? ordered : swapped;
}

/**
 * Applies the contradiction invariant to whatever the model returned.
 *
 * Two things have to hold before `contradicts` survives: the values actually differ by
 * deterministic comparison, and every decisive field is matched. A field the model claims to have
 * matched counts only where code could not compare it — the model may fill a gap, never overrule a
 * difference.
 */
function resolveFirstPass(
  comparison: DeterministicComparison,
  output: z.infer<typeof firstPassSchema>,
): Resolved {
  const claimed = new Set(output.contextMatches);
  const matchedFields = [
    ...comparison.matched,
    ...comparison.unknown.filter((field) => claimed.has(field)),
  ];
  const mismatchedFields = comparison.mismatched;

  const base = {
    matchedFields,
    mismatchedFields,
    explanation: output.explanation,
    confidence: output.confidence,
    priorPass: null,
  };

  if (output.verdict !== "contradicts") {
    return { ...base, verdict: output.verdict, reasonCode: output.reasonCode };
  }

  if (!mismatchedFields.includes("value")) {
    return {
      ...base,
      verdict: "insufficient",
      reasonCode: "missing_context",
      explanation: `Withheld a contradiction: the two values were never shown to differ. ${output.explanation}`,
    };
  }

  const blocker = DECISIVE_FIELDS.find((field) => !matchedFields.includes(field));
  if (blocker) {
    const differs = mismatchedFields.includes(blocker);
    return {
      ...base,
      verdict: "insufficient",
      reasonCode: (differs && WITHHELD_REASON[blocker]) || "missing_context",
      explanation: `Withheld a contradiction: ${blocker} ${differs ? "differs between the two claims" : "could not be compared"}. ${output.explanation}`,
    };
  }

  // Once code has proved a value mismatch and matched every decisive field, the reason is no
  // longer a model choice. Keeping it code-owned prevents internally impossible combinations such
  // as `contradicts` with `exact_duplicate`.
  return { ...base, verdict: "contradicts", reasonCode: "value_conflict" };
}

/**
 * One pair, start to finish: compare, judge, and review anything that came back a contradiction.
 *
 * The second pass runs against `contradicts` and nothing else. That is what makes the escalation
 * affordable — contradictions are tens of pairs where candidates are thousands — and it is where
 * the reversed burden earns its keep: a pair only survives if a model asked to reconcile it could
 * not find a way.
 */
async function adjudicateOne(
  pair: AdjudicationPair,
  model: AdjudicationModel,
  pipelineVersion: string,
): Promise<Judged> {
  const comparison = compareAssertions(pair.source, pair.target);

  let resolved: Resolved;
  let settled = false;
  let reviewed = false;
  let downgraded = false;
  let withheld = false;

  if (comparison.settled) {
    settled = true;
    resolved = {
      verdict: comparison.settled.verdict,
      reasonCode: comparison.settled.reasonCode,
      matchedFields: comparison.matched,
      mismatchedFields: comparison.mismatched,
      explanation: comparison.settled.explanation,
      confidence: 1,
      priorPass: null,
    };
  } else {
    const output = firstPassSchema.parse(
      await model.generate({
        name: "pair_adjudication",
        system: ADJUDICATION_SYSTEM_PROMPT,
        prompt: adjudicationPrompt(pair.source, pair.target, comparison),
        schema: firstPassSchema,
      }),
    );
    resolved = resolveFirstPass(comparison, output);
    withheld = output.verdict === "contradicts" && resolved.verdict !== "contradicts";

    if (resolved.verdict === "contradicts") {
      reviewed = true;
      const review = reviewSchema.parse(
        await model.generate({
          name: "contradiction_review",
          system: CONTRADICTION_REVIEW_SYSTEM_PROMPT,
          prompt: contradictionReviewPrompt(
            pair.source,
            pair.target,
            comparison,
            resolved.explanation,
          ),
          schema: reviewSchema,
          escalate: true,
        }),
      );

      if (review.reconcilable) {
        downgraded = true;
        resolved = {
          ...resolved,
          verdict: "reconciles",
          reasonCode: review.reasonCode,
          explanation: review.explanation,
          confidence: review.confidence,
          // Both passes survive. A contradiction that a reversed-burden review defused is the most
          // persuasive thing the product shows, and it is only legible if the first reading stays.
          priorPass: { verdict: "contradicts", explanation: resolved.explanation },
        };
      } else {
        resolved = {
          ...resolved,
          explanation: `${resolved.explanation} A reversed-burden review found no qualifier that reconciles them: ${review.explanation}`,
        };
      }
    }
  }

  const { first, second } = orderPair(pair.source, pair.target, resolved.reasonCode);

  return {
    settled,
    reviewed,
    downgraded,
    withheld,
    edge: {
      id: crypto.randomUUID(),
      sourceAssertionId: first.id,
      targetAssertionId: second.id,
      verdict: resolved.verdict,
      reasonCode: resolved.reasonCode,
      matchedFields: resolved.matchedFields,
      mismatchedFields: resolved.mismatchedFields,
      explanation: resolved.explanation,
      confidence: resolved.confidence,
      priorPass: resolved.priorPass,
      pipelineVersion,
    },
  };
}

export type AdjudicationResult = {
  edges: ClaimEdge[];
  skipped: AdjudicationSkip[];
  stats: AdjudicationStats;
};

/**
 * Judges a batch of pairs.
 *
 * A pair whose model call fails is retried once and then recorded as a skip rather than failing the
 * batch. One flaky call should not cost a document every relationship it has, and a skip is not a
 * swallowed failure: it is counted here, logged by the stage, and returned by the edges endpoint.
 */
export async function adjudicatePairs(
  pairs: readonly AdjudicationPair[],
  model: AdjudicationModel,
  pipelineVersion: string,
): Promise<AdjudicationResult> {
  const skipped: AdjudicationSkip[] = [];
  const edges: ClaimEdge[] = [];
  let settled = 0;
  let reviewed = 0;
  let downgraded = 0;
  let withheld = 0;

  const results = await mapWithConcurrency(
    [...pairs],
    CONCURRENCY,
    async (pair): Promise<Judged | AdjudicationSkip> => {
      try {
        return await adjudicateOne(pair, model, pipelineVersion);
      } catch {
        // One more attempt before giving up on the pair. Structured output that failed to parse
        // usually parses on a second sampling, and a transient provider error always does.
      }

      try {
        return await adjudicateOne(pair, model, pipelineVersion);
      } catch (error) {
        return skip(
          `${pair.source.id}:${pair.target.id}`,
          error instanceof z.ZodError ? "invalid_output" : "model_error",
          error instanceof z.ZodError ? new Error(z.prettifyError(error)) : error,
        );
      }
    },
  );

  for (const result of results) {
    if ("reason" in result) {
      skipped.push(result);
      continue;
    }
    edges.push(result.edge);
    if (result.settled) settled += 1;
    if (result.reviewed) reviewed += 1;
    if (result.downgraded) downgraded += 1;
    if (result.withheld) withheld += 1;
  }

  const count = (verdict: ClaimEdge["verdict"]) =>
    edges.filter((edge) => edge.verdict === verdict).length;

  return {
    edges,
    skipped,
    stats: {
      pairs: pairs.length,
      settled,
      judged: edges.length - settled,
      reviewed,
      downgraded,
      withheld,
      corroborates: count("corroborates"),
      contradicts: count("contradicts"),
      reconciles: count("reconciles"),
      insufficient: count("insufficient"),
      skipped: skipped.length,
    },
  };
}
