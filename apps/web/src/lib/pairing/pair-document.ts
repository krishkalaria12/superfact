import type { EmbeddingModel } from "@/lib/embedding";
import { buildCandidatePairs } from "./pair.ts";
import {
  readAssertionsById,
  readAssertionsMissingEmbedding,
  readFocusAssertions,
  retrieveDeterministic,
  retrieveSemantic,
  writeAssertionEmbeddings,
} from "./retrieval.ts";
import type { PairingOptions, PairingResult } from "./types.ts";

export type PairingRun = PairingResult & {
  documentId: string;
  pipelineVersion: string;
  /** Vectors written across the corpus on this run. Zero on a re-run: the backfill is idempotent. */
  embedded: number;
  /** Published assertions still without a vector, and so invisible to the semantic path. */
  missingEmbeddings: number;
  /** Compatibility flag retained for API consumers. Deterministic retrieval is no longer capped. */
  truncated: boolean;
};

/**
 * Every pair worth judging between one document and everything else already stored.
 *
 * The focus side is always this document, which is what keeps the work off an O(n^2) sweep of the
 * corpus: a run considers one document against the rest, not every document against every other.
 * Uploads therefore cover each cross-document pair once, from whichever document arrived second.
 *
 * Pass a model to fill in missing vectors; pass null to read without writing, which is what the
 * inspection endpoint does.
 */
export async function pairDocument(input: {
  documentId: string;
  pipelineVersion: string;
  model: EmbeddingModel | null;
  options?: PairingOptions;
}): Promise<PairingRun> {
  const { documentId, pipelineVersion } = input;

  const pending = await readAssertionsMissingEmbedding(pipelineVersion);
  const embedded = input.model ? await writeAssertionEmbeddings(pending, input.model) : 0;

  const focus = await readFocusAssertions(documentId, pipelineVersion);
  if (focus.length === 0) {
    return {
      pairs: [],
      excluded: [],
      stats: {
        focus: 0,
        corpus: 0,
        retrieved: 0,
        deterministic: 0,
        semantic: 0,
        pairs: 0,
        capped: 0,
        dropped: 0,
      },
      documentId,
      pipelineVersion,
      embedded,
      missingEmbeddings: pending.length - embedded,
      truncated: false,
    };
  }

  const [deterministic, semantic] = await Promise.all([
    retrieveDeterministic(documentId, pipelineVersion),
    retrieveSemantic(documentId, pipelineVersion),
  ]);

  const retrieved = [...deterministic.pairs, ...semantic];
  const corpus = await readAssertionsById([
    ...new Set(retrieved.map((pair) => pair.targetAssertionId)),
  ]);

  const result = buildCandidatePairs({ focus, corpus, retrieved, options: input.options });

  return {
    ...result,
    documentId,
    pipelineVersion,
    embedded,
    missingEmbeddings: pending.length - embedded,
    truncated: deterministic.truncated,
  };
}
