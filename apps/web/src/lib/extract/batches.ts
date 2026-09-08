import type { ParsedLine } from "@superfact/db/contracts";

import type { ExtractionPage, PageLineBlock, ProseBatch } from "./types";

/**
 * Characters of prose in one extraction call.
 *
 * Sized by what comes back, not by what goes in. The extractor is told to emit one assertion per
 * proposition, and dense financial prose yields them at a startling rate — a single four-page batch
 * has produced 965 candidates. At twelve thousand characters the response ran past what one
 * structured output can carry and came back unparseable, which failed a hundred-page document twice
 * on the same kind of section. Four thousand keeps a call's output well inside the limit; the extra
 * calls cost little now that they run concurrently.
 */
export const DEFAULT_PROSE_BATCH_CHARS = 4_000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function isHeading(line: ParsedLine, bodySize: number): boolean {
  const text = line.text.trim();
  return (
    text.length > 0 && text.length <= 160 && line.size >= bodySize * 1.12 && !/[.!?;:]$/.test(text)
  );
}

function appendPage(blocks: PageLineBlock[], pageNumber: number, line: ParsedLine): void {
  const last = blocks.at(-1);
  if (last?.pageNumber === pageNumber) last.lines.push({ id: line.id, text: line.text });
  else blocks.push({ pageNumber, lines: [{ id: line.id, text: line.text }] });
}

function batchChars(batch: ProseBatch): number {
  return batch.pages.reduce(
    (total, page) => total + page.lines.reduce((sum, line) => sum + line.text.length + 1, 0),
    0,
  );
}

/** Groups prose under typographic headings. Page blocks remain explicit inside every batch. */
export function batchProseBySection(
  pages: readonly ExtractionPage[],
  maxChars = DEFAULT_PROSE_BATCH_CHARS,
): ProseBatch[] {
  if (!Number.isFinite(maxChars) || maxChars < 1) throw new Error("maxChars must be positive");

  const batches: ProseBatch[] = [];
  let current: ProseBatch | null = null;
  let nextId = 1;

  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const tableLineIds = new Set(
      page.tables
        .filter((table) => table.quality === "clean")
        .flatMap((table) => table.rows.flatMap((row) => row.cells.flatMap((cell) => cell.lineIds))),
    );
    const proseLines = page.lines.filter((line) => !tableLineIds.has(line.id));
    const bodySize = median(proseLines.filter((line) => line.text.trim()).map((line) => line.size));

    for (const line of proseLines) {
      if (!line.text.trim()) continue;
      const heading = isHeading(line, bodySize);
      const wouldOverflow = current && batchChars(current) + line.text.length + 1 > maxChars;

      if (!current || heading || wouldOverflow) {
        const inheritedTitle: string | null = current ? current.sectionTitle : null;
        current = {
          id: `prose-${nextId++}`,
          sectionTitle: heading ? line.text.trim() : inheritedTitle,
          pages: [],
        };
        batches.push(current);
      }

      appendPage(current.pages, page.pageNumber, line);
    }
  }

  return batches;
}
