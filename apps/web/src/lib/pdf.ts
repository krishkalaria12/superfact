import type { DocumentFailureReason } from "@superfact/db";
import * as mupdf from "mupdf";

/**
 * The cheap look at a PDF that decides whether it is worth processing at all.
 *
 * This is not the parser. Phase 03 opens the document again and reads geometry out of it; what
 * happens here is only the three refusals the plan asks for at intake — a file that is not a PDF,
 * one that will not open, and one with no text layer to read. Doing it before the upload means a
 * scan never occupies storage, and doing it in code means the refusal is deterministic.
 */

/** Pages sampled when deciding whether a text layer exists. */
const SAMPLE_LIMIT = 12;

/**
 * Characters a sampled page must yield to count as text-bearing.
 *
 * A page of body prose runs to a couple of thousand characters; a scanned page yields zero, and a
 * scanned page carrying a stray vector caption yields a handful. 120 sits in the empty space
 * between those two populations, which is why it does not need tuning per document.
 */
const MIN_CHARS_PER_PAGE = 120;

/**
 * MuPDF writes its own diagnostics — "trying to repair broken xref", "cannot find startxref" —
 * straight to the console. That is both stray output this codebase does not allow and the best
 * explanation of why a document was refused, so it is captured here and folded into the refusal
 * detail instead of being printed or thrown away.
 */
let mupdfLog: string[] = [];

mupdf.setLog({
  error: (message) => mupdfLog.push(message),
  warning: (message) => mupdfLog.push(message),
});

function withCapturedLog<T>(run: (drain: () => string[]) => T): T {
  mupdfLog = [];
  return run(() => [...new Set(mupdfLog)]);
}

export type PdfRefusal = { reason: DocumentFailureReason; detail: string };

export type PdfInspection =
  | { ok: true; pageCount: number; sampledPages: number; medianCharsPerPage: number }
  | ({ ok: false } & PdfRefusal);

/** Indices spread across the document, so a text-bearing preface cannot vouch for a scanned body. */
function samplePageIndices(pageCount: number): number[] {
  const count = Math.min(SAMPLE_LIMIT, pageCount);
  if (count === 1) return [0];

  const step = (pageCount - 1) / (count - 1);
  return [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * step)))];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Characters the page's text layer yields, or null when the page itself could not be read. */
function readPageCharCount(document: mupdf.Document, index: number): number | null {
  let page: mupdf.Page | undefined;
  let text: mupdf.StructuredText | undefined;

  try {
    page = document.loadPage(index);
    text = page.toStructuredText();
    return text.asText().trim().length;
  } catch {
    return null;
  } finally {
    text?.destroy();
    page?.destroy();
  }
}

export function inspectPdf(bytes: Uint8Array): PdfInspection {
  return withCapturedLog((drain) => {
    const result = inspect(bytes);
    if (result.ok) return result;

    const notes = drain();
    return notes.length > 0
      ? { ...result, detail: `${result.detail} (${notes.join("; ")})` }
      : result;
  });
}

function inspect(bytes: Uint8Array): PdfInspection {
  // The header is allowed a short preamble by the spec, so this looks at the opening bytes rather
  // than only at offset zero.
  const header = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (!header.includes("%PDF-")) {
    return { ok: false, reason: "not_a_pdf", detail: "no %PDF- header in the first 1024 bytes" };
  }

  let document: mupdf.Document;
  try {
    document = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch (error) {
    return { ok: false, reason: "corrupted", detail: messageOf(error) };
  }

  try {
    if (document.needsPassword()) {
      return { ok: false, reason: "encrypted", detail: "the document requires a password to open" };
    }

    let pageCount: number;
    try {
      pageCount = document.countPages();
    } catch (error) {
      return { ok: false, reason: "corrupted", detail: messageOf(error) };
    }

    if (pageCount < 1) {
      return { ok: false, reason: "corrupted", detail: "the document reports no pages" };
    }

    const sampled = samplePageIndices(pageCount).map((i) => readPageCharCount(document, i));
    const readable = sampled.filter((count): count is number => count !== null);

    if (readable.length === 0) {
      return { ok: false, reason: "corrupted", detail: "no sampled page could be read" };
    }

    const medianCharsPerPage = median(readable);
    if (medianCharsPerPage < MIN_CHARS_PER_PAGE) {
      return {
        ok: false,
        reason: "scanned_unsupported",
        detail: `median of ${medianCharsPerPage} characters across ${readable.length} sampled pages; the document has no usable text layer`,
      };
    }

    return { ok: true, pageCount, sampledPages: readable.length, medianCharsPerPage };
  } finally {
    document.destroy();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
