import type { ImageOverlayRect } from '@libraz/mejiro';
import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { createOverlayDragSession, isPrimaryPointerPress } from '@libraz/mejiro/browser';
import {
  type ComputedRef,
  computed,
  type MaybeRefOrGetter,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toRaw,
  toValue,
  triggerRef,
  watch,
} from 'vue';

export type { ImageOverlayRect } from '@libraz/mejiro';

/** An image overlay placed on a specific spread. */
export interface MultiImageItem {
  /** Stable ID for the overlay (assigned by {@link UseImageOverlayReturn.addOverlay}). */
  id: string;
  /** Position and size in pixels, relative to the right page's top-left corner. */
  rect: ImageOverlayRect;
}

/** Options for {@link useImageOverlay}. */
export interface UseImageOverlayOptions {
  /** Spread the overlays added next belong to; usually `useSpread().spreadIndex`. */
  spreadIndex: MaybeRefOrGetter<number>;
  /** Default overlay width in pixels. @defaultValue 120 */
  defaultWidth?: number;
  /** Default overlay height in pixels. @defaultValue 160 */
  defaultHeight?: number;
  /** Default x position. @defaultValue 80 */
  defaultX?: number;
  /** Default y position. @defaultValue 100 */
  defaultY?: number;
  /** Margin around each overlay, in pixels. Defaults to the book's font size. */
  margin?: number;
  /**
   * Called with each spread the layout reflowed after its overlays changed or a
   * replacement layout took them over. Pair it with `useSpread().refresh()` so
   * the spread on screen follows. @defaultValue a no-op
   */
  onReflow?: (spread: SpreadResult) => void;
}

/** Return value of {@link useImageOverlay}. */
export interface UseImageOverlayReturn {
  /**
   * Overlays keyed by spread index. Triggered whenever the overlays change, and
   * a replacement layout has them as soon as it is assigned, so this map and
   * the layout together key anything derived from the layout.
   */
  imagesBySpread: Readonly<Ref<ReadonlyMap<number, readonly MultiImageItem[]>>>;
  /** Overlays on the spread at `spreadIndex`; a new array whenever `imagesBySpread` triggers. */
  currentImages: ComputedRef<readonly MultiImageItem[]>;
  /** Whether any spread holds an overlay. */
  hasOverlays: ComputedRef<boolean>;
  /** Add an overlay on the spread at `spreadIndex` and return it. */
  addOverlay: (overrides?: Partial<ImageOverlayRect>) => MultiImageItem;
  /** Remove the overlay with the given ID (no-op if missing). */
  removeOverlay: (id: string) => void;
  /** Merge `rect` into the overlay's rectangle (no-op if missing). */
  updateOverlay: (id: string, rect: Partial<ImageOverlayRect>) => void;
  /** Remove every overlay, or only those on `spreadIndex` when it is given. */
  clearOverlays: (spreadIndex?: number) => void;
  /** Pointer-down handler for an overlay body (starts a move). */
  onOverlayPointerDown: (id: string, e: PointerEvent) => void;
  /** Pointer-down handler for an overlay's resize handle. */
  onResizePointerDown: (id: string, e: PointerEvent) => void;
}

let nextId = 0;

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
 * Vue composable that manages draggable, resizable image overlays per spread,
 * reflowing the text around them via {@link ChapterLayout.setImages}.
 *
 * Overlays are grouped by spread index, so they persist when the reader moves
 * away from a spread and back. Options other than `spreadIndex` are read once,
 * when the composable is called.
 *
 * @param layout - The chapter layout the overlays exclude text from, or `null`.
 * @param options - The current spread, overlay defaults and the reflow callback.
 *
 * @example
 * ```ts
 * const spreadCtx = useSpread(layout);
 * const overlays = useImageOverlay(layout, {
 *   spreadIndex: spreadCtx.spreadIndex,
 *   onReflow: () => spreadCtx.refresh(),
 * });
 * overlays.addOverlay();
 * ```
 */
