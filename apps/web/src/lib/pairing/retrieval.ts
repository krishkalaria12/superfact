import { assertions, db } from "@superfact/db";
import { alias, and, eq, inArray, isNull, sql } from "@superfact/db/orm";

import type { EmbeddingModel } from "@/lib/embedding";
import { assertionEmbeddingText } from "@/lib/embedding";
import { DEFAULT_TOP_K } from "./pair.ts";
import type { PairingAssertion, RetrievedPair } from "./types.ts";

/**
 * The two retrieval paths, and the embedding backfill that feeds the second one.
 *
 * Both paths run as one statement each. Per-assertion queries would be hundreds of round trips
 * against an HTTP database driver, and the lateral join lets Postgres do the top-k work it is
 * already good at.
 */

/** Rows per embedding write. One statement per chunk rather than one per assertion. */
const EMBED_UPDATE_CHUNK = 100;

const focus = alias(assertions, "focus");
const corpus = alias(assertions, "corpus");

const pairingColumns = {
  id: assertions.id,
  documentId: assertions.documentId,
  subject: assertions.subject,
  predicate: assertions.predicate,
  valueType: assertions.valueType,
  unit: assertions.unit,
  canonicalValue: assertions.canonicalValue,
  canonicalNumber: assertions.canonicalNumber,
};

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

/** The published assertions of one document: the side of every pair this run is responsible for. */
export function readFocusAssertions(
  documentId: string,
  pipelineVersion: string,
): Promise<PairingAssertion[]> {
  return db
    .select(pairingColumns)
    .from(assertions)
    .where(
      and(
        eq(assertions.documentId, documentId),
        eq(assertions.status, "published"),
        eq(assertions.pipelineVersion, pipelineVersion),
      ),
    );
}

/** The far side of the pairs the two paths proposed, fetched once for the whole prefilter. */
export async function readAssertionsById(ids: readonly string[]): Promise<PairingAssertion[]> {
  if (ids.length === 0) return [];
  return db
    .select(pairingColumns)
    .from(assertions)
    .where(inArray(assertions.id, [...ids]));
}

/**
 * Every published assertion at this pipeline version that has no vector yet, across all documents.
 *
 * Embedding lives in the pairing stage rather than at extraction because it is a retrieval index,
 * not part of what an assertion says: it is a pure function of `subject` and `predicate`, both
 * immutable, so writing it changes nothing about the claim.
 *
 * The backfill covers the whole corpus and not just the focus document on purpose. A neighbour
 * without a vector is invisible to the semantic path, so a document stored before that path existed
 * would be silently unpairable until something re-ran it. Whichever run notices first pays for it;
 * the work is idempotent, and the cost of embedding a corpus twice is far below the cost of a
 * missed pair.
 */
export function readAssertionsMissingEmbedding(
  pipelineVersion: string,
): Promise<{ id: string; subject: string; predicate: string }[]> {
  return db
    .select({
      id: assertions.id,
      subject: assertions.subject,
      predicate: assertions.predicate,
    })
    .from(assertions)
    .where(
      and(
        eq(assertions.status, "published"),
        eq(assertions.pipelineVersion, pipelineVersion),
        isNull(assertions.embedding),
      ),
    );
}

/** Embeds the given assertions and writes the vectors back, in chunks of one statement each. */
export async function writeAssertionEmbeddings(
  pending: readonly { id: string; subject: string; predicate: string }[],
  model: EmbeddingModel,
): Promise<number> {
  if (pending.length === 0) return 0;

  const embeddings = await model.embed(pending.map(assertionEmbeddingText));
  if (embeddings.length !== pending.length) {
    throw new Error(`embedded ${embeddings.length} of ${pending.length} assertions`);
  }

  for (let offset = 0; offset < pending.length; offset += EMBED_UPDATE_CHUNK) {
    const chunk = pending.slice(offset, offset + EMBED_UPDATE_CHUNK);
    const rows = sql.join(
      chunk.map(
        (row, index) =>
          sql`(${row.id}::uuid, ${toVectorLiteral(embeddings[offset + index]!)}::vector)`,
      ),
      sql`, `,
    );

    // An UPDATE ... FROM (VALUES ...) writes the chunk in one statement. The SET target cannot be
    // qualified, which is the one place here a column name is written by hand rather than derived.
    await db.execute(sql`
      update ${assertions} as target
      set embedding = source.embedding
      from (values ${rows}) as source(id, embedding)
      where target.id = source.id
    `);
  }

  return pending.length;
}

