import { createHash } from "node:crypto";

import { db, documents, jobs, pages } from "@superfact/db";
import type { Document, DocumentFailureReason } from "@superfact/db";
import { and, count, desc, eq, inArray } from "@superfact/db/orm";

import { inngest, jobRunRequested } from "@/inngest/client";
import { inspectPdf } from "@/lib/pdf";
import { documentObjectId, putObject } from "@/lib/storage";
import { PIPELINE_VERSION } from "@/lib/pipeline";

/**
 * Document intake: hash, refuse, store, enqueue.
 *
 * The order matters and is the whole point of the phase. Hashing comes first so a file the system
 * has already processed costs one index lookup instead of a parse. Validation comes second, on the
 * bytes in memory, so a refused document never reaches storage. Only then is anything uploaded,
 * and only then does a job exist to be retried.
 */

/** Beyond this the request is refused outright rather than held in memory. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export type IntakeResult =
  | { outcome: "accepted"; document: Document; jobId: string }
  | { outcome: "reused"; document: Document; jobId: null }
  | { outcome: "reprocessing"; document: Document; jobId: string }
  | { outcome: "refused"; document: Document; jobId: null };

export function hashContent(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Whether a stored document's output can be taken as it stands.
 *
 * A document is only reusable when it finished at the pipeline version currently running. Anything
 * else — a failure, an interrupted run, output from an older version — gets a fresh job over the
 * bytes already in storage.
 */
function isReusable(document: Document) {
  return document.status === "ready" && document.pipelineVersion === PIPELINE_VERSION;
}

/**
 * The job for this document at this pipeline version, if one is already going to run.
 *
 * Uploading the same file twice must not do the work twice, and a job that is queued or running
 * is work already scheduled. Only a finished or failed job justifies a new one.
 */
async function pendingJobId(documentId: string): Promise<string | null> {
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.documentId, documentId),
        eq(jobs.pipelineVersion, PIPELINE_VERSION),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  return job?.id ?? null;
}

async function enqueue(documentId: string): Promise<string> {
  const alreadyRunning = await pendingJobId(documentId);
  if (alreadyRunning) return alreadyRunning;

  const [job] = await db
    .insert(jobs)
    .values({ documentId, pipelineVersion: PIPELINE_VERSION })
    .returning();

  if (!job) throw new Error(`could not create a job for document ${documentId}`);

  // Sent only after the row is committed, so the function can always load what it was given.
  await inngest.send(jobRunRequested.create({ jobId: job.id }));

  return job.id;
}

/**
 * Intake refusals, as opposed to runs that failed.
 *
 * The distinction matters on re-upload. These four were decided from the bytes, and the bytes have
 * not changed, so re-uploading gets the same answer without doing any work. `parse_failed` and
 * `extraction_failed` are not in this list: those say a run broke, which a later run — after a
 * fix, or simply on a retry — may well not.
 */
const INTAKE_REFUSALS = new Set<DocumentFailureReason>([
  "not_a_pdf",
  "encrypted",
  "corrupted",
  "scanned_unsupported",
]);

/** What to do with a document the system has seen before. Reached by upload and by upload races. */
async function resolveExisting(document: Document): Promise<IntakeResult> {
  if (document.failureReason && INTAKE_REFUSALS.has(document.failureReason)) {
    return { outcome: "refused", document, jobId: null };
  }
  if (isReusable(document)) {
    return { outcome: "reused", document, jobId: null };
  }
  return { outcome: "reprocessing", document, jobId: await enqueue(document.id) };
}

export async function intake(input: {
  bytes: Uint8Array;
  filename: string;
}): Promise<IntakeResult> {
  const contentHash = hashContent(input.bytes);

  const [existing] = await db
    .select()
    .from(documents)
    .where(eq(documents.contentHash, contentHash));

  if (existing) return resolveExisting(existing);

  const inspection = inspectPdf(input.bytes);

  if (!inspection.ok) {
    const refused = await commitDocument({
      contentHash,
      filename: input.filename,
      byteSize: input.bytes.byteLength,
      pageCount: null,
      storageKey: null,
      storageUrl: null,
      status: "failed",
      failureReason: inspection.reason,
      failureDetail: inspection.detail,
    });

    return { outcome: "refused", document: refused.document, jobId: null };
  }

  const stored = await putObject({
    bytes: input.bytes,
    filename: input.filename,
    contentType: "application/pdf",
    customId: documentObjectId(contentHash),
  });

  const committed = await commitDocument({
    contentHash,
    filename: input.filename,
    byteSize: input.bytes.byteLength,
    pageCount: inspection.pageCount,
    storageKey: stored.key,
    storageUrl: stored.url,
    status: "pending",
    failureReason: null,
    failureDetail: null,
  });

  // Two uploads of the same file racing each other both reach here. The one that lost the insert
  // takes the ordinary already-seen path, which hands back the winner's job instead of a second.
  if (!committed.inserted) return resolveExisting(committed.document);

  return {
    outcome: "accepted",
    document: committed.document,
    jobId: await enqueue(committed.document.id),
  };
}

/** Insert, or return the row that won the race for this content hash. */
async function commitDocument(
  values: typeof documents.$inferInsert,
): Promise<{ document: Document; inserted: boolean }> {
  const [inserted] = await db
    .insert(documents)
    .values(values)
    .onConflictDoNothing({ target: documents.contentHash })
    .returning();

  if (inserted) return { document: inserted, inserted: true };

  const [existing] = await db
    .select()
    .from(documents)
    .where(eq(documents.contentHash, values.contentHash));

  if (!existing) throw new Error(`document ${values.contentHash} vanished mid-insert`);

  return { document: existing, inserted: false };
}

export type Coverage = {
  pageCount: number | null;
  pagesParsed: number;
  pagesFailed: number;
};

/** Per-page coverage, so a partially parsed document reports as partial rather than as done. */
export async function readCoverage(documentId: string): Promise<Coverage> {
  const [document] = await db
    .select({ pageCount: documents.pageCount })
    .from(documents)
    .where(eq(documents.id, documentId));

  const [parsed] = await db
    .select({ value: count() })
    .from(pages)
    .where(and(eq(pages.documentId, documentId), eq(pages.status, "parsed")));

  const [failed] = await db
    .select({ value: count() })
    .from(pages)
    .where(and(eq(pages.documentId, documentId), eq(pages.status, "failed")));

  return {
    pageCount: document?.pageCount ?? null,
    pagesParsed: parsed?.value ?? 0,
    pagesFailed: failed?.value ?? 0,
  };
}
