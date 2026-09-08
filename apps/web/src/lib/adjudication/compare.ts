import type { ComparisonField, Period, Qualifiers } from "@superfact/db/contracts";

// Straight from the module rather than the pairing barrel: comparison is pure, and the barrel
// would drag a database client into it.
import { tokenAffinity } from "../pairing/predicates.ts";
import type { AdjudicationAssertion, DeterministicComparison } from "./types.ts";

/**
 * Everything about a pair that code can decide on its own.
 *
 * This runs before any model call, and it is the authority on what differs. The model is asked to
 * interpret a difference, never to discover one: a mismatch found here cannot be talked away, which
 * is what keeps "these two disagree" from resting on a paraphrase.
 */

/** Doubles that came through the same normalizer are bit-identical; the slack is insurance. */
const EQUALITY_EPSILON = 1e-9;

/** Below this, two phrases are not describing the same thing. Tuned against the starter documents. */
const RELATED_TEXT = 0.5;

/**
 * The context a contradiction has to have settled before it may be claimed.
 *
 * Value is absent from this list on purpose: a differing value is what a contradiction *is*. These
 * five are the ways two claims can differ while both being true, and every one of them has to be
 * demonstrably the same before a conflict is allowed to stand.
 */
export const DECISIVE_FIELDS = [
  "time",
  "scope",
  "unit",
  "modality",
  "attribution",
] as const satisfies readonly ComparisonField[];

const PERIOD_KEY = /(?:^|_)(?:date|period|year|fiscal|fy|quarter|month|half_year|as_of)(?:_|$)/i;

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_");
}

/** Qualifiers that say something other than when. Period lives in its own column and is compared there. */
function scopeQualifiers(qualifiers: Qualifiers): Map<string, string> {
  return new Map(
    Object.entries(qualifiers)
      .map(([key, value]) => [normalizeKey(key), value.trim().toLowerCase()] as const)
      .filter(([key, value]) => value.length > 0 && !PERIOD_KEY.test(key)),
  );
}

