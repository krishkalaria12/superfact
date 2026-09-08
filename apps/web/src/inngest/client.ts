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

/** One parsed page range handed to the phase 04 extractor. */
export const extractionBatchRequested = eventType("document/extraction-batch.requested", {
  schema: z.object({
    jobId: z.uuid(),
    documentId: z.uuid(),
    pipelineVersion: z.string().min(1),
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
  }),
});

export const inngest = new Inngest({
  id: "superfact",
  // The local Inngest dev server needs no keys; cloud mode requires a signing key.
  isDev: env.NODE_ENV !== "production",
});
