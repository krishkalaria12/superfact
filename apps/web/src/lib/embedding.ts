import { EMBEDDING_DIMENSIONS } from "@superfact/db/schema/assertions";
import { APICallError, embedMany } from "ai";

import {
  AI_PROVIDER,
  embeddingLanguageModel,
  embeddingProviderOptions,
  SELECTED_MODELS,
} from "@/lib/ai-provider";
import { PermanentModelFailure } from "@/lib/model-errors";

export const EMBEDDING_MODEL = SELECTED_MODELS.embedding;

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
  const claim = `${assertion.subject.trim()}: ${assertion.predicate.trim()}`;
  return AI_PROVIDER === "gemini" ? `task: sentence similarity | query: ${claim}` : claim;
}

/** The small surface pairing needs, kept behind an interface so tests never reach the network. */
export interface EmbeddingModel {
  embed(values: readonly string[]): Promise<number[][]>;
}

export const embeddingModel: EmbeddingModel = {
  async embed(values) {
    if (values.length === 0) return [];

    let embeddings: number[][];
    try {
      ({ embeddings } = await embedMany({
        model: embeddingLanguageModel(),
        values: [...values],
        maxParallelCalls: 4,
        maxRetries: 0,
        providerOptions: embeddingProviderOptions(EMBEDDING_DIMENSIONS),
      }));
    } catch (error) {
      if (APICallError.isInstance(error) && !error.isRetryable) {
        throw new PermanentModelFailure(error.message, { cause: error });
      }
      throw error;
    }

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
