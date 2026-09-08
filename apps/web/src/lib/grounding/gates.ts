import type {
  AssertionCandidate,
  ParsedLine,
  Qualifiers,
  TableContext,
} from "@superfact/db/contracts";
import type { AssertionRejectionReason } from "@superfact/db/schema/assertions";

export type GroundingPage = {
  text: string;
  lines: readonly Pick<ParsedLine, "id" | "text">[];
};

export type GateRejection = {
  verified: boolean;
  contextComplete: boolean;
  rejectionReason: AssertionRejectionReason;
  rejectionDetail: string;
};

export type GateDecision =
  | { verified: true; contextComplete: true; rejectionReason: null; rejectionDetail: null }
  | GateRejection;

type ContextRequirement = "period" | "geography" | "segment";

const PERIOD_KEYS = /(?:^|_)(?:date|period|year|fiscal|fy|quarter|month|half_year)(?:_|$)/i;
const GEOGRAPHY_KEYS =
  /(?:^|_)(?:geography|geographic|country|region|territory|location|market)(?:_|$)/i;
const SEGMENT_KEYS =
  /(?:^|_)(?:segment|division|business_unit|product_line|reportable_unit)(?:_|$)/i;

const PERIOD_VALUE =
  /\b(?:fy\s*['’]?\d{2,4}|q[1-4](?:\s*(?:fy)?\s*['’]?\d{2,4})?|h[12](?:\s*(?:fy)?\s*['’]?\d{2,4})?|(?:19|20)\d{2}(?:\s*[-–/]\s*(?:\d{2}|(?:19|20)\d{2}))?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:19|20)\d{2})\b/i;

const REVENUE_PREDICATE = /\b(?:revenue|revenues|turnover|net sales)\b/i;
const GROWTH_PREDICATE =
  /\b(?:growth|cagr|yoy|qoq|year[ -]over[ -]year|quarter[ -]over[ -]quarter|grew|increas(?:e|ed) by|decreas(?:e|ed) by)\b/i;
const GEOGRAPHIC_SCOPE =
  /\b(?:geograph(?:y|ic|ical)|region(?:al)?|countr(?:y|ies)|territor(?:y|ies)|location|by market)\b/i;
const SEGMENT_SCOPE = /\b(?:segment(?:al)?|division|business unit|product line|reportable unit)\b/i;

function normalizedEntries(qualifiers: Qualifiers): [string, string][] {
  return Object.entries(qualifiers).map(([key, value]) => [
    key
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "_"),
    value.trim(),
  ]);
}

function hasQualifier(qualifiers: Qualifiers, keyPattern: RegExp): boolean {
  return normalizedEntries(qualifiers).some(
    ([key, value]) => value.length > 0 && keyPattern.test(key),
  );
}

function hasQualifierKey(qualifiers: Qualifiers, keyPattern: RegExp): boolean {
  return normalizedEntries(qualifiers).some(([key]) => keyPattern.test(key));
}

function tableText(context: TableContext | null): string {
  if (!context) return "";
  return [
    context.title,
    context.columnHeader,
    context.rowHeader,
    context.unitLine,
    ...context.footnotes,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" \n ");
}

function hasPeriod(candidate: AssertionCandidate): boolean {
  if (
    normalizedEntries(candidate.qualifiers).some(
      ([key, value]) => PERIOD_KEYS.test(key) && PERIOD_VALUE.test(value),
    )
  )
    return true;
  return PERIOD_VALUE.test(tableText(candidate.tableContext));
}

function hasGeography(candidate: AssertionCandidate): boolean {
  if (hasQualifier(candidate.qualifiers, GEOGRAPHY_KEYS)) return true;
  if (!candidate.tableContext) return false;

  const governingText = [candidate.tableContext.title, candidate.tableContext.columnHeader]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return GEOGRAPHIC_SCOPE.test(governingText) && Boolean(candidate.tableContext.rowHeader?.trim());
}

function hasSegment(candidate: AssertionCandidate): boolean {
  if (hasQualifier(candidate.qualifiers, SEGMENT_KEYS)) return true;
  if (!candidate.tableContext) return false;

  const governingText = [candidate.tableContext.title, candidate.tableContext.columnHeader]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return SEGMENT_SCOPE.test(governingText) && Boolean(candidate.tableContext.rowHeader?.trim());
}

function contextRequirements(candidate: AssertionCandidate): ContextRequirement[] {
  const requirements = new Set<ContextRequirement>();
  const claimText = `${candidate.subject} ${candidate.predicate}`;
  const scopeText = `${claimText} ${tableText(candidate.tableContext)}`;

  if (REVENUE_PREDICATE.test(claimText)) requirements.add("period");
  if (candidate.valueType === "percent" && GROWTH_PREDICATE.test(claimText)) {
    requirements.add("period");
    requirements.add("geography");
  }
  if (SEGMENT_SCOPE.test(scopeText) || hasQualifierKey(candidate.qualifiers, SEGMENT_KEYS)) {
    requirements.add("segment");
  }

  return [...requirements];
}

export function checkVerbatimGate(
  candidate: AssertionCandidate,
  page: GroundingPage,
): GateRejection | null {
  const lineIds = new Set(page.lines.map((line) => line.id));
  const missingLineIds = [...new Set(candidate.evidence.lineIds)].filter((id) => !lineIds.has(id));
  if (missingLineIds.length > 0) {
    return {
      verified: false,
      contextComplete: false,
      rejectionReason: "line_not_found",
      rejectionDetail: `cited line ids do not exist on the stored page: ${missingLineIds.join(", ")}`,
    };
  }

  if (!page.text.includes(candidate.evidence.quote)) {
    return {
      verified: false,
      contextComplete: false,
      rejectionReason: "quote_not_found",
      rejectionDetail: "evidence quote does not occur verbatim in the stored page text",
    };
  }

  return null;
}

export function checkContextGate(candidate: AssertionCandidate): GateRejection | null {
  const missing = contextRequirements(candidate).filter((requirement) => {
    if (requirement === "period") return !hasPeriod(candidate);
    if (requirement === "geography") return !hasGeography(candidate);
    return !hasSegment(candidate);
  });
  if (missing.length === 0) return null;

  return {
    verified: true,
    contextComplete: false,
    rejectionReason: "missing_context",
    rejectionDetail: `missing required context: ${missing.join(", ")}`,
  };
}

/** Applies the deterministic publication gates in failure-priority order. */
export function applyGroundingGates(
  candidate: AssertionCandidate,
  page: GroundingPage,
): GateDecision {
  const verbatimFailure = checkVerbatimGate(candidate, page);
  if (verbatimFailure) {
    const contextFailure = checkContextGate(candidate);
    return { ...verbatimFailure, contextComplete: contextFailure === null };
  }

  const contextFailure = checkContextGate(candidate);
  if (contextFailure) return contextFailure;

  return {
    verified: true,
    contextComplete: true,
    rejectionReason: null,
    rejectionDetail: null,
  };
}
