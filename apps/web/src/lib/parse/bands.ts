import type { ColumnBand, ParsedLine } from "@superfact/db/contracts";

/**
 * Column bands: vertical slices of a page separated by whitespace that no line crosses.
 *
 * The plan puts this before row clustering because a two-up spread otherwise merges rows across
 * the gutter — the left page's row header ends up in the same cluster as the right page's numbers,
 * and every value lands under the wrong label.
 *
 * The rule that makes it safe is that a band boundary is the complement of merged line coverage.
 * An ordinary table's inter-column gaps look identical in width to a gutter, but a table almost
 * always carries a title or a spanning header across them, and that line's coverage closes the gap
 * on its own. No special case is needed to tell the two apart.
 */

/** A gutter narrower than this share of the page is an inter-column gap, not a layout boundary. */
const MIN_GUTTER_RATIO = 0.04;

/** Below this there is not enough on the page to conclude anything about its layout. */
const MIN_LINES_FOR_BANDS = 8;

/**
 * Lines this wide are page furniture — a running header, a rule, a footer — and are excluded from
 * coverage so one of them cannot veto an otherwise obvious gutter.
 */
const FULL_WIDTH_RATIO = 0.9;

type Interval = { x0: number; x1: number };

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.x0 - b.x0);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.x0 <= last.x1) {
      last.x1 = Math.max(last.x1, interval.x1);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

export function detectBands(lines: ParsedLine[], pageWidth: number): ColumnBand[] {
  const wholePage = (): ColumnBand[] => [{ index: 0, x0: 0, x1: pageWidth }];

  if (lines.length < MIN_LINES_FOR_BANDS) return wholePage();

  const left = Math.min(...lines.map((line) => line.bbox.x0));
  const right = Math.max(...lines.map((line) => line.bbox.x1));
  const contentWidth = right - left;
  if (contentWidth <= 0) return wholePage();

  const covering = lines.filter(
    (line) => line.bbox.x1 - line.bbox.x0 < contentWidth * FULL_WIDTH_RATIO,
  );
  if (covering.length < MIN_LINES_FOR_BANDS) return wholePage();

  const merged = mergeIntervals(covering.map((line) => ({ x0: line.bbox.x0, x1: line.bbox.x1 })));
  const minGutter = pageWidth * MIN_GUTTER_RATIO;

  const boundaries: number[] = [];
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i]!.x0 - merged[i - 1]!.x1;
    if (gap >= minGutter) boundaries.push((merged[i - 1]!.x1 + merged[i]!.x0) / 2);
  }

  if (boundaries.length === 0) return wholePage();

  const edges = [0, ...boundaries, pageWidth];
  return edges.slice(0, -1).map((x0, index) => ({ index, x0, x1: edges[index + 1]! }));
}

/** Which band a line belongs to, decided by its midpoint so a slight overhang does not move it. */
export function bandOf(bands: ColumnBand[], line: ParsedLine): number {
  const midpoint = (line.bbox.x0 + line.bbox.x1) / 2;
  const found = bands.findIndex((band) => midpoint >= band.x0 && midpoint < band.x1);
  return found === -1 ? 0 : found;
}
