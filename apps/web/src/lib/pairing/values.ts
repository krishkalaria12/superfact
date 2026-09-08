import type { ValueType } from "@superfact/db/schema/assertions";

import type { PairingAssertion } from "./types.ts";

/**
 * Value comparison for retrieval, over the canonical fields phase 05 produced.
 *
 * Everything here compares what the normalizer wrote, never what the document printed. That is the
 * whole reason the deterministic path beats the vector on numbers: ₹7,225 crore and ₹72.25 billion
 * are one number by the time they get here.
 */

/** Doubles that came out of the same decimal normalization are bit-identical; the slack is insurance. */
const EQUALITY_EPSILON = 1e-9;

const NUMERIC_TYPES = new Set<ValueType>(["money", "percent", "number"]);

/**
 * Whether two value types describe the same kind of quantity.
 *
 * `number` is the permissive one, because a figure stated in running prose is often typed bare
 * where the same figure in a table is typed as money or a percentage. Money against percent is not
 * allowed: a revenue figure and a growth rate are different claims however close their digits get.
 */
export function valueTypesCompatible(left: ValueType, right: ValueType): boolean {
  if (left === right) return true;
  return (
    (left === "number" || right === "number") && NUMERIC_TYPES.has(left) && NUMERIC_TYPES.has(right)
  );
}

/**
 * Whether two units put their values on one scale.
 *
 * A missing unit on either side counts as comparable rather than as a mismatch — code cannot tell
 * an unstated unit from a different one, and guessing would drop pairs. Two *stated* and different
 * units, INR against USD, do not compare, and the pair survives on the semantic path instead of on
 * a numeric coincidence.
 */
export function unitsComparable(left: string | null, right: string | null): boolean {
  const a = left?.trim().toLowerCase() ?? "";
  const b = right?.trim().toLowerCase() ?? "";
  return a === b || a.length === 0 || b.length === 0;
}

/** Canonical equality: numeric where both sides normalized to a number, exact string otherwise. */
export function canonicalValuesEqual(
  left: Pick<PairingAssertion, "canonicalValue" | "canonicalNumber">,
  right: Pick<PairingAssertion, "canonicalValue" | "canonicalNumber">,
): boolean {
  if (left.canonicalNumber !== null && right.canonicalNumber !== null) {
    const scale = Math.max(Math.abs(left.canonicalNumber), Math.abs(right.canonicalNumber), 1);
    return Math.abs(left.canonicalNumber - right.canonicalNumber) <= EQUALITY_EPSILON * scale;
  }
  // One side numeric and the other not is a normalization difference, not an agreement.
  if (left.canonicalNumber !== null || right.canonicalNumber !== null) return false;
  return left.canonicalValue !== null && left.canonicalValue === right.canonicalValue;
}
