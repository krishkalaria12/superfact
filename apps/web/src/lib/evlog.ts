import type { JobStage } from "@superfact/db";
import { createFsDrain } from "evlog/fs";
import { createEvlog } from "evlog/next";

/**
 * Typed fields every Superfact event may carry.
 *
 * `job.id` and `job.stages` are the two the plan asks for at phase 00: they are what makes a run
 * traceable from a log line back to a row in `jobs`, and back to the stage that produced it.
 * `stages` is a list because Inngest checkpoints several steps into one HTTP request, and evlog
 * emits one wide event per request — a scalar would keep only the last stage of the batch.
 */
export type SuperfactFields = {
  job: {
    id: string;
    documentId: string;
    pipelineVersion: string;
    stages: JobStage[];
  };
  /** The document a request or run is about, and what intake decided to do with it. */
  document: {
    id: string;
    contentHash: string;
    byteSize: number;
    outcome: string;
  };
  /** Page coverage from the parse stage, so a partial document is legible from the log alone. */
  parse: {
    pageCount: number;
    parsed: number;
    failed: number;
  };
  /** Candidate coverage from the extraction stage. */
  extract: {
    pages: number;
    candidates: number;
    stored: number;
    published: number;
    rejected: number;
  };
  /**
   * Retrieval coverage from the pairing stage.
   *
   * `capped` and `dropped` are here because the phase's named risk is a pair that never reaches
   * the adjudicator. A run that keeps capping is starving phase 07, and the only way that is
   * visible without re-running the stage is if the counts travel with the event.
   */
  pairing: {
    focus: number;
    corpus: number;
    embedded: number;
    missingEmbeddings: number;
    deterministic: number;
    semantic: number;
    pairs: number;
    capped: number;
    dropped: number;
    truncated: boolean;
  };
  /**
   * What the relate stage decided, per batch of pairs.
   *
   * `withheld` and `downgraded` are the two worth watching. The first counts contradictions the
   * invariant refused because decisive context was not matched; the second counts those the
   * reversed-burden review defused. Both are the product working, and a run where neither ever
   * fires means the checks are not reaching anything.
   */
  adjudicate: {
    pairs: number;
    settled: number;
    judged: number;
    reviewed: number;
    downgraded: number;
    withheld: number;
    corroborates: number;
    contradicts: number;
    reconciles: number;
    insufficient: number;
    skipped: number;
    skips: string[];
  };
  /**
   * The result of a phase exit check. `differences` names the paths that failed, so a broken
   * check is diagnosable from the log alone without re-running it.
   */
  check: {
    name: string;
    ok: boolean;
    differences: string[];
  };
};

const evlog = createEvlog({
  service: "superfact",
  // NDJSON under .evlog/logs, so a reviewer can grep a run without an external platform —
  // which phase 00 freezes out. Disables itself on a read-only filesystem.
  drain: createFsDrain(),
});

export const { withEvlog, log, createError } = evlog;

/**
 * The request-scoped wide-event logger, typed to {@link SuperfactFields}.
 * Only valid inside a `withEvlog()` wrapper.
 */
export function useLogger() {
  return evlog.useLogger<SuperfactFields>();
}
