import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { createOverlayDragSession } from '@libraz/mejiro/browser';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ImageRect } from './useImageOverlay.js';

/** A single image overlay placed on a specific spread. */
export interface MultiImageItem {
  /** Stable ID for the overlay (auto-assigned on add). */
  id: string;
  /** Position and size in pixels, relative to the right page. */
  rect: ImageRect;
}

/** Options for {@link useMultiImageOverlay}. */
export interface UseMultiImageOverlayOptions {
  /** Default image width. @defaultValue 120 */
  defaultWidth?: number;
  /** Default image height. @defaultValue 160 */
  defaultHeight?: number;
  /** Default x. @defaultValue 80 */
  defaultX?: number;
  /** Default y. @defaultValue 100 */
  defaultY?: number;
  /** Margin around each image, in pixels. Defaults to the book's font size. */
  margin?: number;
  /** Called after every reflow caused by adding/removing/moving an image. */
  onUpdate?: (spread: SpreadResult) => void;
}

/** Return value of {@link useMultiImageOverlay}. */
export interface UseMultiImageOverlayReturn {
  /** Map of all images keyed by spread index. */
  imagesBySpread: Map<number, MultiImageItem[]>;
  /** Images on the current spread. */
  currentImages: MultiImageItem[];
  /** Whether any spread has at least one image. */
  hasImages: boolean;
  /** Add a new image on the current spread. */
  addImage: (overrides?: Partial<ImageRect>) => MultiImageItem;
  /** Remove the image with the given id. */
  removeImage: (id: string) => void;
  /** Replace an image's rectangle. */
  updateImage: (id: string, rect: Partial<ImageRect>) => void;
  /** Remove every image (or only those on `spreadIdx` if given). */
  clearImages: (spreadIdx?: number) => void;
  /** Pointer-down handler for the overlay body (drag). */
  onOverlayPointerDown: (id: string, e: ReactPointerEvent) => void;
  /** Pointer-down handler for the resize handle. */
  onResizePointerDown: (id: string, e: ReactPointerEvent) => void;
}

let nextId = 0;

/**
 * React hook that manages multiple draggable/resizable image overlays
 * per spread with automatic reflow via {@link ChapterLayout.setImages}.
 */
export function useMultiImageOverlay(
  layout: ChapterLayout | null,
  spreadIdx: number,
  options: UseMultiImageOverlayOptions = {},
): UseMultiImageOverlayReturn {
  const defW = options.defaultWidth ?? 120;
  const defH = options.defaultHeight ?? 160;
  const defX = options.defaultX ?? 80;
  const defY = options.defaultY ?? 100;
  const margin = options.margin;

  const [images, setImages] = useState<Map<number, MultiImageItem[]>>(() => new Map());
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const layoutRef = useRef<ChapterLayout | null>(null);
  layoutRef.current = layout;
  const spreadIdxRef = useRef(spreadIdx);
  spreadIdxRef.current = spreadIdx;
  const onUpdateRef = useRef(options.onUpdate);
  onUpdateRef.current = options.onUpdate;
  const activeDragCleanupsRef = useRef(new Set<() => void>());

  useEffect(
    () => () => {
      for (const cleanup of activeDragCleanupsRef.current) cleanup();
      activeDragCleanupsRef.current.clear();
    },
    [],
  );

  const syncSpread = useCallback(
    (si: number) => {
      const lo = layoutRef.current;
      if (!lo) return;
      const items = imagesRef.current.get(si) ?? [];
      const bookImages: BookImage[] = items.map((it) => ({
        x: it.rect.x,
        y: it.rect.y,
        w: it.rect.w,
        h: it.rect.h,
        margin,
      }));
      lo.setImages(si, bookImages);
      onUpdateRef.current?.(lo.getSpread(si));
    },
    [margin],
  );

  const commit = useCallback(
    (next: Map<number, MultiImageItem[]>, affectedSpread: number) => {
      imagesRef.current = next;
      setImages(next);
      syncSpread(affectedSpread);
    },
    [syncSpread],
  );

  const findById = useCallback(
    (id: string): { spread: number; index: number; item: MultiImageItem } | null => {
      for (const [s, list] of imagesRef.current) {
        const i = list.findIndex((it) => it.id === id);
        if (i >= 0) return { spread: s, index: i, item: list[i] };
      }
      return null;
    },
    [],
  );

  const addImage = useCallback(
    (overrides?: Partial<ImageRect>): MultiImageItem => {
      const si = spreadIdxRef.current;
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
          w: overrides?.w ?? defW,
          h: overrides?.h ?? defH,
        },
      };
      const next = new Map(imagesRef.current);
      next.set(si, [...list, item]);
      commit(next, si);
      return item;
    },
    [defX, defY, defW, defH, commit],
  );

  const removeImage = useCallback(
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

  const updateImage = useCallback(
    (id: string, rect: Partial<ImageRect>) => {
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

  const clearImages = useCallback(
    (target?: number) => {
      if (target == null) {
        const old = imagesRef.current;
        imagesRef.current = new Map();
        setImages(new Map());
        layoutRef.current?.clearImages();
        if (layoutRef.current) {
          for (const si of old.keys()) onUpdateRef.current?.(layoutRef.current.getSpread(si));
        }
      } else {
        const next = new Map(imagesRef.current);
        next.delete(target);
        commit(next, target);
      }
    },
    [commit],
  );

  const onOverlayPointerDown = useCallback(
    (id: string, e: ReactPointerEvent) => {
      e.preventDefault();
      const found = findById(id);
      if (!found) return;
      const target = e.currentTarget as HTMLElement;
      createOverlayDragSession({
        mode: 'move',
        rect: found.item.rect,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.nativeEvent.pointerId,
        captureElement: target,
        activeElement: target,
        dragClass: 'is-dragging',
        registry: activeDragCleanupsRef.current,
        onChange: (rect) => updateImage(id, rect),
      });
    },
    [findById, updateImage],
  );

  const onResizePointerDown = useCallback(
    (id: string, e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const found = findById(id);
      if (!found) return;
      const target = e.currentTarget as HTMLElement;
      createOverlayDragSession({
        mode: 'resize',
        rect: found.item.rect,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.nativeEvent.pointerId,
        captureElement: target,
        activeElement: target.parentElement,
        dragClass: 'is-dragging',
        registry: activeDragCleanupsRef.current,
        onChange: (rect) => updateImage(id, rect),
      });
    },
    [findById, updateImage],
  );

  // Re-sync image exclusions whenever the layout is replaced.
  useEffect(() => {
    if (!layout) return;
    for (const si of imagesRef.current.keys()) syncSpread(si);
  }, [layout, syncSpread]);

  const currentImages = useMemo(() => images.get(spreadIdx) ?? [], [images, spreadIdx]);
  const hasImages = useMemo(() => [...images.values()].some((list) => list.length > 0), [images]);

  return {
    imagesBySpread: images,
    currentImages,
    hasImages,
    addImage,
    removeImage,
    updateImage,
    clearImages,
    onOverlayPointerDown,
    onResizePointerDown,
  };
}
