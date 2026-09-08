import type {
  Bbox,
  ColumnBand,
  ParsedLine,
  ReconstructedTable,
  TableCell,
  TableRow,
} from "@superfact/db/contracts";
import { unionBbox } from "@superfact/db/contracts";

import { bandOf } from "./bands.ts";

/**
 * Tables rebuilt from coordinates.
 *
 * MuPDF's "line" on a table page is one cell, not one visual row, which is the useful granularity:
 * a row is whatever cells share a baseline, and a column is whatever cells overlap horizontally.
 * Neither needs the document to have drawn anything.
 *
 * Every cell leaves here carrying the title, unit line, and column header that govern it. A number
 * without those is not a fact — 81,415.38 is meaningless until something says revenue, rupees,
 * millions, and which year — so context is attached before a cell is ever offered to extraction.
 */

/** Share of a line's height within which two cells count as sharing a baseline. */
const ROW_TOLERANCE_RATIO = 0.45;

/** A row needs this many cells before it looks like a grid rather than a sentence. */
const MIN_CELLS_PER_ROW = 2;

/** Consecutive one-cell rows tolerated inside a table before it is treated as ended. */
const MAX_INTERRUPTION = 2;

/** A table needs this many gridded rows to be worth reconstructing. */
const MIN_GRIDDED_ROWS = 3;

/** How far above a table to look for its title and unit line, as a multiple of line height. */
const CONTEXT_REACH = 14;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const centreY = (line: ParsedLine) => (line.bbox.y0 + line.bbox.y1) / 2;

/** Lines sharing a baseline, in reading order. */
type Band = { lines: ParsedLine[]; centre: number };

function clusterRows(lines: ParsedLine[], tolerance: number): Band[] {
  const sorted = [...lines].sort((a, b) => centreY(a) - centreY(b));
  const bands: Band[] = [];

  for (const line of sorted) {
    const centre = centreY(line);
    const last = bands.at(-1);
    // Compared against the band's first line rather than a running mean, so a column of slightly
    // drifting baselines cannot chain two visual rows into one.
    if (last && Math.abs(centre - last.centre) <= tolerance) {
      last.lines.push(line);
    } else {
      bands.push({ lines: [line], centre });
    }
  }

  for (const band of bands) band.lines.sort((a, b) => a.bbox.x0 - b.bbox.x0);

  return bands;
}

/**
 * Column extents, derived from body rows alone.
 *
 * Deriving them from every row chains all the columns into one: a spanning heading like "Inflation"
 * sitting over three year columns overlaps both its neighbours, and overlap is transitive. Data
 * cells never span, so the body is the only trustworthy source of where the columns are.
 */
function assignColumns(rows: Band[]): { x0: number; x1: number }[] {
  const spans = rows
    .flatMap((row) => row.lines)
    .map((line) => ({ x0: line.bbox.x0, x1: line.bbox.x1 }))
    .sort((a, b) => a.x0 - b.x0);

  const columns: { x0: number; x1: number }[] = [];
  for (const span of spans) {
    const last = columns.at(-1);
    if (last && span.x0 < last.x1) {
      last.x1 = Math.max(last.x1, span.x1);
    } else {
      columns.push({ ...span });
    }
  }

  return columns;
}

/**
 * Nearest column by centre, not strict containment.
 *
 * A heading is centred over the columns it spans and so falls in the whitespace between two of
 * them. Containment would drop it; nearest-centre puts it over the column it sits above.
 */
function columnOf(columns: { x0: number; x1: number }[], line: ParsedLine): number {
  const centre = (line.bbox.x0 + line.bbox.x1) / 2;

  let best = 0;
  let bestDistance = Infinity;
  columns.forEach((column, index) => {
    const distance =
      centre < column.x0 ? column.x0 - centre : centre > column.x1 ? centre - column.x1 : 0;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });

  return best;
}

/**
 * A value as a document prints one: `6.8`, `9,320.84`, `(17.69)`, `0.26`, `12%`.
 *
 * Deliberately strict about what it excludes. `2022-23` is a fiscal year and `March 31, 2024` is a
 * date; both carry digits and both are column headings, so a bare digit test would read a table's
 * entire heading block as data.
 */
const NUMERIC_CELL = /^[([]?[-+\u20b9$\u00a3\u20ac]?\s*\d[\d,]*(?:\.\d+)?\s*%?[)\]]?$/;

