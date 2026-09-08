import { assertions, db, documents, jobs } from "@superfact/db";
import { and, count, desc, eq, getTableColumns, inArray } from "@superfact/db/orm";
import { toRejectedAssertion, toPublishedAssertion } from "@superfact/db/projection";

import { readCoverage } from "@/lib/documents";
import { createError, withEvlog } from "@/lib/evlog";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const { embedding: _embedding, ...assertionColumns } = getTableColumns(assertions);

/**
 * Read-only: this document's facts as they stand right now.
 *
 * The point is that it answers mid-run. Extraction fans out over ranked page batches and each batch
 * commits its rows as it finishes, so a caller polling this endpoint watches facts arrive while
 * later pages are still being read — which is what makes a long document feel fast. Nothing here
 * waits for the job.
 *
 * `progress` travels with the facts for that reason: a list of forty facts means something
 * different at page 12 of 400 than at the end, and a client should not have to make a second
 * request to tell those apart.
 *
 * `?status=rejected` returns what the grounding gate refused instead, with its reason codes. An
 * empty rejected list on a real run is a symptom rather than a success.
 */
export const GET = withEvlog(
  async (request: Request, context: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await context.params;
    const params = new URL(request.url).searchParams;

    const status = params.get("status") ?? "published";
    if (status !== "published" && status !== "rejected") {
      throw createError({
        status: 400,
        message: `Unknown status ${status}; expected published or rejected`,
      });
    }

    const requested = Number(params.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const offset = Math.max(Math.trunc(Number(params.get("offset") ?? 0)) || 0, 0);

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!document) {
      throw createError({ status: 404, message: `No document ${documentId}` });
    }

    const scope = and(eq(assertions.documentId, documentId), eq(assertions.status, status));

    const [total] = await db.select({ value: count() }).from(assertions).where(scope);

    const rows = await db
      .select(assertionColumns)
      .from(assertions)
      .where(scope)
      // Salience first, then the extractor's own confidence. Neither ever decided a verdict;
      // ranking the list is the only thing they are for.
      .orderBy(desc(assertions.salience), desc(assertions.confidence), assertions.pageNumber)
      .limit(limit)
      .offset(offset);

    const [job] = await db
      .select({ id: jobs.id, stage: jobs.stage, status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.documentId, documentId), inArray(jobs.status, ["queued", "running"])))
      .orderBy(desc(jobs.createdAt))
      .limit(1);

    return Response.json({
      document: {
        id: document.id,
        filename: document.filename,
        status: document.status,
        pipelineVersion: document.pipelineVersion,
      },
      progress: {
        ...(await readCoverage(documentId)),
        // Null once nothing is queued or running, which is how a caller knows to stop polling.
        job: job ?? null,
      },
      total: total?.value ?? 0,
      offset,
      facts: rows.map((row) =>
        status === "published"
          ? toPublishedAssertion({ ...row, embedding: null })
          : toRejectedAssertion({ ...row, embedding: null }),
      ),
    });
  },
);
