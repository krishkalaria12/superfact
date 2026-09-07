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
