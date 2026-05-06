import { moveImageOverlayRect, resizeImageOverlayRect } from '@libraz/mejiro';
import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from 'react';

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
  imageRect: ImageRect | null;
  /** Whether an image overlay is currently active. */
  hasImage: boolean;
  /** Toggle the image overlay on/off. */
  toggleImage: () => void;
  /** Pointer-down handler for the overlay body (initiates drag). */
  onOverlayPointerDown: (e: ReactPointerEvent) => void;
  /** Pointer-down handler for the resize handle. */
  onResizePointerDown: (e: ReactPointerEvent) => void;
}

/**
 * React hook that manages a draggable/resizable image overlay
 * with automatic text reflow via {@link ChapterLayout.syncImages}.
 *
 * @param layout - Current chapter layout (or `null` if not yet loaded).
 * @param spreadIdx - Current spread index.
 * @param onUpdate - Called with the updated {@link SpreadResult} after every reflow.
 * @param options - Default dimensions and position for the overlay.
 *
 * @example
 * ```tsx
 * const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
 *   useImageOverlay(layout, spreadIdx, setSpread);
 * ```
 */
export function useImageOverlay(
  layout: ChapterLayout | null,
  spreadIdx: number,
  onUpdate: (spread: SpreadResult) => void,
  options?: UseImageOverlayOptions,
): UseImageOverlayReturn {
  const defW = options?.defaultWidth ?? 120;
  const defH = options?.defaultHeight ?? 160;
  const defX = options?.defaultX ?? 80;
  const defY = options?.defaultY ?? 100;
  const margin = options?.margin;

  const [imageRect, setImageRect] = useState<ImageRect | null>(null);

  // Refs to avoid stale closures in pointer event handlers
  const rectRef = useRef(imageRect);
  rectRef.current = imageRect;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const spreadRef = useRef(spreadIdx);
  spreadRef.current = spreadIdx;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const syncToLayout = useCallback(
    (rect: ImageRect | null) => {
      const lo = layoutRef.current;
      if (!lo) return;
      const images: BookImage[] | undefined = rect
        ? [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h, margin }]
        : undefined;
      const spread = lo.syncImages(spreadRef.current, images);
      onUpdateRef.current(spread);
    },
    [margin],
  );

  const toggleImage = useCallback(() => {
    if (rectRef.current) {
      setImageRect(null);
      syncToLayout(null);
    } else {
      const r = { x: defX, y: defY, w: defW, h: defH };
      setImageRect(r);
      syncToLayout(r);
    }
  }, [defX, defY, defW, defH, syncToLayout]);

  const onOverlayPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const current = rectRef.current;
      if (!current) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const start = { ...current };
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.nativeEvent.pointerId);
      target.classList.add('dragging');

      let rafId = 0;
      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        const r = moveImageOverlayRect(start, dx, dy);
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setImageRect(r);
          syncToLayout(r);
        });
      };
      const onUp = () => {
        target.classList.remove('dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [syncToLayout],
  );

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const current = rectRef.current;
      if (!current) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const start = { ...current };
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.nativeEvent.pointerId);
      target.parentElement?.classList.add('dragging');

      let rafId = 0;
      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        const r = resizeImageOverlayRect(start, dx, dy);
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setImageRect(r);
          syncToLayout(r);
        });
      };
      const onUp = () => {
        target.parentElement?.classList.remove('dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [syncToLayout],
  );

  return {
    imageRect,
    hasImage: imageRect !== null,
    toggleImage,
    onOverlayPointerDown,
    onResizePointerDown,
  };
}
