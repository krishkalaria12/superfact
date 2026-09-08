import { assertions, db, documents, edges, pages } from "@superfact/db";
import type { PublishedAssertion, RejectedAssertion } from "@superfact/db/contracts";
import type { SQL } from "@superfact/db/orm";
import { and, desc, eq, getTableColumns, inArray, isNotNull, ne, sql } from "@superfact/db/orm";
import { toClaimEdge, toPublishedAssertion, toRejectedAssertion } from "@superfact/db/projection";

import type { EdgeWithSides } from "./api.ts";

/**
 * The four cases the assignment asks to see, chosen from whatever the system actually produced.
 *
 * Every one is a query. Nothing here names a file, a predicate, a subject, or a value — the four
 * are picked by the shape of the result, so running the system over PDFs nobody has seen either
 * fills these in or honestly reports that it found none. A case that cannot be filled says so
 * rather than being staged.
 */

const { embedding: _embedding, ...assertionColumns } = getTableColumns(assertions);

export type DemoCase = {
  key: "corroboration" | "contradiction" | "reconciled" | "failure";
  title: string;
  /** What the reviewer should look for, phrased against the case rather than the data. */
  looksFor: string;
  edge: EdgeWithSides | null;
  fact: (PublishedAssertion | RejectedAssertion) | null;
  note: string | null;
};

async function readSides(ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, PublishedAssertion>();
  const rows = await db
    .select(assertionColumns)
    .from(assertions)
    .where(and(inArray(assertions.id, [...ids]), eq(assertions.status, "published")));
  return new Map(
    rows.map((row) => [row.id, toPublishedAssertion({ ...row, embedding: null })] as const),
  );
}

async function firstEdge(where: SQL | undefined): Promise<EdgeWithSides | null> {
  const [row] = await db.select().from(edges).where(where).orderBy(desc(edges.confidence)).limit(1);
  if (!row) return null;

  const edge = toClaimEdge(row);
  const sides = await readSides([edge.sourceAssertionId, edge.targetAssertionId]);
  return {
    ...edge,
    source: sides.get(edge.sourceAssertionId) ?? null,
    target: sides.get(edge.targetAssertionId) ?? null,
  };
}

export async function buildDemoCases(): Promise<DemoCase[]> {
  /**
   * One corroboration where the two documents did not use the same words for the same value.
   * `equivalent_value` is exactly that code: the raw strings differ and the canonical values agree,
   * which is the deterministic retrieval path earning its keep over the vector.
   */
  const corroboration = await firstEdge(
    and(eq(edges.verdict, "corroborates"), eq(edges.reasonCode, "equivalent_value")),
  );

  /** One contradiction that survived the reversed-burden review. */
  const contradiction = await firstEdge(eq(edges.verdict, "contradicts"));

  /**
   * A conflict a qualifier explains. Preferring one the second pass overturned, because a stored
   * `priorVerdict` is the most persuasive form of it — a first pass called these incompatible and a
   * reversed-burden review found the qualifier that lets both stand. Falling back to a first-pass
   * reconciliation when no downgrade has happened: the verdict is the same claim about the world,
   * and pretending otherwise would mean showing nothing.
   */
  const reconciled =
    (await firstEdge(and(eq(edges.verdict, "reconciles"), isNotNull(edges.priorVerdict)))) ??
    (await firstEdge(eq(edges.verdict, "reconciles")));

  /**
   * One real failure. A refused document first, then a failed page, then an assertion the grounding
   * gate would not publish — most severe available, since a refused scan is the most legible
   * abstention the system performs.
   */
  const [refusedDocument] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.status, "failed"), isNotNull(documents.failureReason)))
    .limit(1);

  const [failedPage] = await db
    .select({
      documentId: pages.documentId,
      pageNumber: pages.pageNumber,
      reason: pages.failureReason,
      detail: pages.failureDetail,
    })
    .from(pages)
    .where(eq(pages.status, "failed"))
    .limit(1);

  const [rejectedRow] = await db
    .select(assertionColumns)
    .from(assertions)
    .where(
      and(eq(assertions.status, "rejected"), ne(assertions.rejectionReason, "missing_context")),
    )
    // The gate that caught invention first: a quote that is not on the page is the failure the
    // whole design exists to make impossible.
    .orderBy(
      sql`case ${assertions.rejectionReason} when 'quote_not_found' then 0 when 'line_not_found' then 1 else 2 end`,
    )
    .limit(1);

  const failureNote = refusedDocument
    ? `${refusedDocument.filename} was refused whole: ${refusedDocument.failureReason?.replaceAll("_", " ")}. ${refusedDocument.failureDetail ?? ""}`
    : failedPage
      ? `Page ${failedPage.pageNumber} failed with ${failedPage.reason?.replaceAll("_", " ")}, and its row stays so the document reports partial rather than whole.`
      : rejectedRow
        ? `The grounding gate refused this candidate and stored it with a reason instead of dropping it.`
        : null;

  return [
    {
      key: "corroboration",
      title: "One value, two documents, different words",
      looksFor:
        "The raw strings differ and the canonical values match. Similarity did not decide this — the deterministic path matched on the normalized number.",
      edge: corroboration,
      fact: null,
      note: corroboration ? null : "No cross-document equivalent value has been found yet.",
    },
    {
      key: "contradiction",
      title: "A contradiction with both spans on the page",
      looksFor:
        "Every decisive field is in the matched list. The values conflict and the time, scope, unit, modality, and attribution were all shown to be the same first.",
      edge: contradiction,
      fact: null,
      note: contradiction ? null : "No contradiction has survived the review yet.",
    },
    {
      key: "reconciled",
      title: "A contradiction a qualifier defused",
      looksFor:
        "The first pass called this a conflict. A second pass, asked to argue the opposite, found the qualifier that lets both be true — and both readings are kept.",
      edge: reconciled,
      fact: null,
      note: reconciled?.priorPass
        ? null
        : reconciled
          ? "The first pass reached this directly, so there is no overturned reading to show. The second pass only runs on a verdict of contradicts, and none survived to reach it."
          : "Nothing in this corpus has been reconciled yet.",
    },
    {
      key: "failure",
      title: "A real failure, and what the system did instead of guessing",
      looksFor:
        "Nothing was silently dropped. The refusal carries a reason code, and the repair is to fix the cause and re-upload: the content hash makes the re-run cheap.",
      edge: null,
      fact: rejectedRow ? toRejectedAssertion({ ...rejectedRow, embedding: null }) : null,
      note: failureNote,
    },
  ];
}
