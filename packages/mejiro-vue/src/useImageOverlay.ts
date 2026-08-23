import type { ImageOverlayRect } from '@libraz/mejiro';
import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { createOverlayDragSession } from '@libraz/mejiro/browser';
import { computed, onScopeDispose, type Ref, ref, watch } from 'vue';

export type { ImageOverlayRect } from '@libraz/mejiro';

/**
 * Rectangle describing an image overlay position and size.
 *
 * @deprecated Alias of {@link ImageOverlayRect}, which is the single name for
 * this shape across the package family. The core package exports an unrelated
 * `ImageRect` (an exclusion rectangle, with margin fields), so the two names
 * collide when both packages are imported into one module.
 */
export type ImageRect = ImageOverlayRect;

/** Options for {@link useImageOverlay}. */
export interface UseImageOverlayOptions {
  /** Default image width in pixels. @defaultValue 120 */
  defaultWidth?: number;
  /** Default image height in pixels. @defaultValue 160 */
  defaultHeight?: number;
  /** Default x position. @defaultValue 80 */
  defaultX?: number;
  /** Default y position. @defaultValue 100 */
  defaultY?: number;
  /** Margin around the image in pixels. Defaults to the book's font size. */
  margin?: number;
}

/** Return value of {@link useImageOverlay}. */
export interface UseImageOverlayReturn {
  /** Current image rectangle, or `null` if no overlay is active. */
  imageRect: Ref<ImageOverlayRect | null>;
  /** Whether an image overlay is currently active. */
  hasImage: Ref<boolean>;
  /** Toggle the image overlay on/off. */
  toggleImage: () => void;
  /** Pointer-down handler for the overlay body (initiates drag). */
  onOverlayPointerDown: (e: PointerEvent) => void;
  /** Pointer-down handler for the resize handle. */
  onResizePointerDown: (e: PointerEvent) => void;
}

/**
 * Vue composable that manages a draggable/resizable image overlay
 * with automatic text reflow via {@link ChapterLayout.syncImages}.
 *
 * While an overlay is active the exclusion is re-issued whenever `layout` is
 * replaced or `spreadIdx` changes, so a re-layout or a page turn never leaves
 * the overlay drawn without its matching text reflow.
 *
 * @param layout - Ref to the current chapter layout (or `null`).
 * @param spreadIdx - Ref to the current spread index.
 * @param onUpdate - Called with the updated {@link SpreadResult} after every reflow.
 * @param options - Default dimensions and position for the overlay.
 *
 * @example
 * ```ts
 * const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
 *   useImageOverlay(layout, spreadIdx, (s) => { spread.value = s; });
 * ```
 */
export function useImageOverlay(
  layout: Ref<ChapterLayout | null>,
  spreadIdx: Ref<number>,
  onUpdate: (spread: SpreadResult) => void,
  options?: UseImageOverlayOptions,
): UseImageOverlayReturn {
  const defW = options?.defaultWidth ?? 120;
  const defH = options?.defaultHeight ?? 160;
  const defX = options?.defaultX ?? 80;
  const defY = options?.defaultY ?? 100;
  const margin = options?.margin;

  const imageRect = ref<ImageOverlayRect | null>(null);
  const hasImage = computed(() => imageRect.value !== null);
  const activeDragCleanups = new Set<() => void>();

  onScopeDispose(() => {
    for (const cleanup of activeDragCleanups) cleanup();
    activeDragCleanups.clear();
  });

  function syncToLayout(rect: ImageOverlayRect | null): void {
    const lo = layout.value;
    if (!lo) return;
    const images: BookImage[] | undefined = rect
      ? [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h, margin }]
      : undefined;
    const spread = lo.syncImages(spreadIdx.value, images);
    onUpdate(spread);
  }

  // Re-apply the exclusion after the layout instance is replaced (resize, font
  // or option change) and after the reader moves to another spread, so the text
  // reflow keeps following the overlay. Moving spreads also drops the exclusion
  // left behind on the spread we came from — only the displayed one carries it.
  watch([layout, spreadIdx], ([, nextSpread], [prevLayout, prevSpread]) => {
    if (!imageRect.value) return;
    if (prevLayout && prevSpread !== nextSpread) {
      // Clearing the outgoing spread must not be reported through `onUpdate`:
      // that spread is no longer the one being displayed.
      prevLayout.syncImages(prevSpread, undefined);
    }
    syncToLayout(imageRect.value);
  });

  function toggleImage(): void {
    if (imageRect.value) {
      imageRect.value = null;
      syncToLayout(null);
    } else {
      const r = { x: defX, y: defY, w: defW, h: defH };
      imageRect.value = r;
      syncToLayout(r);
    }
  }

  function applyRect(rect: ImageOverlayRect): void {
    imageRect.value = rect;
    syncToLayout(rect);
  }

  function onOverlayPointerDown(e: PointerEvent): void {
    e.preventDefault();
    const current = imageRect.value;
    if (!current) return;
    const target = e.currentTarget as HTMLElement;
    createOverlayDragSession({
      mode: 'move',
      rect: current,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      captureElement: target,
      activeElement: target,
      dragClass: 'dragging',
      registry: activeDragCleanups,
      onChange: applyRect,
    });
  }

  function onResizePointerDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const current = imageRect.value;
    if (!current) return;
    const target = e.currentTarget as HTMLElement;
    createOverlayDragSession({
      mode: 'resize',
      rect: current,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      captureElement: target,
      activeElement: target.parentElement,
      dragClass: 'dragging',
      registry: activeDragCleanups,
      onChange: applyRect,
    });
  }

  return {
    imageRect,
    hasImage,
    toggleImage,
    onOverlayPointerDown,
    onResizePointerDown,
  };
}
