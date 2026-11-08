import type { ImageOverlayRect } from '@libraz/mejiro';
import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { createOverlayDragSession, isPrimaryPointerPress } from '@libraz/mejiro/browser';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type { ImageOverlayRect } from '@libraz/mejiro';

/** A single image overlay placed on a specific spread. */
export interface MultiImageItem {
  /** Stable ID for the overlay (auto-assigned on add). */
  id: string;
  /** Position and size in pixels, relative to the right page. */
  rect: ImageOverlayRect;
}

/** Options for {@link useImageOverlay}. */
export interface UseImageOverlayOptions {
  /** Layout spread that {@link UseImageOverlayReturn.addOverlay} places overlays on. */
  spreadIndex: number;
  /** Default overlay width in pixels. @defaultValue 120 */
  defaultWidth?: number;
  /** Default overlay height in pixels. @defaultValue 160 */
  defaultHeight?: number;
  /** Default x position, relative to the right page. @defaultValue 80 */
  defaultX?: number;
  /** Default y position. @defaultValue 100 */
  defaultY?: number;
  /** Margin around each overlay, in pixels. Defaults to the book's font size. */
  margin?: number;
  /**
   * Called with each spread the layout re-flowed after an overlay change, and
   * after the overlays are re-applied to a replacement layout or a new margin.
   * Pair it with `useSpread().refresh()` so the spread on screen picks up the
   * reflow. @defaultValue no-op
   */
  onReflow?: (spread: SpreadResult) => void;
}

/** Return value of {@link useImageOverlay}. */
export interface UseImageOverlayReturn {
  /**
   * Overlays keyed by spread index. A new map whenever the overlays or the
   * margin they are applied with change, and a replacement layout has them
   * before any view renders from it, so this map and the layout together key
   * anything derived from the layout.
   */
  imagesBySpread: ReadonlyMap<number, readonly MultiImageItem[]>;
  /** Overlays on {@link UseImageOverlayOptions.spreadIndex}; a new array whenever `imagesBySpread` changes. */
  currentImages: readonly MultiImageItem[];
  /** Whether any spread holds at least one overlay. */
  hasOverlays: boolean;
  /** Adds an overlay on the current spread and returns it. */
  addOverlay: (overrides?: Partial<ImageOverlayRect>) => MultiImageItem;
  /** Removes the overlay with the given id; a no-op for an unknown id. */
  removeOverlay: (id: string) => void;
  /** Merges `rect` into the rectangle of the overlay with the given id; a no-op for an unknown id. */
  updateOverlay: (id: string, rect: Partial<ImageOverlayRect>) => void;
  /** Removes every overlay, or only those on `spreadIndex` when given. */
  clearOverlays: (spreadIndex?: number) => void;
  /** Pointer-down handler for an overlay body: starts a move drag. */
  onOverlayPointerDown: (id: string, e: ReactPointerEvent) => void;
  /** Pointer-down handler for an overlay's resize handle: starts a resize drag. */
  onResizePointerDown: (id: string, e: ReactPointerEvent) => void;
}

let nextId = 0;

/** Sets each listed spread's images on `layout`, without reading any spread back. */
function applyImages(
  layout: ChapterLayout,
  images: ReadonlyMap<number, readonly MultiImageItem[]>,
  spreads: readonly number[],
  margin: number | undefined,
): void {
  for (const si of spreads) {
    const bookImages: BookImage[] = (images.get(si) ?? []).map((it) => ({
      x: it.rect.x,
      y: it.rect.y,
      width: it.rect.width,
      height: it.rect.height,
      margin,
    }));
    layout.setImages(si, bookImages);
  }
}

/**
 * Page of the spread an overlay belongs to when pages are shown apart: the one
 * holding its horizontal centre. Rects are relative to the right page, so a
 * negative centre lies on the left page, one page width to the left.
 *
 * @param rect - Overlay rectangle, relative to the right page.
 * @returns The page side the overlay is drawn on.
 */
export function overlayPageSide(rect: ImageOverlayRect): 'right' | 'left' {
  return rect.x + rect.width / 2 < 0 ? 'left' : 'right';
}

/**
 * React hook that manages draggable, resizable image overlays per spread and
 * re-flows the text around them via `ChapterLayout.setImages`.
 *
 * @param layout - Chapter layout the overlays exclude text from, or `null` while none is ready.
 * @param options - Current spread, overlay defaults, margin and reflow notification.
 * @returns The overlay state, mutators and pointer handlers.
 *
 * @example
 * ```tsx
 * const nav = useSpread(layout);
 * const overlays = useImageOverlay(layout, {
 *   spreadIndex: nav.spreadIndex,
 *   onReflow: () => nav.refresh(),
 * });
 * ```
 */
