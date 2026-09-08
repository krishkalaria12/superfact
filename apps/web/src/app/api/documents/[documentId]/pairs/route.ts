import { assertions, db, documents } from "@superfact/db";
import { eq, getTableColumns, inArray } from "@superfact/db/orm";
import { toStoredAssertion } from "@superfact/db/projection";

import { createError, withEvlog } from "@/lib/evlog";
import { pairDocument } from "@/lib/pairing";
import { PIPELINE_VERSION } from "@/lib/pipeline";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// The vector is a retrieval index, not something a reviewer reads. Fetching it would put 1536
// floats per assertion on the wire for no one.
const { embedding: _embedding, ...assertionColumns } = getTableColumns(assertions);

/**
 * Read-only: the pairs this document would send to the adjudicator, with both sides in full.
 *
 * Pairing is recomputed here rather than read back, because phase 06 stores nothing — the pairs
 * are an intermediate that phase 07 turns into edges. Recomputing is two queries and no model
 * call, and it means what a reviewer inspects is what the stage would produce right now rather
 * than what it produced whenever the document last ran.
 */
export const GET = withEvlog(
  async (request: Request, context: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await context.params;
    const requested = Number(new URL(request.url).searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!document) {
      throw createError({ status: 404, message: `No document ${documentId}` });
    }

    const run = await pairDocument({
      documentId,
      // A document that has not finished a run has no version of its own to pair at.
      pipelineVersion: document.pipelineVersion ?? PIPELINE_VERSION,
      model: null,
    });

    const shown = run.pairs.slice(0, limit);
    const ids = [
      ...new Set(shown.flatMap((pair) => [pair.sourceAssertionId, pair.targetAssertionId])),
    ];
    const rows =
      ids.length === 0
        ? []
        : await db.select(assertionColumns).from(assertions).where(inArray(assertions.id, ids));
    const byId = new Map(
      rows.map((row) => [row.id, toStoredAssertion({ ...row, embedding: null })]),
    );

    return Response.json({
      document: {
        id: document.id,
        filename: document.filename,
        pipelineVersion: run.pipelineVersion,
      },
      stats: run.stats,
      embeddings: { written: run.embedded, missing: run.missingEmbeddings },
      // The deterministic join stopped at its row ceiling, so the pair list is a prefix.
      truncated: run.truncated,
      pairs: shown.map((pair) => ({
        key: pair.key,
        paths: pair.paths,
        score: pair.score,
        similarity: pair.similarity,
        valuesEqual: pair.valuesEqual,
        unitsComparable: pair.unitsComparable,
        predicateRelation: pair.predicateRelation,
        source: byId.get(pair.sourceAssertionId) ?? null,
        target: byId.get(pair.targetAssertionId) ?? null,
      })),
      excluded: run.excluded.slice(0, limit),
      excludedTotal: run.excluded.length,
    });
  },
);
