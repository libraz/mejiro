/** Rectangle describing an image overlay position and size. */
export interface ImageOverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Returns a moved copy of an image overlay rectangle. */
export function moveImageOverlayRect(
  rect: ImageOverlayRect,
  deltaX: number,
  deltaY: number,
): ImageOverlayRect {
  return { ...rect, x: rect.x + deltaX, y: rect.y + deltaY };
}

/** Returns a resized copy of an image overlay rectangle. */
export function resizeImageOverlayRect(
  rect: ImageOverlayRect,
  deltaX: number,
  deltaY: number,
  minSize = 40,
): ImageOverlayRect {
  return { ...rect, w: Math.max(minSize, rect.w + deltaX), h: Math.max(minSize, rect.h + deltaY) };
}
