// @vitest-environment happy-dom

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, isReactive, nextTick, ref, shallowRef } from 'vue';
import { useSpread } from '../src/useSpread.js';

/** Layout stub that hands out one stable spread object per index. */
function mockLayout(totalPages = 8): ChapterLayout {
  const spreads = new Map<number, SpreadResult>();
  return {
    totalPages,
    getSpread: vi.fn((index: number) => {
      const cached = spreads.get(index);
      if (cached) return cached;
      const created = {
        spreadIdx: index,
        totalPages,
        totalSpreads: Math.ceil(totalPages / 2),
      } as unknown as SpreadResult;
      spreads.set(index, created);
      return created;
    }),
  } as unknown as ChapterLayout;
}

function harness<T>(setup: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  const TestComponent = defineComponent({
    setup() {
      result.current = setup();
      return () => h('div');
    },
  });
  mount(TestComponent);
  return { result };
}

describe('useSpread (Vue)', () => {
  it('exposes the spread result as the layout produced it, without a reactive proxy', async () => {
    const layout = shallowRef<ChapterLayout | null>(mockLayout(8));
    const { result } = harness(() => useSpread(layout, { turnDuration: 0, enableKeyboard: false }));
    await nextTick();

    const produced = (layout.value as ChapterLayout).getSpread(0);
    expect(result.current.spread.value).toBe(produced);
    expect(isReactive(result.current.spread.value)).toBe(false);
  });

  it('follows a spread index restored in the same tick as a layout swap', async () => {
    const onChange = vi.fn();
    const first = mockLayout(8);
    const second = mockLayout(8);
    const layout = shallowRef<ChapterLayout | null>(first);
    const { result } = harness(() =>
      useSpread(layout, { turnDuration: 0, enableKeyboard: false, onChange }),
    );
    await nextTick();

    result.current.setSpread(2);
    await nextTick();
    expect(result.current.spread.value).toBe(first.getSpread(2));
    onChange.mockClear();

    // A reflow replaces the layout (which resets the index to 0) and the host
    // restores the reading position synchronously, in the same tick.
    layout.value = second;
    result.current.setSpread(2);
    await nextTick();

    expect(result.current.spreadIdx.value).toBe(2);
    expect(second.getSpread).toHaveBeenCalledWith(2);
    expect(result.current.spread.value).toBe(second.getSpread(2));
    // The index never effectively moved, so subscribers are not notified.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a spread index that the layout swap really moved', async () => {
    const onChange = vi.fn();
    const first = mockLayout(8);
    const second = mockLayout(8);
    const layout = shallowRef<ChapterLayout | null>(first);
    const { result } = harness(() =>
      useSpread(layout, { turnDuration: 0, enableKeyboard: false, onChange }),
    );
    await nextTick();

    result.current.setSpread(2);
    await nextTick();
    onChange.mockClear();

    layout.value = second;
    await nextTick();

    expect(result.current.spreadIdx.value).toBe(0);
    expect(result.current.spread.value).toBe(second.getSpread(0));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it.each([7, 6])(
    'single mode visits every page of a %i-page chapter once, in order',
    async (n) => {
      const onChange = vi.fn();
      const layout = shallowRef<ChapterLayout | null>(mockLayout(n));
      const { result } = harness(() =>
        useSpread(layout, { turnDuration: 0, enableKeyboard: false, single: true, onChange }),
      );
      await nextTick();
      expect(result.current.totalSpreads.value).toBe(n);

      const shown: string[] = [];
      for (let i = 0; i < n + 2; i++) {
        const { spreadIdx, layoutSpreadIdx, singleSide, spread } = result.current;
        shown.push(`${spreadIdx.value}:${layoutSpreadIdx.value}:${singleSide.value}`);
        expect(spread.value).toBe((layout.value as ChapterLayout).getSpread(layoutSpreadIdx.value));
        result.current.next();
        await nextTick();
      }
      const expected = Array.from(
        { length: n },
        (_, p) => `${p}:${Math.floor(p / 2)}:${p % 2 === 0 ? 'right' : 'left'}`,
      );
      expect([...new Set(shown)]).toEqual(expected);
      expect(onChange.mock.calls.map((c) => c[0])).toEqual(
        Array.from({ length: n - 1 }, (_, i) => i + 1),
      );

      result.current.goTo(3);
      await nextTick();
      expect(result.current.layoutSpreadIdx.value).toBe(1);
      expect(result.current.singleSide.value).toBe('left');
    },
  );

  it('advances one position per next()/prev() call while a turn is in flight', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const layout = shallowRef<ChapterLayout | null>(mockLayout(10));
      const { result } = harness(() =>
        useSpread(layout, { turnDuration: 180, enableKeyboard: false, onChange }),
      );
      await nextTick();

      result.current.next();
      await nextTick();
      result.current.next();
      await nextTick();
      result.current.next();
      await nextTick();
      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.current.spreadIdx.value).toBe(3);
      // Each earlier target landed before the next turn started.
      expect(onChange.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);

      result.current.prev();
      result.current.prev();
      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.current.spreadIdx.value).toBe(1);

      // Clamped at the end: extra calls past the last spread do not move further.
      for (let i = 0; i < 6; i++) result.current.next();
      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.current.spreadIdx.value).toBe(4);
      expect(result.current.turning.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets to spread 0 of a replacement layout with the new page count', async () => {
    const first = mockLayout(6);
    const second = mockLayout(10);
    const layout = shallowRef<ChapterLayout | null>(first);
    const { result } = harness(() => useSpread(layout, { turnDuration: 0, enableKeyboard: false }));
    await nextTick();
    result.current.setSpread(2);
    await nextTick();

    layout.value = second;
    await nextTick();
    expect(result.current.spreadIdx.value).toBe(0);
    expect(result.current.totalPages.value).toBe(10);
    expect(result.current.totalSpreads.value).toBe(5);
    expect(result.current.spread.value).toBe(second.getSpread(0));
  });

  it('keeps the visible page when single mode is toggled mid-chapter', async () => {
    const layout = shallowRef<ChapterLayout | null>(mockLayout(9));
    const single = ref(false);
    const { result } = harness(() =>
      useSpread(layout, { turnDuration: 0, enableKeyboard: false, single }),
    );
    await nextTick();
    result.current.setSpread(2);
    await nextTick();
    expect(result.current.layoutSpreadIdx.value).toBe(2);

    // Double → single: the first page of the spread in reading order.
    single.value = true;
    await nextTick();
    expect(result.current.spreadIdx.value).toBe(4);
    expect(result.current.layoutSpreadIdx.value).toBe(2);
    expect(result.current.singleSide.value).toBe('right');

    // Single on a left page → double: the spread containing that page.
    result.current.next();
    await nextTick();
    expect(result.current.singleSide.value).toBe('left');
    single.value = false;
    await nextTick();
    expect(result.current.spreadIdx.value).toBe(2);
    expect(result.current.layoutSpreadIdx.value).toBe(2);
    expect(result.current.singleSide.value).toBeNull();
  });
});

