import { z } from "zod";

/**
 * A rectangle in the parser's coordinate space — PDF points, origin top-left, exactly as MuPDF
 * reports them.
 *
 * The page raster is rendered from that same space at a recorded scale, so the evidence viewer
 * draws a highlight by multiplying these four numbers by that scale. There is no transform
 * between two libraries' conventions, which is why the "evidence points at the wrong region"
 * risk is retired rather than mitigated.
 */
export const bboxSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

export type Bbox = z.infer<typeof bboxSchema>;

/**
 * One line of text as the parser read it.
 *
 * `id` is what an extracted assertion cites, so it has to survive into storage unchanged and stay
 * unique within its page. The parser mints it as `p{page}l{index}`; nothing downstream
 * reconstructs it from position.
 *
 * A "line" here is MuPDF's line, which on a table page is one cell rather than one visual row.
 * That is the useful granularity: cells are what carry values, and rows are rebuilt from them.
 */
export const parsedLineSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  bbox: bboxSchema,
  /**
   * The largest glyph size on the line, in points.
   *
   * Carried because it is the one signal that separates a table's title from the body text above
   * it without knowing anything about the document. Reading order and indentation both fail on a
   * page where the running header sits closer to the table than the heading does.
   */
  size: z.number().nonnegative(),
});

export type ParsedLine = z.infer<typeof parsedLineSchema>;

/** The smallest box containing all of `boxes`, or `null` when given none. */
export function unionBbox(boxes: readonly Bbox[]): Bbox | null {
  const [first, ...rest] = boxes;
  if (!first) return null;

  return rest.reduce<Bbox>(
    (acc, box) => ({
      x0: Math.min(acc.x0, box.x0),
      y0: Math.min(acc.y0, box.y0),
      x1: Math.max(acc.x1, box.x1),
      y1: Math.max(acc.y1, box.y1),
    }),
    first,
  );
}
