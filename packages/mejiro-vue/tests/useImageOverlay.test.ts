// @vitest-environment happy-dom

import type { BookImage, ChapterLayout } from '@libraz/mejiro/book';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { mockLayout, withSetup } from './helpers/fixtures.js';

/** Layout stub recording every exclusion the composable issues. */
function layout() {
  const issued: BookImage[][] = [];
  const stub = ref({
    setImages: vi.fn((_spread: number, images: BookImage[]) => {
      issued.push(images);
      return {};
    }),
    getSpread: vi.fn(() => ({})),
    clearImages: vi.fn(),
  } as unknown as ChapterLayout);
  return { stub, issued };
}

function pointerDown(): PointerEvent {
  return {
    preventDefault() {},
    stopPropagation() {},
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    currentTarget: document.createElement('div'),
  } as unknown as PointerEvent;
}

function pointer(type: 'pointermove' | 'pointerup', clientX = 0): void {
  document.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX, clientY: 0 }));
}

/** Lets a coalesced drag move reach the composable. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('useImageOverlay (Vue) — drag session state', () => {
  it('issues the configured margin from drag moves and commits', async () => {
    const { stub, issued } = layout();
    const scope = effectScope();
    const overlay = scope.run(() => useImageOverlay(stub, { spreadIndex: ref(0), margin: 20 }));
    const id = overlay?.addOverlay().id ?? '';
    overlay?.onOverlayPointerDown(id, pointerDown());
    issued.length = 0;

    pointer('pointermove', 10);
    await nextFrame();
    pointer('pointermove', 20);
    pointer('pointerup', 20);

    expect(issued.map((list) => list.map((image) => image.margin))).toEqual([[20], [20]]);
    scope.stop();
  });

  it('issues no exclusion for an overlay removed mid-drag', async () => {
    const { stub, issued } = layout();
    const scope = effectScope();
    const overlay = scope.run(() => useImageOverlay(stub, { spreadIndex: ref(0), margin: 20 }));
    const id = overlay?.addOverlay().id ?? '';
    overlay?.onOverlayPointerDown(id, pointerDown());
    overlay?.removeOverlay(id);
    issued.length = 0;

    pointer('pointermove', 10);
    await nextFrame();
    pointer('pointerup', 10);

    expect(issued).toEqual([]);
    expect(overlay?.hasOverlays.value).toBe(false);
    scope.stop();
  });
});

describe('useImageOverlay (Vue)', () => {
  it('starts empty and toggles hasOverlays once an overlay is added', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, { spreadIndex }));
    expect(result.imagesBySpread.value.size).toBe(0);
    expect(result.hasOverlays.value).toBe(false);

    const item = result.addOverlay();
    expect(result.hasOverlays.value).toBe(true);
    expect(result.currentImages.value).toHaveLength(1);
    expect(item.id).toMatch(/^mejiro-img-/);
    unmount();
  });

  it('calls layout.setImages with the per-spread overlay list after add', () => {
    const layout = mockLayout(4);
    const layoutRef = ref<ChapterLayout | null>(layout);
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, { spreadIndex }));
    result.addOverlay({ x: 1, y: 2, width: 3, height: 4 });
    expect(layout.setImages).toHaveBeenCalledWith(0, [
      expect.objectContaining({ x: 1, y: 2, width: 3, height: 4 }),
    ]);
    unmount();
  });

  it('removeOverlay removes by id and updateOverlay merges rect changes', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, { spreadIndex }));
    const a = result.addOverlay({ x: 10, y: 10, width: 50, height: 50 });
    const b = result.addOverlay({ x: 20, y: 20, width: 60, height: 60 });

    result.updateOverlay(b.id, { x: 99 });
    expect(result.currentImages.value.find((i) => i.id === b.id)?.rect.x).toBe(99);

    result.removeOverlay(a.id);
    expect(result.currentImages.value).toHaveLength(1);
    expect(result.currentImages.value[0].id).toBe(b.id);
    unmount();
  });

  it('syncs the affected spread when updating or removing an overlay on a non-current spread', () => {
    const layout = mockLayout(4);
    const layoutRef = ref<ChapterLayout | null>(layout);
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, { spreadIndex }));
    const onSpread0 = result.addOverlay({ x: 10 });
    spreadIndex.value = 1;
    const onSpread1 = result.addOverlay({ x: 20 });
    vi.mocked(layout.setImages).mockClear();

    result.updateOverlay(onSpread0.id, { x: 99 });
    expect(layout.setImages).toHaveBeenLastCalledWith(0, [expect.objectContaining({ x: 99 })]);

    result.removeOverlay(onSpread0.id);
    expect(layout.setImages).toHaveBeenLastCalledWith(0, []);
    expect(result.currentImages.value).toEqual([onSpread1]);
    unmount();
  });

  it('clearOverlays() without arg removes every overlay across spreads', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, { spreadIndex }));
    result.addOverlay();
    spreadIndex.value = 1;
    result.addOverlay();
    expect(result.imagesBySpread.value.size).toBe(2);
    result.clearOverlays();
    expect(result.imagesBySpread.value.size).toBe(0);
    expect(result.hasOverlays.value).toBe(false);
    unmount();
  });

  it('clearOverlays(spreadIndex) only removes overlays on the target spread', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, { spreadIndex }));
    result.addOverlay();
    spreadIndex.value = 1;
    result.addOverlay();
    result.clearOverlays(0);
    expect(result.imagesBySpread.value.has(0)).toBe(false);
    expect(result.imagesBySpread.value.has(1)).toBe(true);
    unmount();
  });

  it('removes active drag listeners when disposed mid-drag', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, { spreadIndex }));
    const item = result.addOverlay();
    const target = Object.assign(document.createElement('div'), { setPointerCapture: vi.fn() });

    result.onOverlayPointerDown(item.id, {
      preventDefault: vi.fn(),
      clientX: 0,
      clientY: 0,
      currentTarget: target,
      pointerId: 1,
    } as unknown as PointerEvent);
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
