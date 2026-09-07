import { db, documents, pages } from "@superfact/db";
import type { Document, NewPage, PageFailureReason } from "@superfact/db";
import type { ParsedPage } from "@superfact/db/contracts";
import { eq } from "@superfact/db/orm";
import * as mupdf from "mupdf";

import { pageRasterObjectId, putObject } from "@/lib/storage";
import { detectBands } from "./bands";
import { mapWithConcurrency } from "./concurrency";
import { RASTER_SCALE, renderPage } from "./raster";
import { readPageGeometry } from "./structured-text";
import { reconstructTables } from "./tables";

/**
 * The parse stage: text, geometry, tables, and one raster per page.
 *
 * A page that fails is written as a failed row rather than skipped. A document that reports success
 * over a hole is the one outcome the plan refuses, and coverage counts are only honest if the
 * failures are rows too.
 */

/**
 * Pages rendered before their rasters are uploaded together.
 *
 * MuPDF is single-threaded WebAssembly, so rendering gains nothing from concurrency; uploading is
 * network-bound and gains a great deal. Chunking keeps both busy without holding a hundred page
 * images in memory at once.
 */
const CHUNK = 8;

export type ParseSummary = {
  pageCount: number;
  parsed: number;
  failed: number;
};

function chunked<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );
}

type RenderedPage =
  | { ok: true; parsed: ParsedPage; png: Uint8Array }
  | { ok: false; pageNumber: number; reason: PageFailureReason; detail: string };

function readOnePage(document: mupdf.Document, index: number): RenderedPage {
  const pageNumber = index + 1;
  let page: mupdf.Page | undefined;

  try {
    page = document.loadPage(index);
    const bounds = page.getBounds();
    const geometry = readPageGeometry(page, pageNumber);
    const bands = detectBands(geometry.lines, bounds[2] - bounds[0]);

    return {
      ok: true,
      png: renderPage(page),
      parsed: {
        pageNumber,
        width: bounds[2] - bounds[0],
        height: bounds[3] - bounds[1],
        text: geometry.text,
        lines: geometry.lines,
        bands,
        tables: reconstructTables(geometry.lines, bands, pageNumber),
        // Filled in once the raster is stored; rendering and uploading are separate concerns.
        raster: null,
        quality: geometry.quality,
      },
    };
  } catch (error) {
    return {
      ok: false,
      pageNumber,
      reason: "parse_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    page?.destroy();
  }
}

export async function parseDocument(document: Document): Promise<ParseSummary> {
  if (!document.storageUrl) {
    throw new Error(`document ${document.id} has no stored bytes to parse`);
  }

  const response = await fetch(document.storageUrl);
  if (!response.ok) {
    throw new Error(`could not fetch ${document.id} from storage: ${response.status}`);
  }

  const opened = mupdf.Document.openDocument(
    new Uint8Array(await response.arrayBuffer()),
    "application/pdf",
  );

  try {
    const pageCount = opened.countPages();
    const rows: NewPage[] = [];

    for (const indices of chunked([...Array(pageCount).keys()], CHUNK)) {
      const rendered = indices.map((index) => readOnePage(opened, index));

      const stored = await mapWithConcurrency(rendered, CHUNK, async (page) => {
        if (!page.ok) return page;

        try {
          const object = await putObject({
            bytes: page.png,
            filename: `${document.contentHash}-p${page.parsed.pageNumber}.png`,
            contentType: "image/png",
            customId: pageRasterObjectId(document.contentHash, page.parsed.pageNumber),
          });

          return {
            ...page,
            parsed: { ...page.parsed, raster: { ...object, scale: RASTER_SCALE } },
          };
        } catch (error) {
          // The text is already read; losing the image costs the highlight, not the evidence. The
          // page is still marked failed, because a fact nobody can see the source of is not one
          // this system publishes.
          return {
            ok: false as const,
            pageNumber: page.parsed.pageNumber,
            reason: "render_failed" as const,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      });

      for (const page of stored) {
        rows.push(
          page.ok
            ? {
                documentId: document.id,
                pageNumber: page.parsed.pageNumber,
                width: page.parsed.width,
                height: page.parsed.height,
                text: page.parsed.text,
                lines: page.parsed.lines,
                bands: page.parsed.bands,
                tables: page.parsed.tables,
                rasterKey: page.parsed.raster?.key ?? null,
                rasterUrl: page.parsed.raster?.url ?? null,
                rasterScale: page.parsed.raster?.scale ?? null,
                quality: page.parsed.quality,
                status: "parsed",
              }
            : {
                documentId: document.id,
                pageNumber: page.pageNumber,
                status: "failed",
                failureReason: page.reason,
                failureDetail: page.detail,
              },
        );
      }
    }

    if (rows.length > 0) {
      for (const batch of chunked(rows, 50)) await db.insert(pages).values(batch);
    }

    await db.update(documents).set({ pageCount }).where(eq(documents.id, document.id));

    return {
      pageCount,
      parsed: rows.filter((row) => row.status === "parsed").length,
      failed: rows.filter((row) => row.status === "failed").length,
    };
  } finally {
    opened.destroy();
  }
}
