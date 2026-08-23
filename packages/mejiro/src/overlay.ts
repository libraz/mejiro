/**
 * Rectangle describing an image overlay position and size.
 *
 * This is the UI-side shape used while a host drags or resizes an overlay. It
 * is the single name for that shape across the package family — the React and
 * Vue packages re-export this type rather than declaring their own. Feeding an
 * overlay to the layout is a separate step: the exclusion rectangle `ImageRect`
 * carries the same geometry plus the margins reserved around the image.
 */
export interface ImageOverlayRect {
  /** Horizontal offset from the left edge of the content area (px). */
  x: number;
  /** Vertical offset from the top of the content area (px). */
  y: number;
  /** Width in the block direction (px). */
  w: number;
  /** Height in the inline direction (px). */
  h: number;
}

/**
 * Returns a moved copy of an image overlay rectangle.
 *
 * Pure — the input is never mutated. A drag handler is meant to keep the
 * rectangle captured at gesture start and re-derive the current one from the
 * cumulative pointer delta on every move, rather than applying per-move deltas
 * to the running rectangle, which would accumulate rounding error.
 *
 * The result is not clamped to the content area, so an overlay can be dragged
 * partly or fully out of view; a caller needing containment clamps the result.
 *
 * @param rect - Rectangle at the start of the gesture.
 * @param deltaX - Horizontal pointer movement (px); negative moves left.
 * @param deltaY - Vertical pointer movement (px); negative moves up.
 * @returns A new rectangle with the same size at the translated position.
 */
export function moveImageOverlayRect(
  rect: ImageOverlayRect,
  deltaX: number,
  deltaY: number,
): ImageOverlayRect {
  return { ...rect, x: rect.x + deltaX, y: rect.y + deltaY };
}

/**
 * Returns a resized copy of an image overlay rectangle.
 *
 * Anchors the top-left corner: `x` and `y` are carried over unchanged and only
 * the extent grows or shrinks, which matches a bottom-right resize handle. Pure,
 * and like {@link moveImageOverlayRect} intended to be applied to the rectangle
 * captured at gesture start.
 *
 * Width and height are clamped at `minSize` independently, so hitting the
 * minimum on one axis does not freeze the other. There is no upper bound and no
 * aspect-ratio lock — an image kept in proportion is the caller's concern.
 *
 * @param rect - Rectangle at the start of the gesture.
 * @param deltaX - Horizontal pointer movement (px); negative shrinks the width.
 * @param deltaY - Vertical pointer movement (px); negative shrinks the height.
 * @param minSize - Lower bound applied to both width and height (px).
 *   @defaultValue 40
 * @returns A new rectangle at the same position with the clamped size.
 */
export function resizeImageOverlayRect(
  rect: ImageOverlayRect,
  deltaX: number,
  deltaY: number,
  minSize = 40,
): ImageOverlayRect {
  return { ...rect, w: Math.max(minSize, rect.w + deltaX), h: Math.max(minSize, rect.h + deltaY) };
}
