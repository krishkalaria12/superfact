import { assertions, db, documents, edges, JOB_STAGES, jobs, pages } from "@superfact/db";
import type { JobStage } from "@superfact/db";
import { and, eq, inArray } from "@superfact/db/orm";

import { useLogger } from "@/lib/evlog";
import { parseDocument } from "@/lib/parse";
import { inngest, jobRunRequested } from "../client";

/**
 * The durable spine: parse, then extract, then relate.
 *
 * Parse is real from phase 03; extract and relate stay placeholders until phases 04 and 06-07.
 * What holds across all three is that each is safe to run twice. Inngest retries a step on failure
 * and replays completed steps on a later attempt, so a stage that appended to its output would
 * double it. Each stage therefore clears its own output for this document at this pipeline version
 * before producing any, which makes the run idempotent by construction rather than by every future
 * stage remembering to check.
 */

/**
 * Drops whatever a stage produced last time, so the stage can be re-entered from a clean slate.
 *
 * Ordering matters: edges reference assertions and assertions reference pages, so clearing runs
 * outward from the leaves. Postgres would cascade anyway; doing it explicitly keeps the intent
 * readable and keeps a stage from depending on a foreign key's `on delete` clause.
 */
async function clearStageOutput(stage: JobStage, documentId: string, pipelineVersion: string) {
  const documentAssertions = db
    .select({ id: assertions.id })
    .from(assertions)
    .where(
      and(eq(assertions.documentId, documentId), eq(assertions.pipelineVersion, pipelineVersion)),
    );

  switch (stage) {
    case "relate":
      await db.delete(edges).where(inArray(edges.sourceAssertionId, documentAssertions));
      await db.delete(edges).where(inArray(edges.targetAssertionId, documentAssertions));
      return;
    case "extract":
      await db
        .delete(assertions)
        .where(
          and(
            eq(assertions.documentId, documentId),
            eq(assertions.pipelineVersion, pipelineVersion),
          ),
        );
      return;
    case "parse":
      await db.delete(pages).where(eq(pages.documentId, documentId));
      return;
  }
}

export const runPipeline = inngest.createFunction(
  {
    id: "run-pipeline",
    triggers: [jobRunRequested],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { jobId } = event.data.event.data;

      const log = useLogger();
      log.set({ job: { id: jobId } });
      log.error(error);

      const [job] = await db
        .update(jobs)
        .set({ status: "failed", failureReason: error.message, completedAt: new Date() })
        .where(eq(jobs.id, jobId))
        .returning();

      // The document carries the failure too. A run that died is not a document that is still
      // pending, and the failures view reads documents rather than jobs.
      if (job) {
        await db
          .update(documents)
          .set({ status: "failed", failureReason: "parse_failed", failureDetail: error.message })
          .where(eq(documents.id, job.documentId));
      }
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data;

    const job = await step.run("start", async () => {
      const [row] = await db
        .update(jobs)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(jobs.id, jobId))
        .returning();

      if (!row) throw new Error(`no job ${jobId}`);

      await db.update(documents).set({ status: "parsing" }).where(eq(documents.id, row.documentId));

      const log = useLogger();
      log.set({
        job: { id: row.id, documentId: row.documentId, pipelineVersion: row.pipelineVersion },
      });
      log.info("pipeline started");

      return { id: row.id, documentId: row.documentId, pipelineVersion: row.pipelineVersion };
    });

    for (const stage of JOB_STAGES) {
      await step.run(`stage:${stage}`, async () => {
        const log = useLogger();
        log.set({ job: { ...job, stages: [stage] } });

        await db.update(jobs).set({ stage }).where(eq(jobs.id, job.id));
        await clearStageOutput(stage, job.documentId, job.pipelineVersion);

        if (stage !== "parse") {
          // Phase 04 fills in extract, phases 06-07 relate.
          log.info(`stage ${stage} finished with no work to do`);
          return;
        }

        const [document] = await db
          .select()
          .from(documents)
          .where(eq(documents.id, job.documentId));

        if (!document) throw new Error(`no document ${job.documentId}`);

        const summary = await parseDocument(document);
        log.set({ parse: summary });
        log.info(`parsed ${summary.parsed} of ${summary.pageCount} pages`);

        // Every page failing is a failed document, not a document that parsed into nothing.
        if (summary.parsed === 0 && summary.pageCount > 0) {
          throw new Error(`every page of document ${document.id} failed to parse`);
        }
      });
    }

    await step.run("finish", async () => {
      const log = useLogger();
      log.set({ job });

      await db
        .update(jobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(jobs.id, job.id));

      // Stamping the version here is what makes the next upload of these bytes reusable.
      await db
        .update(documents)
        .set({ status: "ready", pipelineVersion: job.pipelineVersion })
        .where(eq(documents.id, job.documentId));

      log.info("pipeline completed");
    });

    return { jobId: job.id, documentId: job.documentId, stages: JOB_STAGES };
  },
);