export function useImageOverlay(
  layout: MaybeRefOrGetter<ChapterLayout | null>,
  options: UseImageOverlayOptions,
): UseImageOverlayReturn {
  const defW = options.defaultWidth ?? 120;
  const defH = options.defaultHeight ?? 160;
  const defX = options.defaultX ?? 80;
  const defY = options.defaultY ?? 100;
  const margin = options.margin;
  const currentLayout = (): ChapterLayout | null => toRaw(toValue(layout));
  const currentSpread = (): number => toValue(options.spreadIndex);

  const imagesBySpread = shallowRef(new Map<number, readonly MultiImageItem[]>());
  const activeDragCleanups = new Set<() => void>();

  onScopeDispose(() => {
    for (const cleanup of activeDragCleanups) cleanup();
    activeDragCleanups.clear();
  });

  // A fresh array per trigger, so it changes whenever any spread's exclusions do.
  const currentImages = computed<readonly MultiImageItem[]>(() => [
    ...(imagesBySpread.value.get(currentSpread()) ?? []),
  ]);

  const hasOverlays = computed(() =>
    [...imagesBySpread.value.values()].some((list) => list.length > 0),
  );

  function syncSpreads(spreads: readonly number[]): void {
    const lo = currentLayout();
    if (!lo) return;
    for (const si of spreads) {
      const items = imagesBySpread.value.get(si) ?? [];
      const images: BookImage[] = items.map(({ rect }) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        margin,
      }));
      const spread = lo.setImages(si, images);
      options.onReflow?.(spread);
    }
  }

  function notify(affectedSpread: number): void {
    triggerRef(imagesBySpread);
    syncSpreads([affectedSpread]);
  }

  function findById(id: string): { spread: number; item: MultiImageItem } | null {
    for (const [s, list] of imagesBySpread.value) {
      const item = list.find((it) => it.id === id);
      if (item) return { spread: s, item };
    }
    return null;
  }

  function addOverlay(overrides?: Partial<ImageOverlayRect>): MultiImageItem {
    const si = currentSpread();
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
        width: overrides?.width ?? defW,
        height: overrides?.height ?? defH,
      },
    };
    imagesBySpread.value.set(si, [...list, item]);
    notify(si);
    return item;
  }

  function removeOverlay(id: string): void {
    const found = findById(id);
    if (!found) return;
    const next = imagesBySpread.value.get(found.spread)?.filter((it) => it.id !== id) ?? [];
    if (next.length === 0) imagesBySpread.value.delete(found.spread);
    else imagesBySpread.value.set(found.spread, next);
    notify(found.spread);
  }

  function updateOverlay(id: string, rect: Partial<ImageOverlayRect>): void {
    const found = findById(id);
    if (!found) return;
    const list = imagesBySpread.value.get(found.spread) ?? [];
    const next = list.map((it) => (it.id === id ? { ...it, rect: { ...it.rect, ...rect } } : it));
    imagesBySpread.value.set(found.spread, next);
    notify(found.spread);
  }

  function clearOverlays(target?: number): void {
    if (target == null) {
      const old = imagesBySpread.value;
      imagesBySpread.value = new Map();
      const lo = currentLayout();
      if (!lo) return;
      lo.clearImages();
      for (const si of old.keys()) options.onReflow?.(lo.getSpread(si));
    } else {
      imagesBySpread.value.delete(target);
      notify(target);
    }
  }

  function startDrag(mode: 'move' | 'resize', id: string, e: PointerEvent): void {
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
      pointerId: e.pointerId,
      captureElement: target,
      activeElement: mode === 'move' ? target : target.parentElement,
      dragClass: 'is-dragging',
      registry: activeDragCleanups,
      onRectChange: (rect) => updateOverlay(id, rect),
    });
  }

  // A replacement layout gets the overlays as soon as it is assigned, so every
  // view derived from it already reflows around them.
  watch(
    currentLayout,
    (lo) => {
      if (!lo || imagesBySpread.value.size === 0) return;
      syncSpreads([...imagesBySpread.value.keys()]);
    },
    { flush: 'sync' },
  );

  return {
    imagesBySpread: shallowReadonly(imagesBySpread),
    currentImages,
    hasOverlays,
    addOverlay,
    removeOverlay,
    updateOverlay,
    clearOverlays,
    onOverlayPointerDown: (id, e) => startDrag('move', id, e),
    onResizePointerDown: (id, e) => startDrag('resize', id, e),
  };
}
