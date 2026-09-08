"use client";

import type { Progress } from "@/lib/api";

/**
 * Per-page coverage while a run is going.
 *
 * Parsed and failed are drawn separately rather than summed into one percentage, because a document
 * that is 80% done and one that is 80% done with 20% unreadable are different situations and the
 * plan refuses to let the second read as the first.
 */
export function ProgressRail({ progress }: { progress: Progress }) {
  const total = progress.pageCount ?? 0;
  const parsed = progress.pagesParsed;
  const failed = progress.pagesFailed;
  const pending = Math.max(0, total - parsed - failed);
  const running = progress.job !== null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className={running ? "text-foreground" : "text-muted-foreground"}>
          {running ? `${progress.job?.stage} · ${progress.job?.status}` : "idle"}
        </span>
        <span className="text-muted-foreground">
          {parsed} parsed{failed > 0 && ` · ${failed} failed`}
          {total > 0 && ` · ${total} pages`}
        </span>
      </div>
      <div className="flex h-1.5 w-full gap-px overflow-hidden bg-muted">
        {total > 0 && (
          <>
            <div className="bg-foreground" style={{ width: `${(parsed / total) * 100}%` }} />
            <div className="bg-destructive" style={{ width: `${(failed / total) * 100}%` }} />
            <div className="bg-transparent" style={{ width: `${(pending / total) * 100}%` }} />
          </>
        )}
      </div>
    </div>
  );
}
