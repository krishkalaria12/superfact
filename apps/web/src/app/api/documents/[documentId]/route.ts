import { db, documents } from "@superfact/db";
import { eq } from "@superfact/db/orm";

import { readCoverage } from "@/lib/documents";
import { createError, withEvlog } from "@/lib/evlog";

/** Read-only: what the system knows about one document, including how much of it parsed. */
export const GET = withEvlog(
  async (_request: Request, context: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await context.params;

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));

    if (!document) {
      throw createError({ status: 404, message: `No document ${documentId}` });
    }

    return Response.json({
      document: {
        id: document.id,
        filename: document.filename,
        contentHash: document.contentHash,
        byteSize: document.byteSize,
        pageCount: document.pageCount,
        status: document.status,
        failureReason: document.failureReason,
        failureDetail: document.failureDetail,
        pipelineVersion: document.pipelineVersion,
        createdAt: document.createdAt,
      },
      coverage: await readCoverage(document.id),
    });
  },
);