describe('useSpread (Vue) — anchors past image-blocked pages', () => {
  // Spread 0's right page and all of spread 1 are covered by images.
  function blockedLayout(): ChapterLayout {
    return Object.assign(mockLayout(8), {
      anchorAt: vi.fn((spread: number, side: 'right' | 'left') => {
        if ((spread === 0 && side === 'right') || spread === 1) return null;
        return { paragraph: spread, charIndex: side === 'right' ? 0 : 5 };
      }),
    });
  }

  it('takes the anchor from the next page that holds text', () => {
    const layout = shallowRef<ChapterLayout | null>(blockedLayout());
    const { result } = harness(() => useSpread(layout, { turnDuration: 0 }));
    expect(result.current.anchorAt(0)).toEqual({ paragraph: 0, charIndex: 5 });
    expect(result.current.anchorAt(1)).toEqual({ paragraph: 2, charIndex: 0 });
    expect(result.current.anchorAt(4)).toBeNull();
  });

  it('counts pages the same way in single-page mode', () => {
    const layout = shallowRef<ChapterLayout | null>(blockedLayout());
    const { result } = harness(() => useSpread(layout, { turnDuration: 0, single: true }));
    expect(result.current.anchorAt(0)).toEqual({ paragraph: 0, charIndex: 5 });
    expect(result.current.anchorAt(2)).toEqual({ paragraph: 2, charIndex: 0 });
  });
});
