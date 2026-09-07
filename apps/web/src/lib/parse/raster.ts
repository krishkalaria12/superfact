import * as mupdf from "mupdf";

/**
 * Page rasters, rendered from the same coordinate space the parser reads.
 *
 * This is why the evidence viewer draws boxes correctly: a stored bbox multiplied by
 * {@link RASTER_SCALE} is the box on screen. There is no transform between two libraries'
 * conventions to get wrong, which is the risk revision 1 ranked highest and this design retires.
 * The scale is stored on the page row rather than assumed, so changing it here does not silently
 * misplace every highlight drawn over a page rendered before the change.
 */

/** Raster pixels per PDF point. Two is legible at full size without doubling storage again. */
export const RASTER_SCALE = 2;

/**
 * Grayscale, not colour.
 *
 * These are pages of text, the highlight overlay supplies the only colour that matters, and chart
 * extraction is explicitly out of scope. Grayscale PNG comes out at half the size of RGB and
 * smaller than JPEG at any quality worth using on type.
 */
export function renderPage(page: mupdf.Page): Uint8Array {
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(RASTER_SCALE, RASTER_SCALE),
    mupdf.ColorSpace.DeviceGray,
    false,
  );

  try {
    return pixmap.asPNG();
  } finally {
    pixmap.destroy();
  }
}
