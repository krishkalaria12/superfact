import { assertions, db, documents, edges, JOB_STAGES, jobs, pages } from "@superfact/db";
import type { JobStage } from "@superfact/db";
import { and, eq, inArray } from "@superfact/db/orm";

import { useLogger } from "@/lib/evlog";
import { planPageBatches } from "@/lib/parse";
import { inngest, jobRunRequested } from "../client";
import { extractPageBatch } from "./extract-page-batch";
import { parsePageBatch } from "./parse-page-batch";

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
        const failureReason = job.stage === "extract" ? "extraction_failed" : "parse_failed";
        await db
          .update(documents)
          .set({ status: "failed", failureReason, failureDetail: error.message })
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
      const batches = await step.run(`stage:${stage}`, async () => {
        const log = useLogger();
        log.set({ job: { ...job, stages: [stage] } });

        await db.update(jobs).set({ stage }).where(eq(jobs.id, job.id));
        await clearStageOutput(stage, job.documentId, job.pipelineVersion);

        if (stage === "relate") {
          // Phases 06-07 fill in relation and adjudication.
          log.info(`stage ${stage} finished with no work to do`);
          return [];
        }

        const [document] = await db
          .select()
          .from(documents)
          .where(eq(documents.id, job.documentId));

        if (!document) throw new Error(`no document ${job.documentId}`);
        if (!document.pageCount) throw new Error(`document ${document.id} has no page count`);

        const planned = planPageBatches(document.pageCount);
        log.info(`${stage} planned ${document.pageCount} pages in ${planned.length} batch(es)`);
        return planned;
      });

      if (batches.length === 0) continue;

      if (stage === "extract") {
        const results = await Promise.all(
          batches.map((batch) =>
            step.invoke(`extract:pages:${batch.from}-${batch.to}`, {
              function: extractPageBatch,
              data: {
                jobId: job.id,
                documentId: job.documentId,
                pipelineVersion: job.pipelineVersion,
                from: batch.from,
                to: batch.to,
              },
            }),
          ),
        );

        await step.run("stage:extract:summary", async () => {
          const summary = results.reduce(
            (total, result) => ({
              pages: total.pages + result.pages,
              candidates: total.candidates + result.candidates,
              stored: total.stored + result.stored,
              rejected: total.rejected + result.rejected,
            }),
            { pages: 0, candidates: 0, stored: 0, rejected: 0 },
          );
          const log = useLogger();
          log.set({ job: { ...job, stages: ["extract"] }, extract: summary });
          log.info(`stored ${summary.stored} assertion candidates from ${summary.pages} pages`);
        });
        continue;
      }

      // Each batch is its own function run, so each gets its own request budget. The parent only
      // waits here — it is suspended between the invocations rather than holding a connection
      // open — so the length of a document stops being a constraint on any single request.
      const results = await Promise.all(
        batches.map((batch) =>
          step.invoke(`parse:pages:${batch.from}-${batch.to}`, {
            function: parsePageBatch,
            data: { jobId: job.id, documentId: job.documentId, from: batch.from, to: batch.to },
          }),
        ),
      );

      await step.run("stage:parse:summary", async () => {
        const parsed = results.reduce((n, r) => n + r.parsed, 0);
        const failed = results.reduce((n, r) => n + r.failed, 0);
        const pageCount = results.reduce((n, r) => Math.max(n, r.pageCount), 0);

        const log = useLogger();
        log.set({ job: { ...job, stages: ["parse"] }, parse: { pageCount, parsed, failed } });
        log.info(`parsed ${parsed} of ${pageCount} pages`);

        // Every page failing is a failed document, not a document that parsed into nothing.
        if (parsed === 0 && pageCount > 0) {
          throw new Error(`every page of document ${job.documentId} failed to parse`);
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
