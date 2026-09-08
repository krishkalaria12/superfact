import { assertions, db, edges } from "@superfact/db";
import type { ClaimEdge } from "@superfact/db/contracts";
import type { PgColumn } from "@superfact/db/orm";
import { and, eq, getTableColumns, inArray, sql } from "@superfact/db/orm";
import { toEdgeRow, toPublishedAssertion } from "@superfact/db/projection";

import { adjudicatePairs, type AdjudicationResult } from "./adjudicate.ts";
import type { AdjudicationAssertion, AdjudicationModel, AdjudicationPair } from "./types.ts";

/**
 * The database half of the relate stage: read the two sides of each pair, judge them, write edges.
 */

/**
 * Pairs per batch.
 *
 * Each pair is one model call, or two when the first pass says `contradicts`. At the module's
 * concurrency this keeps a batch around half a minute, well inside a serverless request budget,
 * which is why the stage fans out at all rather than judging a document's pairs in one run.
 */
export const PAIRS_PER_BATCH = 40;

// A vector per assertion is 1536 floats and adjudication never looks at one.
const { embedding: _embedding, ...assertionColumns } = getTableColumns(assertions);

export type PairReference = { sourceAssertionId: string; targetAssertionId: string };

/** Slices a document's pairs into ranges, each judged by its own function run. */
export function planPairBatches(pairs: readonly PairReference[]): PairReference[][] {
  return Array.from({ length: Math.ceil(pairs.length / PAIRS_PER_BATCH) }, (_, index) =>
    pairs.slice(index * PAIRS_PER_BATCH, (index + 1) * PAIRS_PER_BATCH),
  );
}

/** Both sides of every pair in the batch, in the contract shape the prompt is built from. */
export async function readAdjudicationAssertions(
  ids: readonly string[],
): Promise<Map<string, AdjudicationAssertion>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select(assertionColumns)
    .from(assertions)
    .where(and(inArray(assertions.id, [...ids]), eq(assertions.status, "published")));

  return new Map(
    rows.map((row) => [row.id, toPublishedAssertion({ ...row, embedding: null })] as const),
  );
}

/** The value this statement tried to insert, for a column the conflict target rejected. */
function excluded(column: PgColumn) {
  return sql`excluded.${sql.identifier(column.name)}`;
}

/**
 * Writes judged edges.
 *
 * The upsert is what makes a batch retry safe. The relate stage clears this document's edges once,
 * before any batch runs, so a child that failed after writing half its edges would otherwise meet
 * its own rows on the way back through. Conflict target is the ordered pair, which is the identity
 * an edge actually has.
 */
export async function writeEdges(claimEdges: readonly ClaimEdge[]): Promise<number> {
  if (claimEdges.length === 0) return 0;

  const rows = claimEdges.map(toEdgeRow);
  await db
    .insert(edges)
    .values(rows)
    .onConflictDoUpdate({
      target: [edges.sourceAssertionId, edges.targetAssertionId],
      set: {
        verdict: excluded(edges.verdict),
        reasonCode: excluded(edges.reasonCode),
        matchedFields: excluded(edges.matchedFields),
        mismatchedFields: excluded(edges.mismatchedFields),
        explanation: excluded(edges.explanation),
        confidence: excluded(edges.confidence),
        priorVerdict: excluded(edges.priorVerdict),
        priorExplanation: excluded(edges.priorExplanation),
        pipelineVersion: excluded(edges.pipelineVersion),
      },
    });

  return rows.length;
}

/** Judges one batch of pairs and stores what it decided. */
export async function adjudicatePairBatch(
  pairs: readonly PairReference[],
  model: AdjudicationModel,
  pipelineVersion: string,
): Promise<AdjudicationResult & { written: number }> {
  const byId = await readAdjudicationAssertions([
    ...new Set(pairs.flatMap((pair) => [pair.sourceAssertionId, pair.targetAssertionId])),
  ]);

  const resolved: AdjudicationPair[] = [];
  const missing: AdjudicationResult["skipped"] = [];

  for (const pair of pairs) {
    const source = byId.get(pair.sourceAssertionId);
    const target = byId.get(pair.targetAssertionId);
    if (!source || !target) {
      // Re-extraction between pairing and adjudication can retire an assertion. That is a gap in
      // the relationships, so it is counted rather than passed over.
      missing.push({
        pairKey: `${pair.sourceAssertionId}:${pair.targetAssertionId}`,
        reason: "unknown_assertion",
        detail: `no published assertion ${source ? pair.targetAssertionId : pair.sourceAssertionId}`,
      });
      continue;
    }
    resolved.push({ source, target });
  }

  const result = await adjudicatePairs(resolved, model, pipelineVersion);
  const written = await writeEdges(result.edges);

  return {
    ...result,
    skipped: [...missing, ...result.skipped],
    stats: {
      ...result.stats,
      pairs: pairs.length,
      skipped: result.stats.skipped + missing.length,
    },
    written,
  };
}
