import type { AssertionCandidate } from "@superfact/db/contracts";

import type { RepetitionCorpusEntry } from "./types.ts";

const NUMBER = /(?:^|[^\p{L}])[-+]?\d[\d,.]*(?:%|\b)/u;
const INTERNAL_TABLE_LABEL = /\bp\d+t\d+-r\d+(?:-c\d+)?\b/i;
const DOCUMENT_METADATA =
  /\b(?:page|slide|section)\s*(?:number|no\.?|title|label)?\b|\b(?:document|filing|registration|membership|scrip|reference)\s+(?:date|code|number)\b|\b(?:conference call|scheduled time)\b/i;
const STRUCTURAL_PREDICATE =
  /\b(?:has label|displays numeric value|contains page|has title or number|has length|was published in)\b/i;
const BIBLIOGRAPHIC_EVIDENCE =
  /\b(?:doi|isbn|issn|data release|professional paper|open-file report|accessed\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i;

function comparable(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function assertionSignature(
  assertion: Pick<AssertionCandidate, "subject" | "predicate" | "rawValue" | "unit">,
): string {
  return [assertion.subject, assertion.predicate, assertion.rawValue, assertion.unit ?? ""]
    .map(comparable)
    .join("|");
}

/** Numeric claims receive 0.6. Cross-document repetition contributes up to another 0.4. */
export function computeSalience(
  candidate: AssertionCandidate,
  documentId: string,
  corpus: readonly RepetitionCorpusEntry[] = [],
): number {
  const signature = assertionSignature(candidate);
  const repetitions = new Set(
    corpus
      .filter((entry) => entry.documentId !== documentId && assertionSignature(entry) === signature)
      .map((entry) => entry.documentId),
  ).size;
  const claimText = `${candidate.subject} ${candidate.predicate}`;
  const lowSignal =
    INTERNAL_TABLE_LABEL.test(claimText) ||
    DOCUMENT_METADATA.test(claimText) ||
    STRUCTURAL_PREDICATE.test(candidate.predicate) ||
    BIBLIOGRAPHIC_EVIDENCE.test(candidate.evidence.quote);
  const base = lowSignal ? 0.05 : NUMBER.test(candidate.rawValue) ? 0.6 : 0.2;
  return Math.min(1, base + Math.min(0.4, repetitions * 0.1));
}
