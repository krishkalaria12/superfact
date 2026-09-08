import { env } from "@superfact/env/server";
import { eventType, Inngest } from "inngest";
import { z } from "zod";

/** Emitted once a job row is committed. Carries the job ID and nothing derived from it. */
export const jobRunRequested = eventType("job/run.requested", {
  schema: z.object({ jobId: z.uuid() }),
});

/**
 * One slice of a document's pages, for the parse stage to fan out over.
 *
 * The range is half-open and zero-based, matching MuPDF's page indices, so a batch can be replayed
 * from the event alone without consulting anything else.
 */
export const pageBatchRequested = eventType("document/page-batch.requested", {
  schema: z.object({
    jobId: z.uuid(),
    documentId: z.uuid(),
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
  }),
});

/**
 * One set of parsed pages handed to the extractor.
 *
 * A list rather than a range, because extraction runs densest-page-first: the pages in a batch are
 * whichever ranked together, and they are rarely contiguous. Page numbers are one-based here,
 * matching the `pages` rows, where the parse events are zero-based to match MuPDF.
 */
export const extractionBatchRequested = eventType("document/extraction-batch.requested", {
  schema: z.object({
    jobId: z.uuid(),
    documentId: z.uuid(),
    pipelineVersion: z.string().min(1),
    pageNumbers: z.array(z.number().int().positive()).min(1),
  }),
});

/**
 * One slice of a document's candidate pairs, for the relate stage to fan out over.
 *
 * The pairs travel in the event rather than being read back, because phase 06 stores none: they are
 * an intermediate the parent computes once and hands down. Two ids a pair is small enough that a
 * batch stays well inside the event size limit.
 */
export const pairBatchRequested = eventType("document/pair-batch.requested", {
  schema: z.object({
    jobId: z.uuid(),
    documentId: z.uuid(),
    pipelineVersion: z.string().min(1),
    pairs: z.array(z.object({ sourceAssertionId: z.uuid(), targetAssertionId: z.uuid() })).min(1),
  }),
});

export const inngest = new Inngest({
  id: "superfact",
  // The local Inngest dev server needs no keys; cloud mode requires a signing key.
  isDev: env.NODE_ENV !== "production",
});
