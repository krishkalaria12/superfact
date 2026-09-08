import { assertions, db, documents, edges } from "@superfact/db";
import type { EdgeVerdict } from "@superfact/db";
import { edgeVerdict } from "@superfact/db";
import { eq, getTableColumns, inArray, or, sql } from "@superfact/db/orm";
import { toClaimEdge, toPublishedAssertion } from "@superfact/db/projection";

import { createError, withEvlog } from "@/lib/evlog";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const { embedding: _embedding, ...assertionColumns } = getTableColumns(assertions);

/**
 * Read-only: what the system decided about this document's relationships, with both claims attached.
 *
 * This is the phase 07 exit check. A reviewer reads an edge next to the two quotes it rests on and
 * the fields that matched and did not, which is what makes "a genuine contradiction" and "a
 * difference of time, vintage, unit, scope, or projection" tell themselves apart on the page.
 *
 * `?verdict=contradicts` narrows to the four cases the demo turns on. Edges arrive with
 * contradictions first, because a reviewer's first question is what the system thinks conflicts.
 */
export const GET = withEvlog(
  async (request: Request, context: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await context.params;
    const params = new URL(request.url).searchParams;

    const requested = Number(params.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const wanted = params.get("verdict");
    if (wanted && !(edgeVerdict.enumValues as string[]).includes(wanted)) {
      throw createError({
        status: 400,
        message: `Unknown verdict ${wanted}; expected one of ${edgeVerdict.enumValues.join(", ")}`,
      });
    }

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!document) {
      throw createError({ status: 404, message: `No document ${documentId}` });
    }

    const documentAssertions = db
      .select({ id: assertions.id })
      .from(assertions)
      .where(eq(assertions.documentId, documentId));

    const rows = await db
      .select()
      .from(edges)
      .where(
        or(
          inArray(edges.sourceAssertionId, documentAssertions),
          inArray(edges.targetAssertionId, documentAssertions),
        ),
      )
      // Nulls last: Postgres sorts them first on a descending order, which would float every
      // unscored edge above the ones the adjudicator was most sure of.
      .orderBy(sql`${edges.confidence} desc nulls last`);

    const claimEdges = rows
      .map(toClaimEdge)
      .filter((edge) => !wanted || edge.verdict === wanted)
      .sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict));

    const shown = claimEdges.slice(0, limit);
    const ids = [
      ...new Set(shown.flatMap((edge) => [edge.sourceAssertionId, edge.targetAssertionId])),
    ];
    const sides =
      ids.length === 0
        ? []
        : await db.select(assertionColumns).from(assertions).where(inArray(assertions.id, ids));
    const byId = new Map(
      sides.map((row) => [row.id, toPublishedAssertion({ ...row, embedding: null })]),
    );

    return Response.json({
      document: { id: document.id, filename: document.filename },
      counts: countByVerdict(claimEdges),
      total: claimEdges.length,
      edges: shown.map((edge) => ({
        ...edge,
        source: byId.get(edge.sourceAssertionId) ?? null,
        target: byId.get(edge.targetAssertionId) ?? null,
      })),
    });
  },
);

/** Contradictions first, then the reconciliations that explain a difference, then the rest. */
function verdictRank(verdict: EdgeVerdict): number {
  return ["contradicts", "reconciles", "corroborates", "insufficient"].indexOf(verdict);
}

function countByVerdict(claimEdges: readonly { verdict: EdgeVerdict }[]) {
  return Object.fromEntries(
    edgeVerdict.enumValues.map((verdict) => [
      verdict,
      claimEdges.filter((edge) => edge.verdict === verdict).length,
    ]),
  ) as Record<EdgeVerdict, number>;
}
