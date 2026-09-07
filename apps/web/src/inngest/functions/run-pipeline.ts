import { db, JOB_STAGES, jobs } from "@superfact/db";
import { eq } from "@superfact/db/orm";

import { useLogger } from "@/lib/evlog";
import { PIPELINE_VERSION } from "@/lib/pipeline";
import { inngest, jobRunRequested } from "../client";

/**
 * The durable spine: parse, then extract, then relate.
 *
 * Every stage is a placeholder until its own phase fills it in. What is real here is the shape —
 * one job row that advances a stage at a time, and one job ID on every wide event the run emits,
 * so a partially failed run is legible from the database and the logs alone.
 */
export const runPipeline = inngest.createFunction(
  {
    id: "run-pipeline",
    triggers: [jobRunRequested],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { jobId } = event.data.event.data;

      const log = useLogger();
      log.set({ job: { id: jobId, pipelineVersion: PIPELINE_VERSION } });
      log.error(error);

      await db
        .update(jobs)
        .set({ status: "failed", failureReason: error.message, completedAt: new Date() })
        .where(eq(jobs.id, jobId));
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data;
    const job = { id: jobId, pipelineVersion: PIPELINE_VERSION };

    await step.run("start", async () => {
      const log = useLogger();
      log.set({ job });
      log.info("pipeline started");

      await db
        .update(jobs)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(jobs.id, jobId));
    });

    for (const stage of JOB_STAGES) {
      await step.run(`stage:${stage}`, async () => {
        const log = useLogger();
        log.set({ job: { ...job, stages: [stage] } });

        await db.update(jobs).set({ stage }).where(eq(jobs.id, jobId));

        // Phase 03 fills in parse, phase 04 extract, phases 06-07 relate.
        log.info(`stage ${stage} finished with no work to do`);
      });
    }

    await step.run("finish", async () => {
      const log = useLogger();
      log.set({ job });

      await db
        .update(jobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(jobs.id, jobId));

      log.info("pipeline completed");
    });

    return { jobId, stages: JOB_STAGES };
  },
);
