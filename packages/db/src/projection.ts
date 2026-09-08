import type {
  ClaimEdge,
  DocumentSummary,
  PublishedAssertion,
  RejectedAssertion,
  RunExport,
  StoredAssertion,
} from "./contracts/index.ts";
import type { ComparisonField } from "./contracts/edges.ts";
import type { Assertion, Document, Edge, NewAssertion, NewEdge } from "./schema/index.ts";

/**
 * Database rows to the shapes the API and the JSON export speak.
 *
 * Storage keeps assertions flat because that is what indexes and filters want; the contracts nest
 * evidence and period because that is what reads well and what the plan writes down. This module
 * is the only place the two shapes meet, so a column rename cannot quietly drop a field from an
 * export — the round-trip check at `/api/dev/round-trip` fails first.
 */

function toPeriod(row: Assertion) {
  if (!row.periodStart || !row.periodEnd || !row.periodPrecision) return null;
  return { start: row.periodStart, end: row.periodEnd, precision: row.periodPrecision };
}

function toAssertionBase(row: Assertion) {
  return {
    id: row.id,
    documentId: row.documentId,
    page: row.pageNumber,
    subject: row.subject,
    predicate: row.predicate,
    rawValue: row.rawValue,
    canonicalValue: row.canonicalValue,
    canonicalNumber: row.canonicalNumber,
    unit: row.unit,
    valueType: row.valueType,
    normalizationRule: row.normalizationRule,
    period: toPeriod(row),
    qualifiers: row.qualifiers,
    modality: row.modality,
    attributedTo: row.attributedTo,
    source: row.source,
    tableContext: row.tableContext ?? null,
    evidence: {
      quote: row.evidenceQuote,
      lineIds: row.evidenceLineIds,
      bbox: row.evidenceBbox ?? null,
    },
    confidence: row.confidence,
    salience: row.salience,
    pipelineVersion: row.pipelineVersion,
  };
}

/**
 * Throws when the row is not actually publishable. The gates run at phase 05, but the projection
 * refuses to dress a row as a published fact if they somehow did not, so an unverified quote
 * cannot reach an export by way of a bad `status` write.
 */
export function toPublishedAssertion(row: Assertion): PublishedAssertion {
  if (row.status !== "published" || !row.verified || !row.contextComplete) {
    throw new Error(
      `assertion ${row.id} is not publishable: status=${row.status} verified=${row.verified} contextComplete=${row.contextComplete}`,
    );
  }

  return { ...toAssertionBase(row), status: "published", verified: true, contextComplete: true };
}

export function toRejectedAssertion(row: Assertion): RejectedAssertion {
  if (row.status !== "rejected" || !row.rejectionReason) {
    throw new Error(`assertion ${row.id} is rejected but carries no reason code`);
  }

  return {
    ...toAssertionBase(row),
    status: "rejected",
    verified: row.verified,
    contextComplete: row.contextComplete,
    rejectionReason: row.rejectionReason,
    rejectionDetail: row.rejectionDetail,
  };
}

export function toStoredAssertion(row: Assertion): StoredAssertion {
  return row.status === "published" ? toPublishedAssertion(row) : toRejectedAssertion(row);
}

export function toClaimEdge(row: Edge): ClaimEdge {
  return {
    id: row.id,
    sourceAssertionId: row.sourceAssertionId,
    targetAssertionId: row.targetAssertionId,
    verdict: row.verdict,
    reasonCode: row.reasonCode,
    // Postgres gives back `text[]`; the enum is re-asserted here and re-checked for real when
    // the export is parsed against `runExportSchema`.
    matchedFields: row.matchedFields as ComparisonField[],
    mismatchedFields: row.mismatchedFields as ComparisonField[],
    explanation: row.explanation,
    confidence: row.confidence,
    priorPass:
      row.priorVerdict && row.priorExplanation
        ? { verdict: row.priorVerdict, explanation: row.priorExplanation }
        : null,
    pipelineVersion: row.pipelineVersion,
  };
}

export function toDocumentSummary(
  row: Document,
  coverage: { pagesParsed: number; pagesFailed: number },
): DocumentSummary {
  return {
    id: row.id,
    filename: row.filename,
    contentHash: row.contentHash,
    status: row.status,
    pageCount: row.pageCount,
    pagesParsed: coverage.pagesParsed,
    pagesFailed: coverage.pagesFailed,
  };
}

/** Assembles the export from already-projected parts, so callers choose their own query plan. */
export function buildRunExport(parts: Omit<RunExport, "exportedAt">): RunExport {
  return { ...parts, exportedAt: new Date().toISOString() };
}

/**
 * The other direction: a contract object to the row that stores it.
 *
 * Phase 05 writes rows this way once the gates have run, and having both directions in one file is
 * what makes the round-trip check meaningful — a field that exists in only one of them shows up
 * immediately as a difference rather than years later as a missing column in an export.
 */
export function toAssertionRow(assertion: StoredAssertion, pageId: string): NewAssertion {
  const rejected = assertion.status === "rejected" ? assertion : null;

  return {
    id: assertion.id,
    documentId: assertion.documentId,
    pageId,
    pageNumber: assertion.page,
    subject: assertion.subject,
    predicate: assertion.predicate,
    rawValue: assertion.rawValue,
    canonicalValue: assertion.canonicalValue,
    canonicalNumber: assertion.canonicalNumber,
    unit: assertion.unit,
    valueType: assertion.valueType,
    normalizationRule: assertion.normalizationRule,
    periodStart: assertion.period?.start ?? null,
    periodEnd: assertion.period?.end ?? null,
    periodPrecision: assertion.period?.precision ?? null,
    qualifiers: assertion.qualifiers,
    modality: assertion.modality,
    attributedTo: assertion.attributedTo,
    source: assertion.source,
    tableContext: assertion.tableContext,
    evidenceQuote: assertion.evidence.quote,
    evidenceBbox: assertion.evidence.bbox,
    evidenceLineIds: assertion.evidence.lineIds,
    verified: assertion.verified,
    contextComplete: assertion.contextComplete,
    status: assertion.status,
    rejectionReason: rejected?.rejectionReason ?? null,
    rejectionDetail: rejected?.rejectionDetail ?? null,
    confidence: assertion.confidence,
    salience: assertion.salience,
    pipelineVersion: assertion.pipelineVersion,
  };
}

export function toEdgeRow(edge: ClaimEdge): NewEdge {
  return {
    id: edge.id,
    sourceAssertionId: edge.sourceAssertionId,
    targetAssertionId: edge.targetAssertionId,
    verdict: edge.verdict,
    reasonCode: edge.reasonCode,
    matchedFields: [...edge.matchedFields],
    mismatchedFields: [...edge.mismatchedFields],
    explanation: edge.explanation,
    confidence: edge.confidence,
    priorVerdict: edge.priorPass?.verdict ?? null,
    priorExplanation: edge.priorPass?.explanation ?? null,
    pipelineVersion: edge.pipelineVersion,
  };
}
