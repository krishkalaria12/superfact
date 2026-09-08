import { adjudicatePairBatch } from "@/lib/adjudication/relate";
import { adjudicationModel } from "@/lib/adjudication-model";
import { useLogger } from "@/lib/evlog";
import { inngest, pairBatchRequested } from "../client";

/**
 * Judges one slice of one document's candidate pairs.
 *
 * Its own function rather than a step, for the same reason parse and extract fan out: Inngest
 * checkpoints several steps of one function into a single request, and a document with hundreds of
 * pairs at one or two model calls each is far past what the deployment target lets one request run.
 *
 * The concurrency limit here multiplies by the per-batch concurrency inside the adjudicator, and
 * their product is what the model provider's rate limit actually sees.
 */
export const adjudicatePairBatchFunction = inngest.createFunction(
  {
    id: "adjudicate-pair-batch",
    triggers: [pairBatchRequested],
    retries: 2,
    concurrency: { limit: 3 },
  },
  async ({ attempt, event, step }) => {
    const { jobId, documentId, pipelineVersion, pairs } = event.data;

    return step.run("adjudicate", async () => {
      const startedAt = Date.now();
      const result = await adjudicatePairBatch(pairs, adjudicationModel, pipelineVersion);
      // Named, not just counted. A pair that produced no edge is a missing relationship, and the
      // reason is the only thing that says whether the model or the data was at fault.
      const skips = result.skipped.map((item) => `${item.pairKey} ${item.reason}: ${item.detail}`);

      const log = useLogger();
      log.set({
        job: { id: jobId, documentId, pipelineVersion, stages: ["relate"] },
        adjudicate: {
          pairs: result.stats.pairs,
          settled: result.stats.settled,
          judged: result.stats.judged,
          reviewed: result.stats.reviewed,
          downgraded: result.stats.downgraded,
          withheld: result.stats.withheld,
          corroborates: result.stats.corroborates,
          contradicts: result.stats.contradicts,
          reconciles: result.stats.reconciles,
          insufficient: result.stats.insufficient,
          skipped: result.stats.skipped,
          skips,
        },
        timing: { stage: "relate", durationMs: Date.now() - startedAt, attempt: attempt + 1 },
      });
      log.info(`adjudicated ${result.stats.pairs} pair(s) into ${result.written} edge(s)`);

      return { ...result.stats, skips };
    });
  },
);
