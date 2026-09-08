"use client";

import type { Bbox, TableContext } from "@superfact/db/contracts";
import { Button } from "@superfact/ui/components/button";
import { Skeleton } from "@superfact/ui/components/skeleton";
import { cn } from "@superfact/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";

import { getJson, type PageResponse } from "@/lib/api";
import { Cite } from "@/components/vocabulary";

/**
 * The page as it was printed, with the cited region marked on it.
 *
 * This is the one thing the product is really about, so it gets the space and the only saturated
 * colour on the screen. The mark is drawn as a rule and four corner ticks rather than a filled
 * block, because a reader needs to see the words underneath it — a highlighter hides the evidence
 * it is pointing at.
 *
 * That the mark lands in the right place is not a coincidence to be checked: the parser and this
 * viewer share one coordinate space, and the scale is read off the page's own row rather than
 * assumed, so a page rendered before the constant changed still marks correctly.
 */

type Props = {
  documentId: string;
  pageNumber: number;
  bbox: Bbox | null;
  lineIds: readonly string[];
  tableContext: TableContext | null;
};

/**
 * How much of the page a cropped view shows, at minimum, as a fraction of each axis.
 *
 * A cell holding "34.5%" is a sliver of a page, and cropping tight to it magnifies the number until
 * nothing around it is readable. A reader checking a table cell needs the neighbouring columns and
 * the row above, so the window never closes past a third of the page however small the mark is.
 */
const MIN_CROP = 0.34;

export function EvidenceViewer({ documentId, pageNumber, bbox, lineIds, tableContext }: Props) {
  const [page, setPage] = useState<PageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cropped, setCropped] = useState(true);

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

  const marks = useMemo(() => {
    if (!page) return [];
    const cited = new Set(lineIds);
    // Per line, not just their union. A quote running across three lines of a paragraph is three
    // marks, which is what a reader is looking for on the page.
    const perLine = page.lines.filter((line) => cited.has(line.id)).map((line) => line.bbox);
    return perLine.length > 0 ? perLine : bbox ? [bbox] : [];
  }, [page, lineIds, bbox]);

  if (error) {
    return (
      <p className="border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
        Page {pageNumber} would not load. {error}
      </p>
    );
  }

  if (!page) {
    return (
      <div className="space-y-2">
        <Skeleton className="aspect-[4/3] w-full" />
        <Skeleton className="h-3 w-48" />
      </div>
    );
  }

  const { rasterUrl, rasterScale, width, height } = page.page;

  if (!rasterUrl || !rasterScale || !width || !height) {
    return (
      <div className="space-y-3">
        <p className="border border-border border-dashed p-4 text-muted-foreground text-sm">
          Page {pageNumber} has no stored image, so the region cannot be drawn. The quote and the
          lines it cites are still exact.
        </p>
        <TableContextPanel context={tableContext} />
      </div>
    );
  }

  // The window on the page: the whole thing, or a box centred on the evidence that still shows
  // enough around it to read what the mark is pointing at.
  const hull = marks.length > 0 ? union(marks) : null;
  const view =
    cropped && hull ? cropWindow(hull, width, height) : { x: 0, y: 0, w: width, h: height };

  return (
    <figure className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Cite>
          page {pageNumber} · {marks.length} region{marks.length === 1 ? "" : "s"} · rendered at{" "}
          {rasterScale}×
        </Cite>
        {hull && (
          <Button onClick={() => setCropped(!cropped)} size="xs" variant="ghost">
            {cropped ? "Show whole page" : "Zoom to evidence"}
          </Button>
        )}
      </div>

      <div className="overflow-hidden border border-border bg-muted/40">
        <svg
          className="block w-full transition-[view-box] duration-300"
          role="img"
          aria-label={`Page ${pageNumber} with ${marks.length} marked region${marks.length === 1 ? "" : "s"}`}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        >
          <image href={rasterUrl} height={height} width={width} x={0} y={0} />
          {marks.map((box, index) => (
            <Mark box={box} key={index} scale={view.w / width} />
          ))}
        </svg>
      </div>

      <TableContextPanel context={tableContext} />
    </figure>
  );
}

/**
 * One marked region: a wash light enough to read through, a rule around it, and corner ticks.
 *
 * The ticks are what make it read as a registration mark rather than a highlighter. Stroke widths
 * scale with the view so the mark stays the same visual weight whether the page is zoomed in on
 * one line or showing all of it.
 */
function Mark({ box, scale }: { box: Bbox; scale: number }) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const stroke = Math.max(0.6, scale * 1.4);
  const tick = Math.min(w, h) * 0.35;

  return (
    <g>
      <rect
        className="fill-evidence-wash stroke-evidence"
        height={h}
        strokeWidth={stroke}
        width={w}
        x={box.x0}
        y={box.y0}
      />
      {(
        [
          [box.x0, box.y0, 1, 1],
          [box.x1, box.y0, -1, 1],
          [box.x0, box.y1, 1, -1],
          [box.x1, box.y1, -1, -1],
        ] as const
      ).map(([x, y, dx, dy], index) => (
        <path
          className="stroke-evidence"
          d={`M ${x + dx * tick} ${y} L ${x} ${y} L ${x} ${y + dy * tick}`}
          fill="none"
          key={index}
          strokeWidth={stroke * 2}
        />
      ))}
    </g>
  );
}

/** A view box centred on `hull`, at least `MIN_CROP` of the page on each axis, clamped to it. */
function cropWindow(hull: Bbox, width: number, height: number) {
  const w = Math.min(width, Math.max((hull.x1 - hull.x0) * 1.6, width * MIN_CROP));
  const h = Math.min(height, Math.max((hull.y1 - hull.y0) * 2.4, height * MIN_CROP));
  const cx = (hull.x0 + hull.x1) / 2;
  const cy = (hull.y0 + hull.y1) / 2;
  return {
    x: Math.min(Math.max(0, cx - w / 2), width - w),
    y: Math.min(Math.max(0, cy - h / 2), height - h),
    w,
    h,
  };
}

function union(boxes: readonly Bbox[]): Bbox {
  return boxes.reduce((acc, box) => ({
    x0: Math.min(acc.x0, box.x0),
    y0: Math.min(acc.y0, box.y0),
    x1: Math.max(acc.x1, box.x1),
    y1: Math.max(acc.y1, box.y1),
  }));
}

/**
 * What governs a table cell.
 *
 * Shown beside the mark because for a table fact the mark alone is misleading: the box is around a
 * bare number, and the title, headers, and unit line are the whole of what it means.
 */
function TableContextPanel({
  context,
  className,
}: {
  context: TableContext | null;
  className?: string;
}) {
  if (!context) return null;

  const rows: [string, string | null][] = [
    ["Table", context.title],
    ["Column", context.columnHeader],
    ["Row", context.rowHeader],
    ["Unit", context.unitLine],
  ];
  const shown = rows.filter(([, value]) => value?.trim());
  if (shown.length === 0 && context.footnotes.length === 0) return null;

  return (
    <dl className={cn("border border-border text-sm", className)}>
      {shown.map(([label, value]) => (
        <div className="flex gap-3 border-border border-b px-3 py-1.5 last:border-b-0" key={label}>
          <dt className="w-16 shrink-0 text-muted-foreground text-xs">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
      {context.footnotes.length > 0 && (
        <div className="flex gap-3 border-border border-t px-3 py-1.5">
          <dt className="w-16 shrink-0 text-muted-foreground text-xs">Notes</dt>
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
