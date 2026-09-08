import { z } from "zod";

import { bboxSchema } from "./geometry.ts";

/**
 * A reconstructed table, built from coordinates rather than from any ruling the document may or
 * may not have drawn.
 *
 * None of the six starter documents draws its tables — every one is aligned with whitespace alone,
 * and the vector walker returns nothing on their table pages. So the geometric path is the primary
 * one and rulings, where they exist, only sharpen it.
 */

/**
 * A vertical slice of a page separated from its neighbours by whitespace no line crosses.
 *
 * Splitting on these before clustering rows is what keeps a two-up spread from reading as one
 * table with interleaved rows. It also has to *not* fire on an ordinary table's inter-column gaps,
 * which is why a band boundary is the complement of merged line coverage: a title spanning the
 * columns covers those gaps and rules them out on its own.
 */
export const columnBandSchema = z.object({
  index: z.number().int().nonnegative(),
  x0: z.number(),
  x1: z.number(),
});

export type ColumnBand = z.infer<typeof columnBandSchema>;

export const tableCellSchema = z.object({
  text: z.string(),
  bbox: bboxSchema,
  lineIds: z.array(z.string().min(1)),
  column: z.number().int().nonnegative(),
});

export type TableCell = z.infer<typeof tableCellSchema>;

export const tableRowSchema = z.object({
  cells: z.array(tableCellSchema),
  bbox: bboxSchema,
});

export type TableRow = z.infer<typeof tableRowSchema>;

/**
 * Whether the grid resolved cleanly enough to hand downstream.
 *
 * `ragged` tables keep their bounding box and their raster and emit no rows. A malformed grid is
 * worse than no grid: it produces numbers attached to the wrong header, which is exactly the
 * failure the evidence gate cannot catch.
 */
export const tableQuality = ["clean", "ragged"] as const;
export const tableQualitySchema = z.enum(tableQuality);

export const reconstructedTableSchema = z.object({
  /** Stable within its page: `p{page}t{index}`. */
  id: z.string().min(1),
  bandIndex: z.number().int().nonnegative(),
  bbox: bboxSchema,
  quality: tableQualitySchema,
  /** Why a table was called ragged. Null when it resolved. */
  raggedReason: z.string().nullable(),
  /** The largest-type line above the table in its band. */
  title: z.string().nullable(),
  /** A fully parenthesised line above the table — where the unit actually lives. */
  unitLine: z.string().nullable(),
  /** One entry per column, headers on separate text lines already joined. */
  columnHeaders: z.array(z.string()),
  footnotes: z.array(z.string()),
  rows: z.array(tableRowSchema),
});

export type ReconstructedTable = z.infer<typeof reconstructedTableSchema>;