/**
 * The deterministic path: same canonical value, different document.
 *
 * Value equality is the whole selectivity here, and it is exact because phase 05 already did the
 * conversion. Predicate relatedness is settled in the prefilter rather than in SQL, so the rule
 * that decides what a match means stays somewhere it can be read and tested.
 */
export async function retrieveDeterministic(
  documentId: string,
  pipelineVersion: string,
): Promise<{ pairs: RetrievedPair[]; truncated: boolean }> {
  const result = await db.execute<{ source_id: string; target_id: string }>(sql`
    select ${focus.id} as source_id, ${corpus.id} as target_id
    from ${assertions} "focus"
    join ${assertions} "corpus"
      on ${corpus.documentId} <> ${focus.documentId}
     and ${corpus.status} = 'published'
     and ${corpus.pipelineVersion} = ${pipelineVersion}
     and (
       (
         ${focus.canonicalNumber} is not null
         and ${corpus.canonicalNumber} is not null
         and abs(${corpus.canonicalNumber} - ${focus.canonicalNumber})
             <= 1e-9 * greatest(abs(${focus.canonicalNumber}), abs(${corpus.canonicalNumber}), 1)
       )
       or (
         ${focus.canonicalNumber} is null
         and ${corpus.canonicalNumber} is null
         and ${focus.canonicalValue} is not null
         and ${corpus.canonicalValue} = ${focus.canonicalValue}
       )
     )
    where ${focus.documentId} = ${documentId}
      and ${focus.status} = 'published'
      and ${focus.pipelineVersion} = ${pipelineVersion}
    order by ${focus.id}, ${corpus.id}
  `);

  return {
    pairs: result.rows.map((row) => ({
      sourceAssertionId: row.source_id,
      targetAssertionId: row.target_id,
      path: "deterministic" as const,
      similarity: null,
    })),
    truncated: false,
  };
}

/**
 * The semantic path: top-k nearest neighbours by cosine distance over subject and predicate text.
 *
 * Exact search, no HNSW index. At six documents the sequential scan is not what makes this slow,
 * and an index built before anything is measurably slow is an index tuned against a guess.
 */
export async function retrieveSemantic(
  documentId: string,
  pipelineVersion: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedPair[]> {
  const result = await db.execute<{ source_id: string; target_id: string; distance: number }>(sql`
    select ${focus.id} as source_id, neighbour.id as target_id, neighbour.distance as distance
    from ${assertions} "focus"
    cross join lateral (
      select ${corpus.id} as id, ${focus.embedding} <=> ${corpus.embedding} as distance
      from ${assertions} "corpus"
      where ${corpus.documentId} <> ${focus.documentId}
        and ${corpus.status} = 'published'
        and ${corpus.pipelineVersion} = ${pipelineVersion}
        and ${corpus.embedding} is not null
      order by ${focus.embedding} <=> ${corpus.embedding}
      limit ${topK}
    ) neighbour
    where ${focus.documentId} = ${documentId}
      and ${focus.status} = 'published'
      and ${focus.pipelineVersion} = ${pipelineVersion}
      and ${focus.embedding} is not null
  `);

  return result.rows.map((row) => ({
    sourceAssertionId: row.source_id,
    targetAssertionId: row.target_id,
    path: "semantic" as const,
    // pgvector answers in cosine distance; the prefilter and the score both read similarity.
    similarity: 1 - Number(row.distance),
  }));
}
