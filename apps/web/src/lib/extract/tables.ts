import type { TableCell } from "@superfact/db/contracts";

import type { ExtractionPage, TableExtractionBatch, TableExtractionInput } from "./types.ts";

function rowHeader(cells: readonly TableCell[]): TableCell | undefined {
  return [...cells].sort((a, b) => a.column - b.column).find((cell) => !/\d/.test(cell.text));
}

/** Makes every non-header table cell carry the context needed to interpret it. */
export function buildTableInputs(pages: readonly ExtractionPage[]): TableExtractionInput[] {
  return pages.flatMap((page) =>
    page.tables.flatMap((table) => {
      if (table.quality !== "clean") return [];

      return table.rows.flatMap((row, rowIndex) => {
        const header = rowHeader(row.cells);
        return row.cells
          .filter((cell) => cell !== header && cell.text.trim().length > 0)
          .map((cell) => ({
            id: `${table.id}-r${rowIndex + 1}-c${cell.column + 1}`,
            documentId: page.documentId,
            pageNumber: page.pageNumber,
            tableId: table.id,
            value: cell.text,
            lineIds: cell.lineIds,
            context: {
              title: table.title,
              rowHeader: header?.text ?? null,
              columnHeader: table.columnHeaders[cell.column] || null,
              unitLine: table.unitLine,
              footnotes: table.footnotes,
            },
          }));
      });
    }),
  );
}

/** Groups cells into one model call per reconstructed table. */
export function batchTableInputs(pages: readonly ExtractionPage[]): TableExtractionBatch[] {
  const groups = new Map<string, TableExtractionBatch>();

  for (const cell of buildTableInputs(pages)) {
    const key = `${cell.documentId}:${cell.pageNumber}:${cell.tableId}`;
    const batch = groups.get(key);
    if (batch) batch.cells.push(cell);
    else {
      groups.set(key, {
        id: `${cell.tableId}-cells`,
        documentId: cell.documentId,
        pageNumber: cell.pageNumber,
        tableId: cell.tableId,
        cells: [cell],
      });
    }
  }

  return [...groups.values()];
}
