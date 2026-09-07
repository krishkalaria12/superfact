import { db, jobs } from "@superfact/db";
import { env } from "@superfact/env/server";
import { desc } from "@superfact/db/orm";

import { inngest, jobRunRequested } from "@/inngest/client";
import { createError, useLogger, withEvlog } from "@/lib/evlog";
import { PIPELINE_VERSION } from "@/lib/pipeline";

/**
 * The phase 00 exit check, as an endpoint. `POST` commits a job row with no document attached and
 * emits the event that drives it through the placeholder stages; `GET` reads the rows back, so one
 * job ID is visible in the database and in the logs. Phase 02 replaces this with real uploads.
 */

function refuseInProduction() {
  if (env.NODE_ENV === "production") {
    throw createError({
      status: 404,
      message: "Not found",
      why: "The sample-job endpoint exists only to exercise the pipeline locally",
      fix: "Upload a document through the upload API instead",
    });
  }
}

export const POST = withEvlog(async () => {
  refuseInProduction();

  const [job] = await db.insert(jobs).values({ pipelineVersion: PIPELINE_VERSION }).returning();

  if (!job) {
    throw createError({ status: 500, message: "Could not create a sample job" });
  }

  const log = useLogger();
  log.set({ job: { id: job.id, pipelineVersion: job.pipelineVersion } });
  log.info("sample job created");

  await inngest.send(jobRunRequested.create({ jobId: job.id }));

  return Response.json({ jobId: job.id, status: job.status });
});

export const GET = withEvlog(async () => {
  refuseInProduction();

  const recent = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(10);

  return Response.json({ jobs: recent });
});
