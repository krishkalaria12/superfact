import { assertions, db, documents, edges, pages } from "@superfact/db";
import type { RunExport } from "@superfact/db/contracts";
import { eq, getTableColumns, inArray, or } from "@superfact/db/orm";
import {
  buildRunExport,
  toClaimEdge,
  toDocumentSummary,
  toPublishedAssertion,
  toRejectedAssertion,
} from "@superfact/db/projection";

import { PIPELINE_VERSION } from "@/lib/pipeline";

/**
 * The JSON a reviewer downloads.
 *
 * Everything here is projected through `@superfact/db/projection`, which is the only place a row
 * and a contract shape meet. That is what makes the export trustworthy as a record: a column that
 * stopped being written shows up as a missing field in the round-trip check rather than as a quiet
 * hole in a file someone is reading months later.
 *
 * An empty `failures` block on a real run is a symptom, not a success.
 */

const { embedding: _embedding, ...assertionColumns } = getTableColumns(assertions);

export async function buildExport(documentId?: string): Promise<RunExport> {
  const documentRows = documentId
    ? await db.select().from(documents).where(eq(documents.id, documentId))
    : await db.select().from(documents).orderBy(documents.createdAt);

  const ids = documentRows.map((row) => row.id);
  if (ids.length === 0) {
    return buildRunExport({
      pipelineVersion: PIPELINE_VERSION,
      documents: [],
      facts: [],
      edges: [],
      failures: { documents: [], pages: [], assertions: [] },
    });
  }

  const pageRows = await db
    .select({
      id: pages.id,
      documentId: pages.documentId,
      pageNumber: pages.pageNumber,
      status: pages.status,
      failureReason: pages.failureReason,
      failureDetail: pages.failureDetail,
    })
    .from(pages)
    .where(inArray(pages.documentId, ids));

  const assertionRows = await db
    .select(assertionColumns)
    .from(assertions)
    .where(inArray(assertions.documentId, ids));

  const assertionIds = assertionRows.map((row) => row.id);
  const edgeRows =
    assertionIds.length === 0
      ? []
      : await db
          .select()
          .from(edges)
          .where(
            or(
              inArray(edges.sourceAssertionId, assertionIds),
              inArray(edges.targetAssertionId, assertionIds),
            ),
          );

  const published = assertionRows.filter((row) => row.status === "published");
  const rejected = assertionRows.filter((row) => row.status === "rejected");

  return buildRunExport({
    pipelineVersion: PIPELINE_VERSION,
    documents: documentRows.map((row) =>
      toDocumentSummary(row, {
        pagesParsed: pageRows.filter((p) => p.documentId === row.id && p.status === "parsed")
          .length,
        pagesFailed: pageRows.filter((p) => p.documentId === row.id && p.status === "failed")
          .length,
      }),
    ),
    facts: published.map((row) => toPublishedAssertion({ ...row, embedding: null })),
    edges: edgeRows.map(toClaimEdge),
    failures: {
      documents: documentRows
        .filter((row) => row.status === "failed" && row.failureReason)
        .map((row) => ({
          documentId: row.id,
          filename: row.filename,
          reason: row.failureReason!,
          detail: row.failureDetail,
        })),
      pages: pageRows
        .filter((row) => row.status === "failed" && row.failureReason)
        .map((row) => ({
          documentId: row.documentId,
          page: row.pageNumber,
          reason: row.failureReason!,
          detail: row.failureDetail,
        })),
      assertions: rejected.map((row) => toRejectedAssertion({ ...row, embedding: null })),
    },
  });
}

/** Counts for the workspace, so a document list does not have to fetch every fact to show a number. */
export async function readDocumentTotals(documentIds: readonly string[]) {
  if (documentIds.length === 0) return new Map<string, { published: number; rejected: number }>();

  const rows = await db
    .select({ documentId: assertions.documentId, status: assertions.status, id: assertions.id })
    .from(assertions)
    .where(inArray(assertions.documentId, [...documentIds]));

  const totals = new Map<string, { published: number; rejected: number }>();
  for (const id of documentIds) totals.set(id, { published: 0, rejected: 0 });
  for (const row of rows) {
    const entry = totals.get(row.documentId);
    if (!entry) continue;
    if (row.status === "published") entry.published += 1;
    else entry.rejected += 1;
  }
  return totals;
}
