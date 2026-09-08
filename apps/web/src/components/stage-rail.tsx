"use client";

import type { DocumentStatus, JobStage } from "@superfact/db";
import { cn } from "@superfact/ui/lib/utils";

import type { Progress } from "@/lib/api";

/**
 * What the run is doing, stage by stage.
 *
 * A document moves through three named stages and each one has a different thing worth counting:
 * parse counts pages, extract counts facts, relate counts judged pairs. A single percentage would
 * hide all of that, so each stage shows its own measure and the rail says which one is live.
 *
 * Parsed and failed pages are drawn as separate segments rather than summed. A document that is
 * eighty percent done and one that is eighty percent done with a fifth of it unreadable are
 * different situations, and the plan refuses to let the second read as the first.
 */

export type StageCounts = {
  facts: number;
  refused: number;
  links: number;
};

const ORDER: JobStage[] = ["parse", "extract", "relate"];

type State = "waiting" | "working" | "done" | "stopped";

const LABEL: Record<State, string> = {
  waiting: "queued",
  working: "running",
  done: "done",
  stopped: "never ran",
};

const DESCRIPTION: Record<JobStage, string> = {
  parse: "Reading pages, rebuilding tables, rendering images",
  extract: "Pulling out claims and checking each quote against its page",
  relate: "Comparing new facts against everything already stored",
};

/**
 * What a stage is doing, or did.
 *
 * With a job running the answer comes from the job. With no job it has to come from the output,
 * because a run that stopped partway still did real work: a document that failed during extraction
 * has read all its pages, and showing parse as "queued" contradicts the ninety-four pages counted
 * right beside it. So a stage that produced something reads done, and a stage that never got its
 * turn reads stopped rather than queued — nothing is coming for it.
 */
function stateOf(
  stage: JobStage,
  active: JobStage | null,
  status: DocumentStatus,
  produced: Record<JobStage, boolean>,
): State {
  if (active) {
    const here = ORDER.indexOf(stage);
    const now = ORDER.indexOf(active);
    if (here < now) return "done";
    if (here === now) return "working";
    return "waiting";
  }

  if (status === "ready") return "done";
  if (status === "failed") return produced[stage] ? "done" : "stopped";
  return produced[stage] ? "done" : "waiting";
}

/**
 * The rail before the first response lands.
 *
 * Rendered rather than skipped because the first moment of a running document is exactly when a
 * reader wants to know something is happening, and an absent rail says nothing at all.
 */
export function StageRailSkeleton() {
  return (
    <section aria-hidden className="border-border border-y bg-muted/30">
      <div className="mx-auto grid max-w-350 gap-px bg-border sm:grid-cols-3">
        {ORDER.map((stage) => (
          <div className="bg-background px-4 py-3 text-muted-foreground" key={stage}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-sm">{stage}</span>
              <span className="font-mono text-xs">checking</span>
            </div>
            <p className="mt-1 truncate text-xs">{DESCRIPTION[stage]}</p>
            <div className="mt-2 h-1 w-full animate-working bg-border" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function StageRail({
  progress,
  counts,
  documentStatus,
}: {
  progress: Progress;
  counts: StageCounts;
  documentStatus: DocumentStatus;
}) {
  const active = progress.job?.stage ?? null;
  const total = progress.pageCount ?? 0;
  const read = progress.pagesParsed + progress.pagesFailed;
  const produced: Record<JobStage, boolean> = {
    parse: read > 0,
    extract: counts.facts + counts.refused > 0,
    relate: counts.links > 0,
  };

  const measures: Record<JobStage, string> = {
    parse: total > 0 ? `${progress.pagesParsed} of ${total} pages` : "waiting for a page count",
    extract: `${counts.facts} published, ${counts.refused} refused`,
    relate: `${counts.links} relationships`,
  };

  return (
    <section aria-label="Run progress" className="border-border border-y bg-muted/30">
      <div className="mx-auto grid max-w-350 gap-px bg-border sm:grid-cols-3">
        {ORDER.map((stage) => {
          const state = stateOf(stage, active, documentStatus, produced);
          return (
            <div
              className={cn(
                "bg-background px-4 py-3",
                (state === "waiting" || state === "stopped") && "text-muted-foreground",
              )}
              key={stage}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "font-medium text-sm",
                    state === "working" && "text-evidence animate-working",
                  )}
                >
                  {stage}
                </span>
                <span
                  className={cn("font-mono text-xs", state === "stopped" && "text-destructive")}
                >
                  {LABEL[state]}
                </span>
              </div>

              <p className="mt-1 truncate text-xs">
                {state === "waiting" || state === "stopped" ? DESCRIPTION[stage] : measures[stage]}
              </p>

              {stage === "parse" && total > 0 ? (
                <div className="mt-2 flex h-1 w-full gap-px bg-border">
                  <div
                    className="bg-foreground transition-[width] duration-500"
                    style={{ width: `${(progress.pagesParsed / total) * 100}%` }}
                  />
                  <div
                    className="bg-destructive transition-[width] duration-500"
                    style={{ width: `${(progress.pagesFailed / total) * 100}%` }}
                  />
                  <div style={{ width: `${((total - read) / total) * 100}%` }} />
                </div>
              ) : (
                <div
                  className={cn(
                    "mt-2 h-1 w-full",
                    state === "done" ? "bg-foreground" : "bg-border",
                    state === "working" && "animate-working bg-evidence",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
