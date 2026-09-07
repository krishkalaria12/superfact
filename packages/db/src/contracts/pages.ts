import { z } from "zod";

import { parsedLineSchema } from "./geometry";
import { columnBandSchema, reconstructedTableSchema } from "./tables";

/**
 * Signals that say whether a page was worth reading, recorded per page rather than per document
 * so one bad page cannot be hidden by 400 good ones.
 *
 * `replacementCharRatio` is the scanned-document tell; `imageRatio` catches a page that is mostly
 * a chart the parser cannot read.
 */
export const pageQualitySchema = z.object({
  /** Characters of extracted text per 1000 square points of page area. */
  textDensity: z.number().min(0),
  replacementCharRatio: z.number().min(0).max(1),
  imageRatio: z.number().min(0).max(1),
});

export type PageQuality = z.infer<typeof pageQualitySchema>;

/** Where the page image lives, and the scale it was rendered at. */
export const pageRasterSchema = z.object({
  key: z.string().min(1),
  url: z.url(),
  /** Raster pixels per PDF point. A stored bbox times this scale is the box on screen. */
  scale: z.number().positive(),
});

export type PageRaster = z.infer<typeof pageRasterSchema>;

/** What the parser hands to storage for one page it read successfully. */
export const parsedPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  text: z.string(),
  lines: z.array(parsedLineSchema),
  bands: z.array(columnBandSchema),
  tables: z.array(reconstructedTableSchema),
  raster: pageRasterSchema.nullable(),
  quality: pageQualitySchema,
});

export type ParsedPage = z.infer<typeof parsedPageSchema>;
