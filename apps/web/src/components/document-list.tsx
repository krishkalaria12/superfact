"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { type DocumentRow, getJson } from "@/lib/api";

/** Every document the system has seen, with how far each got. Polls while anything is still running. */
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
        // Keep polling only while something has not settled into ready or failed.
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

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!rows) return <div className="h-24 animate-pulse bg-muted" />;
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No documents yet.</p>;
  }

  return (
    <ul className="border border-border">
      {rows.map((row) => (
        <li className="border-border border-b last:border-b-0" key={row.id}>
          <Link
            className="flex items-baseline justify-between gap-4 px-3 py-2 hover:bg-muted"
            href={`/documents/${row.id}`}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-sm">{row.filename}</span>
              <span className="block text-muted-foreground text-xs">
                {row.pageCount ?? "?"} pages · {row.facts.published} facts
                {row.facts.rejected > 0 && ` · ${row.facts.rejected} refused`}
                {row.pipelineVersion && ` · v${row.pipelineVersion}`}
              </span>
            </span>
            <span
              className={`shrink-0 text-xs ${
                row.status === "failed" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {row.status === "failed" && row.failureReason
                ? row.failureReason.replaceAll("_", " ")
                : row.job
                  ? `${row.job.stage} ${row.job.status}`
                  : row.status}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
