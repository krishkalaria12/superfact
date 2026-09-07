import { z } from "zod";

import { documentStatus } from "../schema/documents";
import { publishedAssertionSchema } from "./assertions";
import { claimEdgeSchema } from "./edges";
import { failuresSchema } from "./failures";

/** How far a document got, and how much of it was readable. */
export const documentSummarySchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  contentHash: z.string(),
  status: z.enum(documentStatus.enumValues),
  pageCount: z.number().int().nonnegative().nullable(),
  pagesParsed: z.number().int().nonnegative(),
  pagesFailed: z.number().int().nonnegative(),
});

export type DocumentSummary = z.infer<typeof documentSummarySchema>;

/**
 * The JSON a reviewer downloads: facts with their evidence and qualifiers, the relationships
 * between them, everything that failed, and the pipeline version it all came from.
 *
 * Operational noise stays in the logs. What is here is what someone would need to check the
 * system's work without running it.
 */
export const runExportSchema = z.object({
  pipelineVersion: z.string().min(1),
  exportedAt: z.iso.datetime(),
  documents: z.array(documentSummarySchema),
  facts: z.array(publishedAssertionSchema),
  edges: z.array(claimEdgeSchema),
  failures: failuresSchema,
});

export type RunExport = z.infer<typeof runExportSchema>;
