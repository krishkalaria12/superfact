import { db, pages } from "@superfact/db";
import { and, eq } from "@superfact/db/orm";

import { createError, withEvlog } from "@/lib/evlog";

/**
 * Read-only: one page's raster and the geometry drawn over it.
 *
 * `rasterScale` travels with the image because the viewer's whole correctness rests on it. A stored
 * bbox times this number is the box on screen, and the number is recorded per page rather than
 * assumed, so a page rendered before the constant changed still highlights in the right place.
 *
 * `lines` come along because an evidence highlight is per line: the assertion's own bbox is their
 * union, and showing the individual boxes is what makes a multi-line quote legible.
 */
export const GET = withEvlog(
  async (
    _request: Request,
    context: { params: Promise<{ documentId: string; pageNumber: string }> },
  ) => {
    const { documentId, pageNumber } = await context.params;
    const number = Number(pageNumber);

    if (!Number.isInteger(number) || number < 1) {
      throw createError({ status: 400, message: `Page ${pageNumber} is not a page number` });
    }

    const [page] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.documentId, documentId), eq(pages.pageNumber, number)));

    if (!page) {
      throw createError({ status: 404, message: `No page ${number} in document ${documentId}` });
    }

    return Response.json({
      page: {
        documentId: page.documentId,
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        rasterUrl: page.rasterUrl,
        rasterScale: page.rasterScale,
        status: page.status,
        failureReason: page.failureReason,
        failureDetail: page.failureDetail,
        quality: page.quality,
      },
      lines: page.lines,
      tables: page.tables,
    });
  },
);
