import type { AssertionCandidate } from "@superfact/db/contracts";

import type { RepetitionCorpusEntry } from "./types.ts";

const NUMBER = /(?:^|[^\p{L}])[-+]?\d[\d,.]*(?:%|\b)/u;

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
  const numeric = NUMBER.test(candidate.rawValue) ? 0.6 : 0.2;
  return Math.min(1, numeric + Math.min(0.4, repetitions * 0.1));
}
