import { db, jobs } from "@superfact/db";
import { eq } from "@superfact/db/orm";

import { readCoverage } from "@/lib/documents";
import { createError, withEvlog } from "@/lib/evlog";

/**
 * Read-only: where a run has got to.
 *
 * Coverage travels with the job because a partial run is the interesting case — a job that failed
 * at page 300 of 400 should read as 299 parsed and one failed, not as a bare "failed".
 */
export const GET = withEvlog(
  async (_request: Request, context: { params: Promise<{ jobId: string }> }) => {
    const { jobId } = await context.params;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

    if (!job) {
      throw createError({ status: 404, message: `No job ${jobId}` });
    }

    return Response.json({
      job: {
        id: job.id,
        documentId: job.documentId,
        stage: job.stage,
        status: job.status,
        pipelineVersion: job.pipelineVersion,
        failureReason: job.failureReason,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
      coverage: await readCoverage(job.documentId),
    });
  },
);
