import { db, documents } from "@superfact/db";
import { desc } from "@superfact/db/orm";

import { intake, MAX_UPLOAD_BYTES } from "@/lib/documents";
import { createError, useLogger, withEvlog } from "@/lib/evlog";
import { readDocumentTotals } from "@/lib/export";

/**
 * The only way a document enters the system.
 *
 * The response says which of four things happened — the file was accepted, its work was already
 * done and is being reused, it needs reprocessing at a newer pipeline version, or it was refused.
 * A refusal is a 200 with a reason, not a 500: refusing a scan is the system working.
 */

// mupdf is a WebAssembly module and UploadThing wants Node streams; neither runs on the edge.
export const runtime = "nodejs";

export const POST = withEvlog(async (request: Request) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    throw createError({
      status: 400,
      message: "No file in the request",
      why: "The upload endpoint reads a multipart form with a `file` field",
      fix: 'Send multipart/form-data with the PDF under the field name "file"',
    });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw createError({
      status: 413,
      message: `File is larger than the ${MAX_UPLOAD_BYTES} byte limit`,
      why: "Intake holds the whole file in memory to hash and validate it",
      fix: "Split the document, or raise MAX_UPLOAD_BYTES if the runtime can carry it",
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await intake({ bytes, filename: file.name });
  const { document, jobId } = result;

  const log = useLogger();
  log.set({
    document: {
      id: document.id,
      contentHash: document.contentHash,
      byteSize: document.byteSize,
      outcome: result.outcome,
    },
  });
  if (jobId) log.set({ job: { id: jobId, documentId: document.id } });
  log.info(`upload ${result.outcome}`);

  return Response.json({
    outcome: result.outcome,
    jobId,
    document: {
      id: document.id,
      filename: document.filename,
      contentHash: document.contentHash,
      byteSize: document.byteSize,
      pageCount: document.pageCount,
      status: document.status,
      failureReason: document.failureReason,
      failureDetail: document.failureDetail,
    },
  });
});

/** Read-only: every document the system has seen, newest first, with its fact counts. */
export const GET = withEvlog(async () => {
  const rows = await db.select().from(documents).orderBy(desc(documents.createdAt));
  const totals = await readDocumentTotals(rows.map((row) => row.id));

  return Response.json({
    documents: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      contentHash: row.contentHash,
      byteSize: row.byteSize,
      pageCount: row.pageCount,
      status: row.status,
      failureReason: row.failureReason,
      failureDetail: row.failureDetail,
      pipelineVersion: row.pipelineVersion,
      createdAt: row.createdAt,
      facts: totals.get(row.id) ?? { published: 0, rejected: 0 },
    })),
  });
});
