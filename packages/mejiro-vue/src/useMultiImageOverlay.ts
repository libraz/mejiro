import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { createOverlayDragSession } from '@libraz/mejiro/browser';
import {
  type ComputedRef,
  computed,
  onScopeDispose,
  type Ref,
  shallowRef,
  triggerRef,
  watch,
} from 'vue';
import type { ImageRect } from './useImageOverlay.js';

/** A single image overlay placed on a specific spread. */
export interface MultiImageItem {
  /** Stable ID for the overlay (auto-assigned on add). */
  id: string;
  /** Position and size in pixels, relative to the right page's top-left corner. */
  rect: ImageRect;
}

/** Options for {@link useMultiImageOverlay}. */
export interface UseMultiImageOverlayOptions {
  /** Default image width. @defaultValue 120 */
  defaultWidth?: number;
  /** Default image height. @defaultValue 160 */
  defaultHeight?: number;
  /** Default x position. @defaultValue 80 */
  defaultX?: number;
  /** Default y position. @defaultValue 100 */
  defaultY?: number;
  /** Margin around each image, in pixels. Defaults to the book's font size. */
  margin?: number;
  /** Called after every layout reflow caused by adding/removing/moving an image. */
  onUpdate?: (spread: SpreadResult) => void;
}

/** Return value of {@link useMultiImageOverlay}. */
export interface UseMultiImageOverlayReturn {
  /** Map of all images keyed by spread index. */
  imagesBySpread: Ref<Map<number, MultiImageItem[]>>;
  /** Images on the currently-active spread. */
  currentImages: ComputedRef<MultiImageItem[]>;
  /** Whether any spread has at least one image. */
  hasImages: ComputedRef<boolean>;
  /** Add a new image on the current spread and return its descriptor. */
  addImage: (overrides?: Partial<ImageRect>) => MultiImageItem;
  /** Remove the image with the given ID (no-op if missing). */
  removeImage: (id: string) => void;
  /** Replace an image's rectangle. */
  updateImage: (id: string, rect: Partial<ImageRect>) => void;
  /** Remove every image (or only those on `spreadIdx` if given). */
  clearImages: (spreadIdx?: number) => void;
  /** Pointer-down handler for an overlay body (initiates drag). */
  onOverlayPointerDown: (id: string, e: PointerEvent) => void;
  /** Pointer-down handler for an overlay's resize handle. */
  onResizePointerDown: (id: string, e: PointerEvent) => void;
}

let nextId = 0;

/**
 * Vue composable that manages multiple draggable/resizable image overlays
 * per spread, with automatic reflow via {@link ChapterLayout.setImages}.
 *
 * State is grouped by spread index, so images persist when the user
 * navigates away from and back to a spread.
 */
export function useMultiImageOverlay(
  layout: Ref<ChapterLayout | null>,
  spreadIdx: Ref<number>,
  options: UseMultiImageOverlayOptions = {},
): UseMultiImageOverlayReturn {
  const defW = options.defaultWidth ?? 120;
  const defH = options.defaultHeight ?? 160;
  const defX = options.defaultX ?? 80;
  const defY = options.defaultY ?? 100;
  const margin = options.margin;

  const imagesBySpread = shallowRef(new Map<number, MultiImageItem[]>());
  const activeDragCleanups = new Set<() => void>();

  onScopeDispose(() => {
    for (const cleanup of activeDragCleanups) cleanup();
    activeDragCleanups.clear();
  });

  const currentImages = computed<MultiImageItem[]>(
    () => imagesBySpread.value.get(spreadIdx.value) ?? [],
  );

  const hasImages = computed(() =>
    [...imagesBySpread.value.values()].some((list) => list.length > 0),
  );

  function syncSpread(si: number): void {
    const lo = layout.value;
    if (!lo) return;
    const items = imagesBySpread.value.get(si) ?? [];
    const images: BookImage[] = items.map((it) => ({
      x: it.rect.x,
      y: it.rect.y,
      w: it.rect.w,
      h: it.rect.h,
      margin,
    }));
    lo.setImages(si, images);
    options.onUpdate?.(lo.getSpread(si));
  }

  function notify(affectedSpread: number): void {
    triggerRef(imagesBySpread);
    syncSpread(affectedSpread);
  }

  function findById(id: string): { spread: number; index: number; item: MultiImageItem } | null {
    for (const [s, list] of imagesBySpread.value) {
      const i = list.findIndex((it) => it.id === id);
      if (i >= 0) return { spread: s, index: i, item: list[i] };
    }
    return null;
  }

  function addImage(overrides?: Partial<ImageRect>): MultiImageItem {
    const si = spreadIdx.value;
    const list = imagesBySpread.value.get(si) ?? [];
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
    imagesBySpread.value.set(si, [...list, item]);
    notify(si);
    return item;
  }

  function removeImage(id: string): void {
    const found = findById(id);
    if (!found) return;
    const next = imagesBySpread.value.get(found.spread)?.filter((it) => it.id !== id) ?? [];
    if (next.length === 0) imagesBySpread.value.delete(found.spread);
    else imagesBySpread.value.set(found.spread, next);
    notify(found.spread);
  }

  function updateImage(id: string, rect: Partial<ImageRect>): void {
    const found = findById(id);
    if (!found) return;
    const list = imagesBySpread.value.get(found.spread) ?? [];
    const next = list.map((it) => (it.id === id ? { ...it, rect: { ...it.rect, ...rect } } : it));
    imagesBySpread.value.set(found.spread, next);
    notify(found.spread);
  }

  function clearImages(target?: number): void {
    if (target == null) {
      const old = imagesBySpread.value;
      imagesBySpread.value = new Map();
      layout.value?.clearImages();
      for (const si of old.keys()) {
        const lo = layout.value;
        if (lo) options.onUpdate?.(lo.getSpread(si));
      }
    } else {
      imagesBySpread.value.delete(target);
      notify(target);
    }
  }

  function onOverlayPointerDown(id: string, e: PointerEvent): void {
    e.preventDefault();
    const found = findById(id);
    if (!found) return;
    const target = e.currentTarget as HTMLElement;
    createOverlayDragSession({
      mode: 'move',
      rect: found.item.rect,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      captureElement: target,
      activeElement: target,
      dragClass: 'is-dragging',
      registry: activeDragCleanups,
      onChange: (rect) => updateImage(id, rect),
    });
  }

  function onResizePointerDown(id: string, e: PointerEvent): void {
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
      pointerId: e.pointerId,
      captureElement: target,
      activeElement: target.parentElement,
      dragClass: 'is-dragging',
      registry: activeDragCleanups,
      onChange: (rect) => updateImage(id, rect),
    });
  }

  // Re-sync the affected spread when the underlying layout changes (e.g. after
  // a fresh layoutChapter or resize) so image exclusions are reapplied.
  watch(layout, (lo) => {
    if (!lo) return;
    for (const si of imagesBySpread.value.keys()) syncSpread(si);
  });

  return {
    imagesBySpread,
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
