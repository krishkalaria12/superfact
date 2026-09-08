import { openai } from "@ai-sdk/openai";
import { EMBEDDING_DIMENSIONS } from "@superfact/db/schema/assertions";
import { embedMany } from "ai";

export const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * What gets embedded: subject and predicate, nothing else.
 *
 * Values are deliberately left out. Numbers are the one thing vectors are worst at — ₹7,225 crore
 * and ₹72.25 billion land in unrelated places — so the deterministic path owns value matching and
 * the vector only has to find the same claim worded differently.
 */
export function assertionEmbeddingText(
  assertion: Readonly<{ subject: string; predicate: string }>,
): string {
  return `${assertion.subject.trim()}: ${assertion.predicate.trim()}`;
}

/** The small surface pairing needs, kept behind an interface so tests never reach the network. */
export interface EmbeddingModel {
  embed(values: readonly string[]): Promise<number[][]>;
}

export const embeddingModel: EmbeddingModel = {
  async embed(values) {
    if (values.length === 0) return [];

    const { embeddings } = await embedMany({
      model: openai.embeddingModel(EMBEDDING_MODEL),
      values: [...values],
      maxParallelCalls: 4,
    });

    // The column is fixed at 1536. A provider returning anything else would be rejected by
    // Postgres one insert later, with a far less obvious message than this one.
    const wrong = embeddings.find((embedding) => embedding.length !== EMBEDDING_DIMENSIONS);
    if (wrong) {
      throw new Error(
        `${EMBEDDING_MODEL} returned ${wrong.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }

    return embeddings;
  },
};
