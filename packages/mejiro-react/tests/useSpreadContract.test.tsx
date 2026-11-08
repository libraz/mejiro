// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { AnchorLocation, ChapterLayout, InChapterAnchor } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpread } from '../src/useSpread.js';
import { mockLayout } from './helpers/fixtures.js';

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Layout stub whose spread `s` starts with paragraph `s` on its right page
 * and whose `locateAnchor` puts paragraph `p` on page `pageOf(p)`.
 */
function anchoredLayout(pageCount: number, pageOf: (paragraphIndex: number) => number) {
  return Object.assign(mockLayout(pageCount), {
    anchorAt: vi.fn(
      (spreadIndex: number, options: { side: 'right' | 'left' }): InChapterAnchor => ({
        paragraphIndex: spreadIndex * 2 + (options.side === 'left' ? 1 : 0),
        charIndex: 0,
      }),
    ),
    locateAnchor: vi.fn((anchor: InChapterAnchor): AnchorLocation | null => {
      const pageIndex = pageOf(anchor.paragraphIndex);
      return {
        pageIndex,
        spreadIndex: Math.floor(pageIndex / 2),
        lineIndex: 0,
        side: pageIndex % 2 === 0 ? 'right' : 'left',
      };
    }),
  }) as unknown as ChapterLayout;
}

describe('useSpread navigation state', () => {
  it('reports index and count in navigation units and spreadIndex, spreadCount and pageCount in layout units', () => {
    const layout = mockLayout(7);
    const { result } = renderHook(() =>
      useSpread(layout, { turnDurationMs: 0, spreadMode: 'single' }),
    );
    act(() => result.current.goTo(3));

    expect(result.current).toMatchObject({
      index: 3,
      count: 7,
      spreadIndex: 1,
      spreadCount: 4,
      pageCount: 7,
      singleSide: 'left',
    });
    expect(result.current.indexOfPage(5)).toBe(5);
  });

  it('counts two-page spreads in double mode, which is the default', () => {
    const layout = mockLayout(7);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 0 }));
    act(() => result.current.goTo(3));

    expect(result.current).toMatchObject({
      index: 3,
      count: 4,
      spreadIndex: 3,
      spreadCount: 4,
      pageCount: 7,
      singleSide: null,
    });
  });

  it('turns over turnDurationMs and reports the new index when the turn lands', () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 50, onIndexChange }));

    act(() => result.current.goTo(2));
    act(() => {
      vi.advanceTimersByTime(49);
    });
    expect(result.current.turning).toBe(true);
    expect(result.current.index).toBe(0);
    expect(onIndexChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.turning).toBe(false);
    expect(result.current.index).toBe(2);
    expect(onIndexChange).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('lands a turn on the last goTo requested while it was in flight', () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    const layout = mockLayout(10);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 100, onIndexChange }));

    act(() => result.current.goTo(1));
    act(() => result.current.goTo(4));
    act(() => result.current.goTo(3));
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.index).toBe(3);
    expect(onIndexChange.mock.calls).toEqual([[3]]);
  });

  it('jumps without a turn when goTo is called with animate false', () => {
    const onIndexChange = vi.fn();
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 180, onIndexChange }));

    act(() => result.current.goTo(2, { animate: false }));

    expect(result.current.turning).toBe(false);
    expect(result.current.index).toBe(2);
    expect(onIndexChange).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('clamps out-of-range integers and rejects non-integer indexes', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 0 }));

    act(() => result.current.goTo(99));
    expect(result.current.index).toBe(2);
    act(() => result.current.goTo(-3));
    expect(result.current.index).toBe(0);
    act(() => result.current.goTo(-0));
    expect(Object.is(result.current.index, 0)).toBe(true);
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => result.current.goTo(bad)).toThrow(RangeError);
    }
    expect(result.current.index).toBe(0);
  });

  it('ignores goTo without a layout and keeps index 0', () => {
    const { result } = renderHook(() => useSpread(null, { turnDurationMs: 0 }));
    act(() => result.current.goTo(3));
    expect(result.current.index).toBe(0);
    expect(result.current.count).toBe(0);
  });

  it('keeps the visible text on screen across a layout replacement with preservePosition', () => {
    const first = anchoredLayout(10, (p) => p);
    // The replacement lays out every paragraph two pages later.
    const second = anchoredLayout(12, (p) => p + 2);
    const { result, rerender } = renderHook(
      ({ layout }: { layout: ChapterLayout }) =>
        useSpread(layout, { turnDurationMs: 0, preservePosition: true }),
      { initialProps: { layout: first } },
    );
    act(() => result.current.goTo(2));

    rerender({ layout: second });

    // Spread 2 of the first layout opens with paragraph 4, now on page 6.
    expect(second.locateAnchor).toHaveBeenCalledWith({ paragraphIndex: 4, charIndex: 0 });
    expect(result.current.index).toBe(3);
    expect(result.current.firstPage).toBe(6);
  });

  it('opens a replacement layout at index 0 without preservePosition', () => {
    const first = anchoredLayout(10, (p) => p);
    const second = anchoredLayout(12, (p) => p + 1);
    const { result, rerender } = renderHook(
      ({ layout }: { layout: ChapterLayout }) => useSpread(layout, { turnDurationMs: 0 }),
      { initialProps: { layout: first } },
    );
    act(() => result.current.goTo(2));

    rerender({ layout: second });

    expect(second.locateAnchor).not.toHaveBeenCalled();
    expect(result.current.index).toBe(0);
  });
});
