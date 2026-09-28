// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChapterLayout } from '@libraz/mejiro/book';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { useMultiImageOverlay } from '../src/useMultiImageOverlay.js';

const css = readFileSync(
  resolve(import.meta.dirname, '../../mejiro/src/render/mejiro-reader.css'),
  'utf8',
);

function layout() {
  return ref({
    syncImages: vi.fn(() => ({})),
    setImages: vi.fn(() => ({})),
    clearImages: vi.fn(() => ({})),
  } as unknown as ChapterLayout);
}

function pointerDown(target: HTMLElement): PointerEvent {
  return {
    preventDefault() {},
    stopPropagation() {},
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    currentTarget: target,
  } as unknown as PointerEvent;
}

/** The class the drag session put on the overlay, checked against the shipped stylesheet. */
function dragClassOf(el: HTMLElement): string {
  const added = [...el.classList].filter((name) => name !== 'mejiro-reader-image-overlay');
  expect(added).toHaveLength(1);
  expect(css).toContain(`.mejiro-reader-image-overlay.${added[0]}`);
  return added[0];
}

function overlayElements(): { overlay: HTMLElement; handle: HTMLElement } {
  const overlay = document.createElement('div');
  overlay.className = 'mejiro-reader-image-overlay';
  const handle = document.createElement('div');
  overlay.append(handle);
  return { overlay, handle };
}

describe('overlay composables (Vue) — drag feedback class', () => {
  it('useImageOverlay marks move and resize drags with the stylesheet drag class', () => {
    const scope = effectScope();
    const result = scope.run(() => useImageOverlay(layout(), ref(0), vi.fn()));
    if (!result) throw new Error('setup failed');
    result.toggleImage();
    const { overlay, handle } = overlayElements();

    result.onOverlayPointerDown(pointerDown(overlay));
    const moveClass = dragClassOf(overlay);
    document.dispatchEvent(new Event('pointerup'));
    expect(overlay.classList.contains(moveClass)).toBe(false);

    result.onResizePointerDown(pointerDown(handle));
    expect(dragClassOf(overlay)).toBe(moveClass);
    document.dispatchEvent(new Event('pointerup'));
    scope.stop();
  });

  it('uses the same class as useMultiImageOverlay', () => {
    const scope = effectScope();
    const [single, multi] = scope.run(() => [
      useImageOverlay(layout(), ref(0), vi.fn()),
      useMultiImageOverlay(layout(), ref(0)),
    ]) as [ReturnType<typeof useImageOverlay>, ReturnType<typeof useMultiImageOverlay>];
    single.toggleImage();
    const a = overlayElements().overlay;
    single.onOverlayPointerDown(pointerDown(a));
    const { id } = multi.addImage();
    const b = overlayElements().overlay;
    multi.onOverlayPointerDown(id, pointerDown(b));

    expect(dragClassOf(a)).toBe(dragClassOf(b));
    document.dispatchEvent(new Event('pointerup'));
    scope.stop();
  });
});
