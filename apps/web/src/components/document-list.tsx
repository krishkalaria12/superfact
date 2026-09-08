"use client";

import { Skeleton } from "@superfact/ui/components/skeleton";
import { cn } from "@superfact/ui/lib/utils";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Cite } from "@/components/vocabulary";
import { type DocumentRow, getJson } from "@/lib/api";

/**
 * Every document the system has seen, as a ledger rather than a wall of cards.
 *
 * A reader scanning this wants to compare counts down a column, so the counts are monospaced and
 * right-aligned and the rows are the same height. A document still being read shows what it is
 * doing in place of its counts, and the list keeps polling until nothing is moving.
 */
export function DocumentList({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const payload = await getJson<{ documents: DocumentRow[] }>("/api/documents", signal);
    setRows(payload.documents);
    setError(null);
    return payload.documents;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const documents = await load(controller.signal);
        if (documents.some((row) => row.status === "pending" || row.status === "parsing")) {
          timer = setTimeout(tick, 2500);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void tick();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [load, refreshKey]);

  if (error) {
    return (
      <p className="border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
        {error}
      </p>
    );
  }

  if (!rows) {
    return (
      <div className="border border-border">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            className="flex justify-between gap-4 border-border border-b p-3 last:border-b-0"
            key={index}
          >
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border border-border border-dashed p-8 text-center">
        <p className="text-muted-foreground">
          Nothing here yet. Drop a PDF above and the facts will start arriving.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border">
      {rows.map((row) => {
        const working = row.status === "pending" || row.status === "parsing";
        return (
          <Link
            className="flex items-center justify-between gap-6 border-border border-b px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/60"
            href={`/documents/${row.id}`}
            key={row.id}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-sm">{row.filename}</span>
              <Cite className="mt-0.5 block">
                {row.pageCount ?? "?"} pages
                {row.pipelineVersion ? `  ·  v${row.pipelineVersion}` : ""}
              </Cite>
            </span>

            {row.job ? (
              <span className="shrink-0 animate-working text-evidence text-sm">
                {row.job.stage} {row.job.status}
              </span>
            ) : working ? (
              <span className="shrink-0 animate-working text-evidence text-sm">queued</span>
            ) : row.status === "failed" ? (
              <span
                className="shrink-0 text-destructive text-sm"
                title={row.failureDetail ?? undefined}
              >
                {row.failureReason?.replaceAll("_", " ") ?? "failed"}
              </span>
            ) : (
              <span className="flex shrink-0 gap-6 text-right">
                <Count label="facts" value={row.facts.published} />
                <Count
                  label="refused"
                  tone={row.facts.rejected > 0 ? "text-muted-foreground" : undefined}
                  value={row.facts.rejected}
                />
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function Count({ label, tone, value }: { label: string; tone?: string; value: number }) {
  return (
    <span className="block">
      <span className={cn("block font-mono text-sm", tone)}>{value}</span>
      <span className="block text-muted-foreground text-xs">{label}</span>
    </span>
  );
}