export function useImageOverlay(
  layout: ChapterLayout | null,
  options: UseImageOverlayOptions,
): UseImageOverlayReturn {
  const { spreadIndex } = options;
  const defW = options.defaultWidth ?? 120;
  const defH = options.defaultHeight ?? 160;
  const defX = options.defaultX ?? 80;
  const defY = options.defaultY ?? 100;
  const margin = options.margin;

  const [images, setImages] = useState<ReadonlyMap<number, readonly MultiImageItem[]>>(
    () => new Map(),
  );
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const layoutRef = useRef<ChapterLayout | null>(null);
  layoutRef.current = layout;
  const spreadIndexRef = useRef(spreadIndex);
  spreadIndexRef.current = spreadIndex;
  const onReflowRef = useRef(options.onReflow);
  onReflowRef.current = options.onReflow;
  // Read at sync time, so a drag that began before a margin change uses the new one.
  const marginRef = useRef(margin);
  marginRef.current = margin;
  const activeDragCleanupsRef = useRef(new Set<() => void>());

  useEffect(
    () => () => {
      for (const cleanup of activeDragCleanupsRef.current) cleanup();
      activeDragCleanupsRef.current.clear();
    },
    [],
  );

  // Every spread's images are set before any spread is read back, so each
  // reported spread reflects all of them.
  const syncSpreads = useCallback((spreads: readonly number[]) => {
    const lo = layoutRef.current;
    if (!lo) return;
    applyImages(lo, imagesRef.current, spreads, marginRef.current);
    for (const si of spreads) onReflowRef.current?.(lo.getSpread(si));
  }, []);

  // A replacement layout, or a new margin, gets the images while rendering, so
  // every view derived from the layout in this same render already reflows.
  const appliedRef = useRef<{ layout: ChapterLayout | null; margin: number | undefined }>({
    layout: null,
    margin,
  });
  if (layout && (appliedRef.current.layout !== layout || appliedRef.current.margin !== margin)) {
    appliedRef.current = { layout, margin };
    applyImages(layout, imagesRef.current, [...imagesRef.current.keys()], margin);
  }

  const commit = useCallback(
    (next: ReadonlyMap<number, readonly MultiImageItem[]>, affectedSpread: number) => {
      imagesRef.current = next;
      setImages(next);
      syncSpreads([affectedSpread]);
    },
    [syncSpreads],
  );

  const findById = useCallback((id: string): { spread: number; item: MultiImageItem } | null => {
    for (const [s, list] of imagesRef.current) {
      const item = list.find((it) => it.id === id);
      if (item) return { spread: s, item };
    }
    return null;
  }, []);

  const addOverlay = useCallback(
    (overrides?: Partial<ImageOverlayRect>): MultiImageItem => {
      const si = spreadIndexRef.current;
      const list = imagesRef.current.get(si) ?? [];
      const last = list[list.length - 1];
      const baseX = last ? last.rect.x - 100 : defX;
      const baseY = last ? last.rect.y + 40 : defY;
      nextId += 1;
      const item: MultiImageItem = {
        id: `mejiro-img-${nextId}`,
        rect: {
          x: overrides?.x ?? baseX,
          y: overrides?.y ?? baseY,
          width: overrides?.width ?? defW,
          height: overrides?.height ?? defH,
        },
      };
      const next = new Map(imagesRef.current);
      next.set(si, [...list, item]);
      commit(next, si);
      return item;
    },
    [defX, defY, defW, defH, commit],
  );

  const removeOverlay = useCallback(
    (id: string) => {
      const found = findById(id);
      if (!found) return;
      const next = new Map(imagesRef.current);
      const list = (next.get(found.spread) ?? []).filter((it) => it.id !== id);
      if (list.length === 0) next.delete(found.spread);
      else next.set(found.spread, list);
      commit(next, found.spread);
    },
    [findById, commit],
  );

  const updateOverlay = useCallback(
    (id: string, rect: Partial<ImageOverlayRect>) => {
      const found = findById(id);
      if (!found) return;
      const next = new Map(imagesRef.current);
      const list = (next.get(found.spread) ?? []).map((it) =>
        it.id === id ? { ...it, rect: { ...it.rect, ...rect } } : it,
      );
      next.set(found.spread, list);
      commit(next, found.spread);
    },
    [findById, commit],
  );

  const clearOverlays = useCallback(
    (target?: number) => {
      if (target == null) {
        const old = imagesRef.current;
        imagesRef.current = new Map();
        setImages(new Map());
        layoutRef.current?.clearImages();
        if (layoutRef.current) {
          for (const si of old.keys()) onReflowRef.current?.(layoutRef.current.getSpread(si));
        }
      } else {
        const next = new Map(imagesRef.current);
        next.delete(target);
        commit(next, target);
      }
    },
    [commit],
  );

  const startDrag = useCallback(
    (id: string, e: ReactPointerEvent, mode: 'move' | 'resize') => {
      if (!isPrimaryPointerPress(e)) return;
      e.preventDefault();
      if (mode === 'resize') e.stopPropagation();
      const found = findById(id);
      if (!found) return;
      const target = e.currentTarget as HTMLElement;
      createOverlayDragSession({
        mode,
        rect: found.item.rect,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.nativeEvent.pointerId,
        captureElement: target,
        activeElement: mode === 'move' ? target : target.parentElement,
        dragClass: 'is-dragging',
        registry: activeDragCleanupsRef.current,
        onRectChange: (rect) => updateOverlay(id, rect),
      });
    },
    [findById, updateOverlay],
  );

  const onOverlayPointerDown = useCallback(
    (id: string, e: ReactPointerEvent) => startDrag(id, e, 'move'),
    [startDrag],
  );
  const onResizePointerDown = useCallback(
    (id: string, e: ReactPointerEvent) => startDrag(id, e, 'resize'),
    [startDrag],
  );

  // Report the spreads re-applied during render once it commits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new margin re-applies them too.
  useEffect(() => {
    if (!layout) return;
    for (const si of imagesRef.current.keys()) onReflowRef.current?.(layout.getSpread(si));
  }, [layout, margin]);

  // A new margin changes the exclusions without changing `images`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: margin keys the copy.
  const imagesBySpread = useMemo(() => new Map(images), [images, margin]);
  // A fresh array per map, so it changes whenever any spread's exclusions do.
  const currentImages = useMemo(
    () => [...(imagesBySpread.get(spreadIndex) ?? [])],
    [imagesBySpread, spreadIndex],
  );
  const hasOverlays = useMemo(() => [...images.values()].some((list) => list.length > 0), [images]);

  return {
    imagesBySpread,
    currentImages,
    hasOverlays,
    addOverlay,
    removeOverlay,
    updateOverlay,
    clearOverlays,
    onOverlayPointerDown,
    onResizePointerDown,
  };
}
