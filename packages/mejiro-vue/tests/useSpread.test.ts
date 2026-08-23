// @vitest-environment happy-dom

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, isReactive, nextTick, shallowRef } from 'vue';
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
});
