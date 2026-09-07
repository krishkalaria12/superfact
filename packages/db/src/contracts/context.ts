import { z } from "zod";

/**
 * Qualifiers the document itself named.
 *
 * The keys are not fixed by this schema, deliberately: a macro report produces `fiscal_year` and
 * `geography` where a logistics filing produces `segment` and `quarter`, and pinning the set here
 * would mean a schema change per document family. Values stay strings so two documents' qualifiers
 * compare without a type negotiation.
 */
export const qualifiersSchema = z.record(z.string().min(1), z.string());

export type Qualifiers = z.infer<typeof qualifiersSchema>;

/**
 * Everything governing a table cell, captured before the number is allowed to become an assertion.
 *
 * `unitLine` is separate from the cell because of what the parser does to currency: the rupee
 * glyph decodes as `I` where the font's encoding map omits it, so the unit has to come from the
 * governing header — "All amounts in Indian Rupees in million" — and never from the character
 * sitting in the cell.
 */
export const tableContextSchema = z.object({
  title: z.string().nullable(),
  columnHeader: z.string().nullable(),
  rowHeader: z.string().nullable(),
  unitLine: z.string().nullable(),
  footnotes: z.array(z.string()).default([]),
});

export type TableContext = z.infer<typeof tableContextSchema>;
