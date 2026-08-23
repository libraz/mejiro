import type { ImageOverlayRect } from '@libraz/mejiro';
import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { createOverlayDragSession } from '@libraz/mejiro/browser';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

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
  imageRect: ImageOverlayRect | null;
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
 * While an overlay is active the exclusion is re-issued whenever `layout` is
 * replaced or `spreadIdx` changes, so a re-layout or a page turn never leaves
 * the overlay drawn without its matching text reflow.
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

  const [imageRect, setImageRect] = useState<ImageOverlayRect | null>(null);

  // Refs to avoid stale closures in pointer event handlers
  const rectRef = useRef(imageRect);
  rectRef.current = imageRect;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const spreadRef = useRef(spreadIdx);
  spreadRef.current = spreadIdx;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const activeDragCleanupsRef = useRef(new Set<() => void>());

  useEffect(
    () => () => {
      for (const cleanup of activeDragCleanupsRef.current) cleanup();
      activeDragCleanupsRef.current.clear();
    },
    [],
  );

  const syncToLayout = useCallback(
    (rect: ImageOverlayRect | null) => {
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

  // Re-apply the exclusion after the layout instance is replaced (resize, font
  // or option change) and after the reader moves to another spread, so the text
  // reflow keeps following the overlay. Moving spreads also drops the exclusion
  // left behind on the spread we came from — only the displayed one carries it.
  const syncedRef = useRef<{ layout: ChapterLayout | null; spreadIdx: number }>({
    layout,
    spreadIdx,
  });
  useEffect(() => {
    const prev = syncedRef.current;
    syncedRef.current = { layout, spreadIdx };
    if (prev.layout === layout && prev.spreadIdx === spreadIdx) return;
    if (rectRef.current === null) return;
    if (prev.layout && prev.spreadIdx !== spreadIdx) {
      // Clearing the outgoing spread must not be reported through `onUpdate`:
      // that spread is no longer the one being displayed.
      prev.layout.syncImages(prev.spreadIdx, undefined);
    }
    syncToLayout(rectRef.current);
  }, [layout, spreadIdx, syncToLayout]);

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

  const applyRect = useCallback(
    (rect: ImageOverlayRect) => {
      setImageRect(rect);
      syncToLayout(rect);
    },
    [syncToLayout],
  );

  const onOverlayPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const current = rectRef.current;
      if (!current) return;
      const target = e.currentTarget as HTMLElement;
      createOverlayDragSession({
        mode: 'move',
        rect: current,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.nativeEvent.pointerId,
        captureElement: target,
        activeElement: target,
        dragClass: 'dragging',
        registry: activeDragCleanupsRef.current,
        onChange: applyRect,
      });
    },
    [applyRect],
  );

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const current = rectRef.current;
      if (!current) return;
      const target = e.currentTarget as HTMLElement;
      createOverlayDragSession({
        mode: 'resize',
        rect: current,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.nativeEvent.pointerId,
        captureElement: target,
        activeElement: target.parentElement,
        dragClass: 'dragging',
        registry: activeDragCleanupsRef.current,
        onChange: applyRect,
      });
    },
    [applyRect],
  );

  return {
    imageRect,
    hasImage: imageRect !== null,
    toggleImage,
    onOverlayPointerDown,
    onResizePointerDown,
  };
}
