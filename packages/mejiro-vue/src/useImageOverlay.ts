import { moveImageOverlayRect, resizeImageOverlayRect } from '@libraz/mejiro';
import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { computed, onScopeDispose, type Ref, ref } from 'vue';

/** Rectangle describing an image overlay position and size. */
export interface ImageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  imageRect: Ref<ImageRect | null>;
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

  const imageRect = ref<ImageRect | null>(null);
  const hasImage = computed(() => imageRect.value !== null);
  const activeDragCleanups = new Set<() => void>();

  onScopeDispose(() => {
    for (const cleanup of activeDragCleanups) cleanup();
    activeDragCleanups.clear();
  });

  function syncToLayout(rect: ImageRect | null): void {
    const lo = layout.value;
    if (!lo) return;
    const images: BookImage[] | undefined = rect
      ? [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h, margin }]
      : undefined;
    const spread = lo.syncImages(spreadIdx.value, images);
    onUpdate(spread);
  }

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

  function onOverlayPointerDown(e: PointerEvent): void {
    e.preventDefault();
    const current = imageRect.value;
    if (!current) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...current };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    target.classList.add('dragging');

    let rafId = 0;
    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      const r = moveImageOverlayRect(start, dx, dy);
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        imageRect.value = r;
        syncToLayout(r);
      });
    };
    let cleanup: () => void;
    const onUp = () => cleanup();
    cleanup = () => {
      cancelAnimationFrame(rafId);
      target.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      activeDragCleanups.delete(cleanup);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    activeDragCleanups.add(cleanup);
  }

  function onResizePointerDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const current = imageRect.value;
    if (!current) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...current };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    target.parentElement?.classList.add('dragging');

    let rafId = 0;
    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      const r = resizeImageOverlayRect(start, dx, dy);
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        imageRect.value = r;
        syncToLayout(r);
      });
    };
    let cleanup: () => void;
    const onUp = () => cleanup();
    cleanup = () => {
      cancelAnimationFrame(rafId);
      target.parentElement?.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      activeDragCleanups.delete(cleanup);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    activeDragCleanups.add(cleanup);
  }

  return {
    imageRect,
    hasImage,
    toggleImage,
    onOverlayPointerDown,
    onResizePointerDown,
  };
}
