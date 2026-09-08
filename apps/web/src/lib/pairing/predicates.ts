/**
 * Lexical comparison of subjects and predicates.
 *
 * This decides which pairs are worth *looking at*, never which are true. Two predicates being
 * related buys a pair a place in the queue; whether the claims agree is settled at phase 07 from
 * evidence, and nothing here is allowed to pre-empt that.
 */

/** Grammatical filler only. Words that narrow a claim — total, segment, adjusted — are kept. */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "from",
  "by",
  "with",
  "and",
  "or",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "its",
  "their",
  "our",
  "this",
  "that",
  "following",
]);

/** Enough stemming to join a plural to its singular, and nothing clever enough to be wrong. */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("ss")) return token;
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map(stem);

  return new Set(tokens);
}

/**
 * How closely two phrases relate, from 0 to 1. A score of 1 means the normalized predicates are
 * identical — same content words, stemmed — which is the match the deterministic path is named
 * for. Word order carries nothing a pair needs, so "growth in revenue" and "revenue growth" score
 * as one predicate.
 *
 * Containment scores separately from overlap because it is the common shape: "revenue" and
 * "revenue from operations" describe one quantity at two levels of specificity, and plain Jaccard
 * would score that pair as half a match. A full containment lands at 0.75, an exact match at 1.
 */
export function tokenAffinity(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;

  const shared = [...a].filter((token) => b.has(token)).length;
  if (shared === 0) return 0;

  const jaccard = shared / (a.size + b.size - shared);
  const containment = shared / Math.min(a.size, b.size);
  return Math.max(jaccard, 0.75 * containment);
}
