// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import { useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { mockLayout } from './helpers/fixtures.js';

describe('image overlays (React) — sync and gestures', () => {
  it('syncs the affected spread when updating or removing an image on a non-current spread', () => {
    const layout = mockLayout(4);
    const { result, rerender } = renderHook(
      ({ s }: { s: number }) => useImageOverlay(layout, { spreadIndex: s }),
      { initialProps: { s: 0 } },
    );
    let onSpread0: { id: string } | undefined;
    let onSpread1: { id: string } | undefined;
    act(() => {
      onSpread0 = result.current.addOverlay({ x: 10 });
    });
    rerender({ s: 1 });
    act(() => {
      onSpread1 = result.current.addOverlay({ x: 20 });
    });
    vi.mocked(layout.setImages).mockClear();

    act(() => result.current.updateOverlay(onSpread0?.id ?? '', { x: 99 }));
    expect(layout.setImages).toHaveBeenLastCalledWith(0, [expect.objectContaining({ x: 99 })]);

    act(() => result.current.removeOverlay(onSpread0?.id ?? ''));
    expect(layout.setImages).toHaveBeenLastCalledWith(0, []);
    expect(result.current.currentImages).toEqual([onSpread1]);
  });

  it('gives a replacement layout its images before views derived from it render', () => {
    const first = mockLayout(4);
    const second = mockLayout(4);
    const { result, rerender } = renderHook(
      ({ layout }: { layout: ChapterLayout }) => {
        const overlay = useImageOverlay(layout, { spreadIndex: 0 });
        // A view keyed on the layout and the images, as the readers derive theirs.
        // biome-ignore lint/correctness/useExhaustiveDependencies: keyed like the readers' views.
        const appliedWhenDerived = useMemo(
          () => vi.mocked(layout.setImages).mock.calls.length,
          [layout, overlay.currentImages],
        );
        return { overlay, appliedWhenDerived };
      },
      { initialProps: { layout: first } },
    );
    act(() => {
      result.current.overlay.addOverlay();
    });

    rerender({ layout: second });
    expect(second.setImages).toHaveBeenCalledWith(0, [expect.objectContaining({ x: 80 })]);
    expect(result.current.appliedWhenDerived).toBe(1);
  });

  it('survives a host that hands over a new layout object on every render', () => {
    const { result } = renderHook(() => useImageOverlay(mockLayout(4), { spreadIndex: 0 }));
    act(() => {
      result.current.addOverlay();
    });
    expect(result.current.currentImages).toHaveLength(1);
  });

  it('keys the image state on the margin the images are applied with', () => {
    const layout = mockLayout(4);
    const { result, rerender } = renderHook(
      ({ margin }: { margin: number }) => useImageOverlay(layout, { spreadIndex: 0, margin }),
      { initialProps: { margin: 4 } },
    );
    act(() => {
      result.current.addOverlay();
    });
    const before = result.current.currentImages;

    rerender({ margin: 12 });
    expect(layout.setImages).toHaveBeenLastCalledWith(0, [expect.objectContaining({ margin: 12 })]);
    expect(result.current.currentImages).not.toBe(before);
  });

  it.each(['overlay', 'resize'] as const)(
    'starts no %s drag from a secondary or auxiliary mouse button',
    (handle) => {
      const layout = mockLayout(4);
      const multi = renderHook(() => useImageOverlay(layout, { spreadIndex: 0 }));
      let id = '';
      act(() => {
        id = multi.result.current.addOverlay().id;
      });
      const addSpy = vi.spyOn(document, 'addEventListener');
      try {
        for (const button of [1, 2]) {
          const target = Object.assign(document.createElement('div'), {
            setPointerCapture: vi.fn(),
          });
          const event = {
            pointerType: 'mouse',
            button,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clientX: 0,
            clientY: 0,
            currentTarget: target,
            nativeEvent: { pointerId: 1 },
          } as never;
          act(() => {
            if (handle === 'overlay') multi.result.current.onOverlayPointerDown(id, event);
            else multi.result.current.onResizePointerDown(id, event);
          });
          expect(target.setPointerCapture).not.toHaveBeenCalled();
        }
        expect(addSpy).not.toHaveBeenCalledWith('pointermove', expect.any(Function));
      } finally {
        addSpy.mockRestore();
        multi.unmount();
      }
    },
  );
});
