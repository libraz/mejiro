// @vitest-environment happy-dom

import type { BookImage, ChapterLayout } from '@libraz/mejiro/book';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { useMultiImageOverlay } from '../src/useMultiImageOverlay.js';

/** Layout stub recording every exclusion the composables issue. */
function layout() {
  const issued: Array<BookImage[] | undefined> = [];
  const stub = ref({
    syncImages: vi.fn((_spread: number, images?: BookImage[]) => {
      issued.push(images);
      return {};
    }),
    setImages: vi.fn((_spread: number, images: BookImage[]) => {
      issued.push(images);
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
    const overlay = scope.run(() => useImageOverlay(stub, ref(0), vi.fn(), { margin: 20 }));
    overlay?.toggleImage();
    overlay?.onOverlayPointerDown(pointerDown());
    issued.length = 0;

    pointer('pointermove', 10);
    await nextFrame();
    pointer('pointermove', 20);
    pointer('pointerup', 20);

    expect(issued.map((list) => list?.map((image) => image.margin))).toEqual([[20], [20]]);
    scope.stop();
  });

  it('issues no exclusion once the overlay is toggled off mid-drag', async () => {
    const { stub, issued } = layout();
    const scope = effectScope();
    const overlay = scope.run(() => useImageOverlay(stub, ref(0), vi.fn()));
    overlay?.toggleImage();
    overlay?.onOverlayPointerDown(pointerDown());
    overlay?.toggleImage();
    issued.length = 0;

    pointer('pointermove', 10);
    await nextFrame();
    pointer('pointerup', 10);

    expect(issued).toEqual([]);
    expect(overlay?.imageRect.value).toBeNull();
    expect(overlay?.hasImage.value).toBe(false);
    scope.stop();
  });
});

describe('useMultiImageOverlay (Vue) — drag session state', () => {
  it('issues no exclusion for an image removed mid-drag', async () => {
    const { stub, issued } = layout();
    const scope = effectScope();
    const overlay = scope.run(() => useMultiImageOverlay(stub, ref(0), { margin: 20 }));
    const id = overlay?.addImage().id ?? '';
    overlay?.onOverlayPointerDown(id, pointerDown());
    overlay?.removeImage(id);
    issued.length = 0;

    pointer('pointermove', 10);
    await nextFrame();
    pointer('pointerup', 10);

    expect(issued).toEqual([]);
    expect(overlay?.hasImages.value).toBe(false);
    scope.stop();
  });
});
