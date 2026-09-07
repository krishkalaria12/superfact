import type { Bbox, PageQuality, ParsedLine } from "@superfact/db/contracts";
import * as mupdf from "mupdf";

/**
 * One page of MuPDF's structured text, flattened into lines with geometry.
 *
 * The walker is used rather than `asJSON` because the vector callback — the ruling lines a bordered
 * table draws — is only reachable this way, and because character size has to be accumulated per
 * line as it goes.
 */

export type PageGeometry = {
  lines: ParsedLine[];
  /** Ruling lines and filled rectangles. Empty on every table page in the starter set. */
  vectors: Bbox[];
  text: string;
  quality: PageQuality;
};

/** MuPDF hands back rects as `[x0, y0, x1, y1]`, not as an object. */
function toBbox(rect: mupdf.Rect): Bbox {
  return { x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] };
}

/** U+FFFD is what a glyph the font could not map decodes to, and the tell for a bad text layer. */
const REPLACEMENT = "�";

export function readPageGeometry(page: mupdf.Page, pageNumber: number): PageGeometry {
  const structured = page.toStructuredText();

  try {
    const lines: ParsedLine[] = [];
    const vectors: Bbox[] = [];
    let imageArea = 0;

    let current: { bbox: Bbox; chars: string[]; size: number } | null = null;

    structured.walk({
      beginLine(bbox) {
        current = { bbox: toBbox(bbox), chars: [], size: 0 };
      },
      onChar(char, _origin, _font, size) {
        if (!current) return;
        current.chars.push(char);
        current.size = Math.max(current.size, size);
      },
      endLine() {
        if (!current) return;
        const text = current.chars.join("").trim();
        // Whitespace-only lines exist in quantity and carry no evidence, but dropping them would
        // renumber every line after them, so they are skipped before an id is minted.
        if (text.length > 0) {
          lines.push({
            id: `p${pageNumber}l${lines.length + 1}`,
            text,
            bbox: current.bbox,
            size: current.size,
          });
        }
        current = null;
      },
      onVector(bbox) {
        vectors.push(toBbox(bbox));
      },
      onImageBlock(bbox) {
        const box = toBbox(bbox);
        imageArea += Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
      },
    });

    const text = lines.map((line) => line.text).join("\n");
    const bounds = page.getBounds();
    const pageArea = Math.max(1, (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]));
    const replacements = text.split(REPLACEMENT).length - 1;

    return {
      lines,
      vectors,
      text,
      quality: {
        textDensity: (text.length / pageArea) * 1000,
        replacementCharRatio: text.length === 0 ? 0 : replacements / text.length,
        imageRatio: Math.min(1, imageArea / pageArea),
      },
    };
  } finally {
    structured.destroy();
  }
}
