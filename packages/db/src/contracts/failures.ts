import { z } from "zod";

import { documentFailureReason } from "../schema/documents.ts";
import { pageFailureReason } from "../schema/pages.ts";
import { rejectedAssertionSchema } from "./assertions.ts";

/** A document the system refused outright — encrypted, corrupt, or with no text layer to read. */
export const documentFailureSchema = z.object({
  documentId: z.uuid(),
  filename: z.string(),
  reason: z.enum(documentFailureReason.enumValues),
  detail: z.string().nullable(),
});

export type DocumentFailure = z.infer<typeof documentFailureSchema>;

/** A page that failed inside an otherwise successful document. */
export const pageFailureSchema = z.object({
  documentId: z.uuid(),
  page: z.number().int().positive(),
  reason: z.enum(pageFailureReason.enumValues),
  detail: z.string().nullable(),
});

export type PageFailure = z.infer<typeof pageFailureSchema>;

/**
 * Everything the system declined to publish, in one place.
 *
 * The failures view reads this. An empty `failures` block on a real run is a symptom, not a
 * success — it means failures are being swallowed somewhere upstream.
 */
export const failuresSchema = z.object({
  documents: z.array(documentFailureSchema),
  pages: z.array(pageFailureSchema),
  assertions: z.array(rejectedAssertionSchema),
});

export type Failures = z.infer<typeof failuresSchema>;