/** Inclusive ISO bounds, so a lexical comparison is a chronological one. */
function overlaps(left: Period, right: Period): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function sameText(left: string | null, right: string | null): boolean {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

type Verdict = "matched" | "mismatched" | "unknown";

function compareTime(left: Period | null, right: Period | null): Verdict {
  if (!left || !right) return "unknown";
  if (left.start === right.start && left.end === right.end) return "matched";
  // Overlapping but unequal periods are still a difference. FY24 and Q4 FY24 share days and are
  // not the same claim, and calling that a match would license a contradiction across two windows.
  return "mismatched";
}

function compareScope(left: Qualifiers, right: Qualifiers): Verdict {
  const a = scopeQualifiers(left);
  const b = scopeQualifiers(right);
  // Neither side narrowed its claim, so there is no scope to disagree about.
  if (a.size === 0 && b.size === 0) return "matched";

  const shared = [...a.keys()].filter((key) => b.has(key));
  // One side says `segment` and the other says `geography`. Two claims scoped along axes that never
  // meet cannot be compared, and reading that as agreement is how a segment figure gets mistaken
  // for a national one.
  if (shared.length === 0) return "unknown";
  return shared.every((key) => a.get(key) === b.get(key)) ? "matched" : "mismatched";
}

function compareUnit(left: string | null, right: string | null): Verdict {
  const a = left?.trim().toLowerCase() ?? "";
  const b = right?.trim().toLowerCase() ?? "";
  if (a.length === 0 && b.length === 0) return "matched";
  if (a.length === 0 || b.length === 0) return "unknown";
  return a === b ? "matched" : "mismatched";
}

function compareAttribution(left: string | null, right: string | null): Verdict {
  // Two documents each asserting a claim in their own voice agree about who is speaking. One
  // crediting the RBI and the other speaking directly do not, and that difference changes the
  // proposition rather than merely its wording.
  if (!left && !right) return "matched";
  if (!left || !right) return "mismatched";
  return sameText(left, right) ? "matched" : "mismatched";
}

function compareValue(
  left: AdjudicationAssertion,
  right: AdjudicationAssertion,
): { verdict: Verdict; equal: boolean; delta: number | null; sameSign: boolean | null } {
  if (left.canonicalNumber !== null && right.canonicalNumber !== null) {
    const scale = Math.max(Math.abs(left.canonicalNumber), Math.abs(right.canonicalNumber), 1);
    const delta = Math.abs(left.canonicalNumber - right.canonicalNumber);
    const equal = delta <= EQUALITY_EPSILON * scale;
    return {
      verdict: equal ? "matched" : "mismatched",
      equal,
      delta: delta / scale,
      sameSign: Math.sign(left.canonicalNumber) === Math.sign(right.canonicalNumber),
    };
  }

  if (left.canonicalValue !== null && right.canonicalValue !== null) {
    const equal = left.canonicalValue === right.canonicalValue;
    return { verdict: equal ? "matched" : "mismatched", equal, delta: null, sameSign: null };
  }

  return { verdict: "unknown", equal: false, delta: null, sameSign: null };
}

function compareText(left: string, right: string): Verdict {
  return tokenAffinity(left, right) >= RELATED_TEXT ? "matched" : "mismatched";
}

/**
 * Runs every deterministic check the plan asks for first: equality, units, time overlap, sign, and
 * numeric tolerance.
 *
 * Where the answer is unambiguous the pair is settled here and never reaches a model. Two documents
 * reporting one number for one period in one unit, both in their own voice, agree — there is no
 * interpretation left to buy, and paying for one on every duplicate would spend the adjudication
 * budget on the easiest pairs in the corpus.
 */
export function compareAssertions(
  source: AdjudicationAssertion,
  target: AdjudicationAssertion,
): DeterministicComparison {
  const value = compareValue(source, target);
  const verdicts: Record<ComparisonField, Verdict> = {
    subject: compareText(source.subject, target.subject),
    predicate: compareText(source.predicate, target.predicate),
    time: compareTime(source.period, target.period),
    scope: compareScope(source.qualifiers, target.qualifiers),
    unit: compareUnit(source.unit, target.unit),
    value: value.verdict,
    modality: source.modality === target.modality ? "matched" : "mismatched",
    attribution: compareAttribution(source.attributedTo, target.attributedTo),
  };

  const fields = Object.entries(verdicts) as [ComparisonField, Verdict][];
  const pick = (verdict: Verdict) =>
    fields.filter(([, result]) => result === verdict).map(([field]) => field);

  const comparison: DeterministicComparison = {
    matched: pick("matched"),
    mismatched: pick("mismatched"),
    unknown: pick("unknown"),
    valuesEqual: value.equal,
    sameSign: value.sameSign,
    relativeDelta: value.delta,
    periodsOverlap: source.period && target.period ? overlaps(source.period, target.period) : null,
    settled: null,
  };

  // Settling needs every decisive field positively matched, not merely un-mismatched. A field code
  // could not compare is a reason to ask, and asking costs one model call where a wrong
  // corroboration costs the reviewer's trust.
  const agreesOnEverything =
    value.equal &&
    DECISIVE_FIELDS.every((field) => verdicts[field] === "matched") &&
    verdicts.subject !== "mismatched" &&
    verdicts.predicate !== "mismatched";

  if (agreesOnEverything) {
    const identical = sameText(source.rawValue, target.rawValue);
    comparison.settled = {
      verdict: "corroborates",
      reasonCode: identical ? "exact_duplicate" : "equivalent_value",
      explanation: identical
        ? `Both documents state ${source.rawValue} for the same period, unit, and scope.`
        : `${source.rawValue} and ${target.rawValue} normalize to the same value over the same period, unit, and scope.`,
    };
  }

  return comparison;
}
