import type { AssertionRejectionReason } from "@superfact/db";
import type { AssertionCandidate, Period } from "@superfact/db/contracts";

import { applyGroundingGates, type GroundingPage } from "./gates.ts";
import {
  findPeriodInSource,
  normalizePeriod,
  normalizeValue,
  verifyValueInSource,
} from "./normalize.ts";

const PERIOD_KEY = /(?:^|_)(?:date|period|year|fiscal|fy|quarter|month|half_year)(?:_|$)/i;
const FISCAL_LABEL = /\b(?:fy|fiscal\s+year|q[1-4]\s*fy|h[12]\s*fy)\s*['’]?\d{2,4}\b/i;

export type GroundedCandidate = {
  canonicalValue: string | null;
  canonicalNumber: number | null;
  unit: string | null;
  normalizationRule: string | null;
  period: Period | null;
  verified: boolean;
  contextComplete: boolean;
  status: "published" | "rejected";
  rejectionReason: AssertionRejectionReason | null;
  rejectionDetail: string | null;
};

function tableSource(candidate: AssertionCandidate): string {
  const context = candidate.tableContext;
  if (!context) return "";
  return [
    context.title,
    context.columnHeader,
    context.rowHeader,
    context.unitLine,
    ...context.footnotes,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
}

function fiscalYearEnd(sources: readonly string[]): Period | null {
  for (const source of sources) {
    const match = source.match(
      /\b(?:year|period)\s+ended(?:\s+on)?\s+((?:\d{1,2}\s+[A-Za-z]+\s+\d{4})|(?:[A-Za-z]+\s+\d{1,2},?\s+\d{4})|(?:\d{4}-\d{2}-\d{2}))/i,
    );
    if (!match) continue;
    const period = normalizePeriod(match[1]);
    if (period.ok && period.value.precision === "day") return period.value;
  }
  return null;
}

function candidatePeriod(candidate: AssertionCandidate): Period | null {
  const context = candidate.tableContext;
  const sources = [
    context?.columnHeader,
    context?.title,
    candidate.evidence.quote,
    ...Object.values(candidate.qualifiers),
  ].filter((value): value is string => Boolean(value?.trim()));
  const explicitEnd = fiscalYearEnd(sources);

  if (candidate.valueType === "date") {
    const normalized = normalizePeriod(candidate.rawValue, { fiscalYearEnd: explicitEnd?.end });
    return normalized.ok ? normalized.value : null;
  }

  for (const [key, value] of Object.entries(candidate.qualifiers)) {
    const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
    if (PERIOD_KEY.test(normalizedKey)) {
      const normalized = normalizePeriod(value, { fiscalYearEnd: explicitEnd?.end });
      if (normalized.ok) return normalized.value;
      const embedded = findPeriodInSource(value);
      if (embedded) return embedded;
    }
  }

  for (const source of [context?.columnHeader, context?.title, candidate.evidence.quote]) {
    if (!source) continue;
    const period = findPeriodInSource(source);
    if (period) return period;
  }
  return null;
}

function rejected(
  base: Omit<GroundedCandidate, "status" | "rejectionReason" | "rejectionDetail">,
  reason: AssertionRejectionReason,
  detail: string,
): GroundedCandidate {
  return { ...base, status: "rejected", rejectionReason: reason, rejectionDetail: detail };
}

/** Runs every deterministic phase 05 check and produces the fields stored with one assertion. */
export function groundCandidate(
  candidate: AssertionCandidate,
  page: GroundingPage,
): GroundedCandidate {
  const gates = applyGroundingGates(candidate, page);
  const governingUnit = [candidate.unit, candidate.tableContext?.unitLine]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
  const normalized = normalizeValue({
    rawValue: candidate.rawValue,
    valueType: candidate.valueType,
    unit: governingUnit || null,
    fiscalYearEnd: candidatePeriod(candidate)?.end,
  });
  const period = candidatePeriod(candidate);
  const base = {
    canonicalValue: normalized.ok ? normalized.value.canonicalValue : null,
    canonicalNumber: normalized.ok ? normalized.value.canonicalNumber : null,
    unit: normalized.ok ? normalized.value.unit : candidate.unit,
    normalizationRule: normalized.ok ? normalized.value.normalizationRule : null,
    period,
    verified: gates.verified,
    contextComplete: gates.contextComplete,
  };

  if (gates.rejectionReason) {
    return rejected(base, gates.rejectionReason, gates.rejectionDetail);
  }
  if (!normalized.ok) {
    return rejected(base, normalized.failure.reason, normalized.failure.detail);
  }
  const periodSources = [
    candidate.evidence.quote,
    candidate.tableContext?.columnHeader,
    candidate.tableContext?.title,
    ...Object.values(candidate.qualifiers),
  ].join(" ");
  if (!period && FISCAL_LABEL.test(periodSources)) {
    return rejected(
      base,
      "normalization_failed",
      "fiscal period has no explicit matching year-end date in its source context",
    );
  }

  const sourceCheck = verifyValueInSource({
    rawValue: candidate.rawValue,
    valueType: candidate.valueType,
    unit: normalized.value.unit,
    fiscalYearEnd: period?.end,
    sourceSpan: [candidate.evidence.quote, tableSource(candidate)].filter(Boolean).join("\n"),
  });
  if (!sourceCheck.ok) {
    return rejected(base, sourceCheck.failure.reason, sourceCheck.failure.detail);
  }

  return {
    ...base,
    status: "published",
    rejectionReason: null,
    rejectionDetail: null,
  };
}