/** A row is body when it carries values. Everything above the first such row is heading. */
function isBodyRow(row: Band): boolean {
  return row.lines.filter((line) => NUMERIC_CELL.test(line.text)).length >= MIN_CELLS_PER_ROW;
}

/**
 * A fully parenthesised line is where a document states its unit.
 *
 * `(Per cent)` and `(All amounts in Indian Rupees in million, unless otherwise stated)` are both
 * this shape. It is a typographic convention rather than anything specific to these documents, and
 * it is the only reliable source of currency: on the Delhivery notes the rupee sign is missing from
 * the font's encoding map and decodes as `I`, so the glyph in the cell says nothing.
 */
function isUnitLine(text: string): boolean {
  return text.startsWith("(") && text.endsWith(")") && text.length > 2;
}

/**
 * A note under a table, by the marks documents use for one.
 *
 * The numbered form requires whitespace after the marker, because without it `24.41` — a value
 * that happens to sit below the grid — reads as note 24.
 */
const FOOTNOTE = /^(?:[*\u2020\u2021#]|\(?\d{1,2}[).]\s|note[s]?\s*[:.]|source\s*[:.])/i;

function toCell(line: ParsedLine, column: number): TableCell {
  return { text: line.text, bbox: line.bbox, lineIds: [line.id], column };
}

function toRow(band: Band, columns: { x0: number; x1: number }[]): TableRow {
  const cells = band.lines.map((line) => toCell(line, columnOf(columns, line)));
  return { cells, bbox: unionBbox(band.lines.map((l) => l.bbox)) ?? band.lines[0]!.bbox };
}

/** Runs of gridded rows, tolerating a couple of one-cell rows — a table's section headings. */
function findRuns(rows: Band[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start: number | null = null;
  let interruption = 0;

  rows.forEach((row, index) => {
    if (row.lines.length >= MIN_CELLS_PER_ROW) {
      if (start === null) start = index;
      interruption = 0;
      return;
    }

    if (start === null) return;

    interruption += 1;
    if (interruption > MAX_INTERRUPTION) {
      runs.push({ start, end: index - interruption });
      start = null;
      interruption = 0;
    }
  });

  if (start !== null) runs.push({ start, end: rows.length - 1 - interruption });

  return runs.filter(
    (run) =>
      rows.slice(run.start, run.end + 1).filter((r) => r.lines.length >= MIN_CELLS_PER_ROW)
        .length >= MIN_GRIDDED_ROWS,
  );
}

/**
 * The largest-type line above the table is its title.
 *
 * Proximity alone picks the wrong line: on the Delhivery balance sheet the nearest heading above
 * the grid is the company registration number. Type size picks "Consolidated Balance Sheet", which
 * is what governs the numbers.
 */
function findTitle(above: ParsedLine[], reach: number): string | null {
  const candidates = above.filter(
    (line) => !isUnitLine(line.text) && line.text.length > 3 && line.text.length < 160,
  );
  if (candidates.length === 0) return null;

  const nearby = candidates.slice(-Math.max(1, Math.round(reach)));
  const largest = Math.max(...nearby.map((line) => line.size));
  // Ties go to the nearest, which is why the running header loses to the table's own heading.
  return nearby.filter((line) => line.size >= largest - 0.01).at(-1)?.text ?? null;
}

function findUnitLine(above: ParsedLine[]): string | null {
  return [...above].reverse().find((line) => isUnitLine(line.text))?.text ?? null;
}

/**
 * Per-column headings, assembled down the heading block.
 *
 * Two things have to happen at once here. Headings split across text lines have to join — "As at"
 * and "March 31, 2024" are printed separately and mean nothing apart. And a heading centred over
 * several columns has to reach all of them: "Rural" sits above three year columns, and a year
 * column labelled only "2023-24" cannot be told from the Urban one beside it.
 *
 * So each heading row is read column by column rather than cell by cell, with every column taking
 * the nearest cell in that row. A row is skipped for columns lying outside its own extent, which
 * is what stops the year row from labelling the row-header column "2022-23".
 */
function buildColumnHeaders(headerRows: Band[], columns: { x0: number; x1: number }[]): string[] {
  const parts: string[][] = columns.map(() => []);

  for (const row of headerRows) {
    const rowX0 = Math.min(...row.lines.map((line) => line.bbox.x0));
    const rowX1 = Math.max(...row.lines.map((line) => line.bbox.x1));

    columns.forEach((column, index) => {
      if (column.x1 < rowX0 || column.x0 > rowX1) return;

      const centre = (column.x0 + column.x1) / 2;
      const nearest = row.lines.reduce((best, line) => {
        const distance = Math.abs((line.bbox.x0 + line.bbox.x1) / 2 - centre);
        const bestDistance = Math.abs((best.bbox.x0 + best.bbox.x1) / 2 - centre);
        return distance < bestDistance ? line : best;
      });

      const text = nearest.text.trim();
      if (text.length > 0 && !parts[index]!.includes(text)) parts[index]!.push(text);
    });
  }

  return parts.map((column) => column.join(" ").trim());
}

export function reconstructTables(
  lines: ParsedLine[],
  bands: ColumnBand[],
  pageNumber: number,
): ReconstructedTable[] {
  const tables: ReconstructedTable[] = [];
  const heights = lines.map((line) => line.bbox.y1 - line.bbox.y0).filter((h) => h > 0);
  const lineHeight = median(heights) || 10;
  const tolerance = lineHeight * ROW_TOLERANCE_RATIO;

  for (const band of bands) {
    const bandLines = lines.filter((line) => bandOf(bands, line) === band.index);
    if (bandLines.length === 0) continue;

    const rows = clusterRows(bandLines, tolerance);

    for (const run of findRuns(rows)) {
      const spanned = rows.slice(run.start, run.end + 1);
      const firstBody = spanned.findIndex(isBodyRow);
      const lastBody = spanned.findLastIndex(isBodyRow);

      // No row of values means this was never a table. Prose sets rows of two and three fragments
      // all the time — an auditors' report, a governance disclosure, a signature block — and
      // filing those as tables that failed to resolve would point a later vision read at pages of
      // running text. A grid is only a grid once something in it is a value.
      if (firstBody === -1) continue;

      // The run is trimmed to its last row of values. Footnotes below a table wrap into two or
      // three segments that cluster as multi-cell rows, and one of those spanning the full table
      // width would otherwise merge every column into one.
      const gridded = spanned.slice(0, lastBody + 1);

      // Everything before the first row of values is heading. Single-cell rows in that stretch are
      // section labels, not column headings, and are left out rather than joined into one.
      const headerRows =
        firstBody <= 0
          ? []
          : gridded.slice(0, firstBody).filter((row) => row.lines.length >= MIN_CELLS_PER_ROW);
      const bodyRows = gridded.slice(firstBody);
      const columns = assignColumns(bodyRows.filter(isBodyRow));

      const above = rows.slice(0, run.start).flatMap((row) => row.lines);
      const below = rows.slice(run.start + lastBody + 1).flatMap((row) => row.lines);

      const bbox =
        unionBbox(gridded.flatMap((row) => row.lines.map((line) => line.bbox))) ??
        ({ x0: band.x0, y0: 0, x1: band.x1, y1: 0 } satisfies Bbox);

      // A grid nobody can read a column out of is worse than no grid: it attaches real numbers to
      // the wrong heading, and the evidence gate cannot catch that because the quote is genuine.
      // This now means what it says — a real grid that would not resolve, worth a vision read.
      const ragged =
        columns.length < MIN_CELLS_PER_ROW ? `only ${columns.length} column(s) resolved` : null;

      // A table continued past a page break or a section heading has no heading row of its own.
      // Taking the previous table's headings, when the grids line up, is the difference between
      // eighteen rows of real balance-sheet values and eighteen rows nothing can label.
      const continued =
        headerRows.length === 0
          ? (tables.findLast(
              (t) => t.bandIndex === band.index && t.columnHeaders.length === columns.length,
            )?.columnHeaders ?? [])
          : buildColumnHeaders(headerRows, columns);

      tables.push({
        id: `p${pageNumber}t${tables.length + 1}`,
        bandIndex: band.index,
        bbox,
        quality: ragged ? "ragged" : "clean",
        raggedReason: ragged,
        title: findTitle(above, CONTEXT_REACH),
        unitLine: findUnitLine(above),
        columnHeaders: ragged ? [] : continued,
        footnotes: below.filter((line) => FOOTNOTE.test(line.text)).map((line) => line.text),
        rows: ragged ? [] : bodyRows.map((row) => toRow(row, columns)),
      });
    }
  }

  return tables;
}
