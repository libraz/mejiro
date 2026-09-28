// @vitest-environment happy-dom
/** @jsxImportSource react */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChapterLayout } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { useMultiImageOverlay } from '../src/useMultiImageOverlay.js';

const css = readFileSync(
  resolve(import.meta.dirname, '../../mejiro/src/render/mejiro-reader.css'),
  'utf8',
);

function layout(): ChapterLayout {
  return {
    syncImages: vi.fn(() => ({})),
    setImages: vi.fn(() => ({})),
    clearImages: vi.fn(() => ({})),
  } as unknown as ChapterLayout;
}

function pointerDown(target: HTMLElement): ReactPointerEvent {
  return {
    preventDefault() {},
    stopPropagation() {},
    clientX: 0,
    clientY: 0,
    currentTarget: target,
    nativeEvent: { pointerId: 1 },
  } as unknown as ReactPointerEvent;
}

/** Releases the pointer that {@link pointerDown} started the gesture with. */
function pointerUp(): void {
  document.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 }));
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

describe('overlay hooks (React) — drag feedback class', () => {
  it('useImageOverlay marks move and resize drags with the stylesheet drag class', () => {
    const { result } = renderHook(() => useImageOverlay(layout(), 0, vi.fn()));
    act(() => result.current.toggleImage());
    const { overlay, handle } = overlayElements();

    act(() => result.current.onOverlayPointerDown(pointerDown(overlay)));
    const moveClass = dragClassOf(overlay);
    pointerUp();
    expect(overlay.classList.contains(moveClass)).toBe(false);

    act(() => result.current.onResizePointerDown(pointerDown(handle)));
    expect(dragClassOf(overlay)).toBe(moveClass);
    pointerUp();
  });

  it('uses the same class as useMultiImageOverlay', () => {
    const single = renderHook(() => useImageOverlay(layout(), 0, vi.fn()));
    act(() => single.result.current.toggleImage());
    const a = overlayElements().overlay;
    act(() => single.result.current.onOverlayPointerDown(pointerDown(a)));

    const multi = renderHook(() => useMultiImageOverlay(layout(), 0));
    let id = '';
    act(() => {
      id = multi.result.current.addImage().id;
    });
    const b = overlayElements().overlay;
    act(() => multi.result.current.onOverlayPointerDown(id, pointerDown(b)));

    expect(dragClassOf(a)).toBe(dragClassOf(b));
    pointerUp();
  });
});
