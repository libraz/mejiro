// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { SpreadResult } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { mockLayout } from './helpers/fixtures.js';

describe('useImageOverlay manages overlays per spread', () => {
  it('adds, updates, removes and clears overlays and reports each reflowed spread', () => {
    const layout = mockLayout(8);
    const onReflow = vi.fn<(spread: SpreadResult) => void>();
    const { result, rerender } = renderHook(
      ({ spreadIndex }: { spreadIndex: number }) =>
        useImageOverlay(layout, { spreadIndex, onReflow }),
      { initialProps: { spreadIndex: 1 } },
    );

    let id = '';
    act(() => {
      id = result.current.addOverlay({ x: 4, y: 8, width: 40, height: 60 }).id;
    });
    expect(result.current.hasOverlays).toBe(true);
    expect(layout.setImages).toHaveBeenLastCalledWith(1, [
      { x: 4, y: 8, width: 40, height: 60, margin: undefined },
    ]);
    expect(onReflow).toHaveBeenLastCalledWith(expect.objectContaining({ spreadIndex: 1 }));

    act(() => result.current.updateOverlay(id, { width: 50 }));
    expect(result.current.currentImages[0].rect).toEqual({ x: 4, y: 8, width: 50, height: 60 });

    rerender({ spreadIndex: 2 });
    act(() => {
      result.current.addOverlay();
    });
    act(() => result.current.clearOverlays(2));
    expect([...result.current.imagesBySpread.keys()]).toEqual([1]);

    act(() => result.current.removeOverlay(id));
    expect(result.current.hasOverlays).toBe(false);
    expect(layout.setImages).toHaveBeenLastCalledWith(1, []);
    expect(onReflow).toHaveBeenLastCalledWith(expect.objectContaining({ spreadIndex: 1 }));
  });

  it('needs no onReflow', () => {
    const layout = mockLayout(4);
    const { result } = renderHook(() => useImageOverlay(layout, { spreadIndex: 0 }));
    act(() => {
      result.current.addOverlay();
    });
    act(() => result.current.clearOverlays());
    expect(result.current.hasOverlays).toBe(false);
    expect(layout.clearImages).toHaveBeenCalledTimes(1);
  });
});
