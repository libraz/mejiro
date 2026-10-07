// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { BookImage, ChapterLayout } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { useMultiImageOverlay } from '../src/useMultiImageOverlay.js';

/** Layout stub recording every exclusion the hooks issue. */
function layout() {
  const issued: Array<BookImage[] | undefined> = [];
  const stub = {
    syncImages: vi.fn((_spread: number, images?: BookImage[]) => {
      issued.push(images);
      return {};
    }),
    setImages: vi.fn((_spread: number, images: BookImage[]) => {
      issued.push(images);
    }),
    getSpread: vi.fn(() => ({})),
    clearImages: vi.fn(),
  } as unknown as ChapterLayout;
  return { stub, issued };
}

function pointerDown(): ReactPointerEvent {
  const target = document.createElement('div');
  return {
    preventDefault() {},
    stopPropagation() {},
    clientX: 0,
    clientY: 0,
    currentTarget: target,
    nativeEvent: { pointerId: 1 },
  } as unknown as ReactPointerEvent;
}

function pointer(type: 'pointermove' | 'pointerup', clientX = 0): void {
  document.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX, clientY: 0 }));
}

/** Lets a coalesced drag move reach the hook. */
async function nextFrame(): Promise<void> {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

const margins = (images: Array<BookImage[] | undefined>) =>
  images.map((list) => list?.map((image) => image.margin));

describe('useImageOverlay (React) — drag session state', () => {
  it('issues the current margin from drag moves and commits after a mid-drag change', async () => {
    const { stub, issued } = layout();
    const { result, rerender } = renderHook(
      ({ margin }: { margin: number }) => useImageOverlay(stub, 0, vi.fn(), { margin }),
      { initialProps: { margin: 8 } },
    );
    act(() => result.current.toggleImage());
    act(() => result.current.onOverlayPointerDown(pointerDown()));
    rerender({ margin: 20 });
    issued.length = 0;

    act(() => pointer('pointermove', 10));
    await nextFrame();
    act(() => {
      pointer('pointermove', 20);
      pointer('pointerup', 20);
    });

    expect(margins(issued)).toEqual([[20], [20]]);
    expect(result.current.imageRect?.x).toBe(100);
  });

  it('issues no exclusion once the overlay is toggled off mid-drag', async () => {
    const { stub, issued } = layout();
    const { result } = renderHook(() => useImageOverlay(stub, 0, vi.fn()));
    act(() => result.current.toggleImage());
    act(() => result.current.onOverlayPointerDown(pointerDown()));
    act(() => result.current.toggleImage());
    issued.length = 0;

    act(() => pointer('pointermove', 10));
    await nextFrame();
    act(() => pointer('pointerup', 10));

    expect(issued).toEqual([]);
    expect(result.current.imageRect).toBeNull();
    expect(result.current.hasImage).toBe(false);
  });
});

describe('useMultiImageOverlay (React) — drag session state', () => {
  it('issues the current margin from drag moves and commits after a mid-drag change', async () => {
    const { stub, issued } = layout();
    const { result, rerender } = renderHook(
      ({ margin }: { margin: number }) => useMultiImageOverlay(stub, 0, { margin }),
      { initialProps: { margin: 8 } },
    );
    let id = '';
    act(() => {
      id = result.current.addImage().id;
    });
    act(() => result.current.onOverlayPointerDown(id, pointerDown()));
    rerender({ margin: 20 });
    issued.length = 0;

    act(() => pointer('pointermove', 10));
    await nextFrame();
    act(() => {
      pointer('pointermove', 20);
      pointer('pointerup', 20);
    });

    expect(margins(issued)).toEqual([[20], [20]]);
  });

  it('issues no exclusion for an image removed mid-drag', async () => {
    const { stub, issued } = layout();
    const { result } = renderHook(() => useMultiImageOverlay(stub, 0));
    let id = '';
    act(() => {
      id = result.current.addImage().id;
    });
    act(() => result.current.onOverlayPointerDown(id, pointerDown()));
    act(() => result.current.removeImage(id));
    issued.length = 0;

    act(() => pointer('pointermove', 10));
    await nextFrame();
    act(() => pointer('pointerup', 10));

    expect(issued).toEqual([]);
    expect(result.current.hasImages).toBe(false);
  });
});
