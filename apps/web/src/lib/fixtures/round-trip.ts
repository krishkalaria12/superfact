import type {
  ClaimEdge,
  ParsedPage,
  PublishedAssertion,
  RejectedAssertion,
} from "@superfact/db/contracts";

import { PIPELINE_VERSION } from "@/lib/pipeline";

/**
 * The phase 01 fixture: one invented page and the three assertions a run over it would produce.
 *
 * It is invented rather than lifted from a starter PDF on purpose — no document-specific data
 * belongs in the codebase. What it does copy from the real documents is their shape: a figure
 * printed in millions and the same figure printed in crore, a rupee sign the font dropped to `I`,
 * and a growth rate stated with no period attached.
 */

const LINES = [
  "Consolidated statement of profit and loss",
  "Revenue from operations for the year ended 31 March 2024 was I 81,415.38 million.",
  "Revenue from operations for FY2024 stood at 8,141.538 crore.",
  "All amounts in Indian Rupees in million unless otherwise stated.",
  "Revenue grew 18% over the prior period.",
];

export const fixturePage: ParsedPage = {
  pageNumber: 1,
  width: 595,
  height: 842,
  text: LINES.join("\n"),
  lines: LINES.map((text, i) => ({
    id: `p1l${i + 1}`,
    text,
    bbox: { x0: 72, y0: 96 + i * 18, x1: 523, y1: 110 + i * 18 },
    size: i === 0 ? 13 : 9.5,
  })),
  bands: [{ index: 0, x0: 0, x1: 595 }],
  tables: [],
  raster: null,
  quality: { textDensity: 4.1, replacementCharRatio: 0, imageRatio: 0 },
};

const tableContext = {
  title: "Consolidated statement of profit and loss",
  columnHeader: "Year ended 31 March 2024",
  rowHeader: "Revenue from operations",
  // Not from the cell: the glyph in the cell reads `I`, so the currency comes from this line.
  unitLine: "All amounts in Indian Rupees in million unless otherwise stated.",
  footnotes: [],
};

const period = { start: "2023-04-01", end: "2024-03-31", precision: "fiscal_year" } as const;

/**
 * Two published assertions stating the same figure at different scales, and one rejection.
 *
 * `documentId` and the ids are supplied by the caller, so the round-trip compares the exact
 * objects it wrote rather than a reconstruction of them.
 */
export function fixtureAssertions(documentId: string, ids: [string, string, string]) {
  const inMillions: PublishedAssertion = {
    id: ids[0],
    documentId,
    page: 1,
    subject: "Revenue from operations",
    predicate: "revenue",
    rawValue: "I 81,415.38 million",
    canonicalValue: "81415380000",
    canonicalNumber: 81_415_380_000,
    unit: "INR",
    valueType: "money",
    normalizationRule: "inr_million_to_inr",
    period,
    qualifiers: { fiscal_year: "FY2024", basis: "consolidated" },
    modality: "observed",
    attributedTo: null,
    source: "table",
    tableContext,
    evidence: {
      quote: "Revenue from operations for the year ended 31 March 2024 was I 81,415.38 million.",
      lineIds: ["p1l2"],
      bbox: { x0: 72, y0: 114, x1: 523, y1: 128 },
    },
    confidence: 0.92,
    salience: 0.8,
    status: "published",
    verified: true,
    contextComplete: true,
    pipelineVersion: PIPELINE_VERSION,
  };

  const inCrore: PublishedAssertion = {
    ...inMillions,
    id: ids[1],
    rawValue: "8,141.538 crore",
    normalizationRule: "inr_crore_to_inr",
    source: "prose",
    tableContext: null,
    evidence: {
      quote: "Revenue from operations for FY2024 stood at 8,141.538 crore.",
      lineIds: ["p1l3"],
      bbox: { x0: 72, y0: 132, x1: 523, y1: 146 },
    },
    confidence: 0.88,
  };

  // A growth rate with no period. Structurally fine, and exactly what the context gate exists for.
  const noPeriod: RejectedAssertion = {
    ...inMillions,
    id: ids[2],
    predicate: "revenue growth",
    rawValue: "18%",
    canonicalValue: "0.18",
    canonicalNumber: 0.18,
    unit: "percent",
    valueType: "percent",
    normalizationRule: "percent_to_ratio",
    period: null,
    qualifiers: { basis: "consolidated" },
    source: "prose",
    tableContext: null,
    evidence: {
      quote: "Revenue grew 18% over the prior period.",
      lineIds: ["p1l5"],
      bbox: { x0: 72, y0: 168, x1: 523, y1: 182 },
    },
    confidence: 0.71,
    status: "rejected",
    verified: true,
    contextComplete: false,
    rejectionReason: "missing_context",
    rejectionDetail: "growth rate carries no fiscal period; 'the prior period' names nothing",
  };

  return { inMillions, inCrore, noPeriod };
}

/** The same number at two scales is corroboration, and the reason code says which kind. */
export function fixtureEdge(
  id: string,
  sourceAssertionId: string,
  targetAssertionId: string,
): ClaimEdge {
  return {
    id,
    sourceAssertionId,
    targetAssertionId,
    verdict: "corroborates",
    reasonCode: "equivalent_value",
    matchedFields: ["subject", "predicate", "time", "value", "modality"],
    mismatchedFields: ["unit"],
    explanation:
      "Both state FY2024 revenue from operations. 81,415.38 million and 8,141.538 crore are the same INR amount at different scales.",
    confidence: 0.94,
    priorPass: null,
    pipelineVersion: PIPELINE_VERSION,
  };
}
