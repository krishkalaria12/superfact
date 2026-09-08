import { db, documents } from "@superfact/db";
import { eq } from "@superfact/db/orm";

import { useLogger } from "@/lib/evlog";
import { parsePageRange } from "@/lib/parse";
import { inngest, pageBatchRequested } from "../client";

/**
 * Parses one slice of one document's pages.
 *
 * It exists as its own function rather than a step so that each slice gets its own HTTP request.
 * Inngest checkpoints several steps of one function into a single request, so splitting the parse
 * stage into steps would not have bounded how long any one request runs — and the deployment
 * target caps that duration. At roughly 0.8 seconds a page, a few hundred pages in one request is
 * past every limit worth designing against.
 *
 * The concurrency limit is the other half: without it a long document would open its own bytes in
 * twenty places at once and upload rasters faster than storage cares to accept them.
 */
export const parsePageBatch = inngest.createFunction(
  {
    id: "parse-page-batch",
    triggers: [pageBatchRequested],
    retries: 2,
    // Multiplied by CHUNK in the parser, this is how many uploads storage sees at once.
    concurrency: { limit: 2 },
  },
  async ({ attempt, event, step }) => {
    const { jobId, documentId, from, to } = event.data;

    return step.run("parse", async () => {
      const startedAt = Date.now();
      const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
      if (!document) throw new Error(`no document ${documentId}`);

      const summary = await parsePageRange(document, from, to);

      const log = useLogger();
      log.set({
        job: { id: jobId, documentId, stages: ["parse"] },
        parse: summary,
        timing: { stage: "parse", durationMs: Date.now() - startedAt, attempt: attempt + 1 },
      });
      log.info(`parsed pages ${from + 1}-${to}`);

      return summary;
    });
  },
);
