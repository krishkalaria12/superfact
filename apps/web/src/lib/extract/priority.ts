import type { ParsedLine, ReconstructedTable } from "@superfact/db/contracts";

/**
 * What order to extract a document's pages in.
 *
 * Parsing has already mapped the whole document cheaply, so by the time extraction starts the
 * system knows which pages carry tables, which carry headings, and how much text each holds. Doing
 * the dense pages first is what makes a run read as fast: a reviewer watching the fact list sees
 * the financial tables and the summary section fill in while body prose is still going, instead of
 * watching a progress bar cross forty pages of front matter.
 *
 * It changes the order, never the set. Every page is still extracted, and a run's final output is
 * identical whichever order it ran in.
 */

/**
 * Headings that tend to sit above a document's own summary of itself.
 *
 * These are ordinary English section words, not anything about the starter documents — no filename,
 * predicate, or value appears here, and a document with none of them simply ranks on its tables and
 * its text instead. The list stays short on purpose: a longer one would start encoding what we
 * expect these six PDFs to say.
 */
const SUMMARY_HEADING =
  /\b(?:highlights?|summary|overview|at a glance|key (?:figures?|metrics?|numbers?|indicators?)|results?)\b/i;

/** Above this multiple of the page's body type, a line is a heading rather than a sentence. */
const HEADING_SIZE_RATIO = 1.12;

export type PagePriorityInput = {
  pageNumber: number;
  lines: readonly Pick<ParsedLine, "text" | "size">[];
  tables: readonly Pick<ReconstructedTable, "quality" | "rows" | "title">[];
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * How much a page is worth extracting early, from 0 to 1.
 *
 * Resolved table cells dominate, because a reconstructed table is the densest fact source a page
 * can have and the one most likely to carry the numbers a reviewer came for. A summary heading is
 * worth a fixed bump rather than a multiplier — it says this page is about the document's own
 * headline claims, and that is true whether the heading appears once or four times.
 */
export function pagePriority(page: PagePriorityInput): number {
  const cells = page.tables
    .filter((table) => table.quality === "clean")
    .reduce((total, table) => total + table.rows.reduce((n, row) => n + row.cells.length, 0), 0);
  // Saturating rather than linear: forty cells and four hundred are both "this is a table page".
  const tableScore = cells === 0 ? 0 : Math.min(1, Math.log10(1 + cells) / 2);

  const sized = page.lines.filter((line) => line.text.trim()).map((line) => line.size);
  const bodySize = median(sized);
  const headings = page.lines.filter(
    (line) => line.text.trim() && bodySize > 0 && line.size >= bodySize * HEADING_SIZE_RATIO,
  );
  const summaryScore = [
    ...headings.map((line) => line.text),
    ...page.tables.map((t) => t.title),
  ].some((text) => text && SUMMARY_HEADING.test(text))
    ? 1
    : 0;

  const characters = page.lines.reduce((total, line) => total + line.text.trim().length, 0);
  // A page with nothing on it should sort last; beyond a screenful more text is not more signal.
  const textScore = Math.min(1, characters / 2000);

  return 0.6 * tableScore + 0.3 * summaryScore + 0.1 * textScore;
}

/**
 * Groups pages into extraction batches, densest first.
 *
 * Pages are ranked and then cut into fixed-size batches, so the first batch to run holds the most
 * promising pages in the document wherever they happen to sit. Ties break on page number, which
 * keeps the plan deterministic — the same parsed document always produces the same batches.
 */
export function planExtractionBatches(
  pages: readonly PagePriorityInput[],
  batchSize: number,
): number[][] {
  if (batchSize < 1) throw new Error("batchSize must be positive");

  const ranked = pages
    .map((page) => ({ pageNumber: page.pageNumber, priority: pagePriority(page) }))
    .sort((a, b) => b.priority - a.priority || a.pageNumber - b.pageNumber)
    .map((page) => page.pageNumber);

  return Array.from({ length: Math.ceil(ranked.length / batchSize) }, (_, index) =>
    ranked.slice(index * batchSize, (index + 1) * batchSize),
  );
}
