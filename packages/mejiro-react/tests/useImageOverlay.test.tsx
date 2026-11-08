// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { BookImage, ChapterLayout } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { mockLayout } from './helpers/fixtures.js';

/** Layout stub recording every exclusion the hook issues. */
function layout() {
  const issued: BookImage[][] = [];
  const stub = {
    setImages: vi.fn((_spread: number, images: BookImage[]) => {
      issued.push(images);
      return {};
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

const margins = (images: BookImage[][]) => images.map((list) => list.map((image) => image.margin));

describe('useImageOverlay (React) — drag session state', () => {
  it('issues the current margin from drag moves and commits after a mid-drag change', async () => {
    const { stub, issued } = layout();
    const { result, rerender } = renderHook(
      ({ margin }: { margin: number }) => useImageOverlay(stub, { spreadIndex: 0, margin }),
      { initialProps: { margin: 8 } },
    );
    let id = '';
    act(() => {
      id = result.current.addOverlay().id;
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
    expect(result.current.currentImages[0].rect.x).toBe(100);
  });

  it('issues no exclusion for an overlay removed mid-drag', async () => {
    const { stub, issued } = layout();
    const { result } = renderHook(() => useImageOverlay(stub, { spreadIndex: 0 }));
    let id = '';
    act(() => {
      id = result.current.addOverlay().id;
    });
    act(() => result.current.onOverlayPointerDown(id, pointerDown()));
    act(() => result.current.removeOverlay(id));
    issued.length = 0;

    act(() => pointer('pointermove', 10));
    await nextFrame();
    act(() => pointer('pointerup', 10));

    expect(issued).toEqual([]);
    expect(result.current.hasOverlays).toBe(false);
  });
});

describe('useImageOverlay (React)', () => {
  it('starts empty and reports hasOverlays once an overlay is added', () => {
    const layout = mockLayout(4);
    const { result } = renderHook(() => useImageOverlay(layout, { spreadIndex: 0 }));
    expect(result.current.imagesBySpread.size).toBe(0);
    expect(result.current.hasOverlays).toBe(false);

    let added: { id: string } | undefined;
    act(() => {
      added = result.current.addOverlay();
    });
    expect(result.current.hasOverlays).toBe(true);
    expect(result.current.currentImages).toHaveLength(1);
    expect(added?.id).toMatch(/^mejiro-img-/);
  });

  it('calls layout.setImages with the per-spread image list after add', () => {
    const layout = mockLayout(4);
    const { result } = renderHook(() => useImageOverlay(layout, { spreadIndex: 0 }));
    act(() => {
      result.current.addOverlay({ x: 1, y: 2, width: 3, height: 4 });
    });
    expect(layout.setImages).toHaveBeenCalledWith(0, [
      expect.objectContaining({ x: 1, y: 2, width: 3, height: 4 }),
    ]);
  });

  it('removeOverlay removes by id and updateOverlay merges rect changes', () => {
    const layout = mockLayout(4);
    const { result } = renderHook(() => useImageOverlay(layout, { spreadIndex: 0 }));
    let a: { id: string } | undefined;
    let b: { id: string } | undefined;
    act(() => {
      a = result.current.addOverlay({ x: 10, y: 10, width: 50, height: 50 });
    });
    act(() => {
      b = result.current.addOverlay({ x: 20, y: 20, width: 60, height: 60 });
    });

    act(() => result.current.updateOverlay(b?.id ?? '', { x: 99 }));
    expect(result.current.currentImages.find((i) => i.id === b?.id)?.rect.x).toBe(99);

    act(() => result.current.removeOverlay(a?.id ?? ''));
    expect(result.current.currentImages).toHaveLength(1);
    expect(result.current.currentImages[0].id).toBe(b?.id);
  });

  it('clearOverlays() without an argument removes every overlay across spreads', () => {
    const layout = mockLayout(4);
    const { result, rerender } = renderHook(
      ({ s }: { s: number }) => useImageOverlay(layout, { spreadIndex: s }),
      { initialProps: { s: 0 } },
    );
    act(() => {
      result.current.addOverlay();
    });
    rerender({ s: 1 });
    act(() => {
      result.current.addOverlay();
    });
    expect(result.current.imagesBySpread.size).toBe(2);
    act(() => result.current.clearOverlays());
    expect(result.current.imagesBySpread.size).toBe(0);
    expect(result.current.hasOverlays).toBe(false);
  });

  it('clearOverlays(spreadIndex) only removes overlays on that spread', () => {
    const layout = mockLayout(4);
    const { result, rerender } = renderHook(
      ({ s }: { s: number }) => useImageOverlay(layout, { spreadIndex: s }),
      { initialProps: { s: 0 } },
    );
    act(() => {
      result.current.addOverlay();
    });
    rerender({ s: 1 });
    act(() => {
      result.current.addOverlay();
    });
    act(() => result.current.clearOverlays(0));
    expect(result.current.imagesBySpread.has(0)).toBe(false);
    expect(result.current.imagesBySpread.has(1)).toBe(true);
  });

  it('removes active drag listeners when unmounted mid-drag', () => {
    const layout = mockLayout(4);
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useImageOverlay(layout, { spreadIndex: 0 }));
    let item: { id: string } | undefined;
    act(() => {
      item = result.current.addOverlay();
    });
    const target = Object.assign(document.createElement('div'), { setPointerCapture: vi.fn() });

    act(() => {
      result.current.onOverlayPointerDown(item?.id ?? '', {
        preventDefault: vi.fn(),
        clientX: 0,
        clientY: 0,
        currentTarget: target,
        nativeEvent: { pointerId: 1 },
      } as never);
    });
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
