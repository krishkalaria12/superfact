"use client";

import type { Bbox, TableContext } from "@superfact/db/contracts";
import { useEffect, useState } from "react";

import { getJson, type PageResponse } from "@/lib/api";

/**
 * The page as it was printed, with the cited region drawn on it.
 *
 * The whole reason this renders a stored raster instead of the PDF is that the parser and this
 * viewer share one coordinate space. A box here is the box the parser emitted, multiplied by the
 * scale recorded on that page's row — no transform between two libraries' conventions, and no
 * assumption about what the scale was when the page was rendered.
 */

type Props = {
  documentId: string;
  pageNumber: number;
  bbox: Bbox | null;
  lineIds: readonly string[];
  tableContext: TableContext | null;
};

export function EvidenceViewer({ documentId, pageNumber, bbox, lineIds, tableContext }: Props) {
  const [page, setPage] = useState<PageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError(null);
    getJson<PageResponse>(`/api/documents/${documentId}/pages/${pageNumber}`, controller.signal)
      .then(setPage)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [documentId, pageNumber]);

  if (error) {
    return (
      <p className="p-4 text-destructive text-sm">
        Could not load page {pageNumber}: {error}
      </p>
    );
  }
  if (!page) {
    return <div className="h-96 animate-pulse rounded-none bg-muted" />;
  }

  const { rasterUrl, rasterScale, width, height } = page.page;
  const cited = new Set(lineIds);
  // Per-line boxes, not just their union: a quote spanning three lines of a paragraph reads as
  // three highlights, which is what a reader is looking for. The union is the fallback.
  const boxes = page.lines.filter((line) => cited.has(line.id)).map((line) => line.bbox);
  const drawn = boxes.length > 0 ? boxes : bbox ? [bbox] : [];

  if (!rasterUrl || !rasterScale || !width || !height) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-muted-foreground text-sm">
          Page {pageNumber} has no stored raster, so the evidence cannot be drawn. The quote and its
          line IDs are still exact.
        </p>
        <TableContextPanel context={tableContext} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden border border-border bg-background">
        {/* eslint-disable-next-line @next/next/no-img-element -- the raster is an external blob at
            an unknown intrinsic size; next/image would need a loader per storage host. */}
        <img
          alt={`Page ${pageNumber}`}
          className="block w-full"
          src={rasterUrl}
          style={{ aspectRatio: `${width} / ${height}` }}
        />
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${width * rasterScale} ${height * rasterScale}`}
        >
          {drawn.map((box, index) => (
            <rect
              className="fill-chart-2/20 stroke-chart-3"
              height={(box.y1 - box.y0) * rasterScale}
              key={index}
              strokeWidth={2}
              width={(box.x1 - box.x0) * rasterScale}
              x={box.x0 * rasterScale}
              y={box.y0 * rasterScale}
            />
          ))}
        </svg>
      </div>
      <p className="text-muted-foreground text-xs">
        Page {pageNumber} · {drawn.length} region{drawn.length === 1 ? "" : "s"} · rendered at{" "}
        {rasterScale}× the parser&rsquo;s coordinate space
      </p>
      <TableContextPanel context={tableContext} />
    </div>
  );
}

/**
 * The context a table cell needed before its number was allowed to become a fact.
 *
 * Shown next to the highlight because the highlight alone is misleading for a table: the box is
 * around a bare number, and the title, headers, and unit line are what make it mean anything.
 */
function TableContextPanel({ context }: { context: TableContext | null }) {
  if (!context) return null;

  const rows: [string, string | null][] = [
    ["Table", context.title],
    ["Column", context.columnHeader],
    ["Row", context.rowHeader],
    ["Unit", context.unitLine],
  ];

  return (
    <dl className="border border-border text-sm">
      {rows
        .filter(([, value]) => value?.trim())
        .map(([label, value]) => (
          <div
            className="flex gap-3 border-border border-b px-3 py-1.5 last:border-b-0"
            key={label}
          >
            <dt className="w-20 shrink-0 text-muted-foreground text-xs uppercase tracking-wide">
              {label}
            </dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      {context.footnotes.length > 0 && (
        <div className="flex gap-3 border-border border-t px-3 py-1.5">
          <dt className="w-20 shrink-0 text-muted-foreground text-xs uppercase tracking-wide">
            Footnotes
          </dt>
          <dd className="min-w-0 space-y-1">
            {context.footnotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}
