// @vitest-environment happy-dom

import type { ChapterLayout, InChapterAnchor, SpreadResult } from '@libraz/mejiro/book';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { type UseSpreadOptions, type UseSpreadReturn, useSpread } from '../src/useSpread.js';

/**
 * Layout stub of `pageCount` pages whose page `p` starts at paragraph `p`, so
 * an anchor names the page it was taken from.
 */
function pagedLayout(pageCount: number): ChapterLayout {
  const spreads = new Map<number, SpreadResult>();
  return {
    pageCount,
    getSpread: vi.fn((index: number) => {
      const cached = spreads.get(index);
      if (cached) return cached;
      const created = { spreadIndex: index, pageCount } as unknown as SpreadResult;
      spreads.set(index, created);
      return created;
    }),
    anchorAt: vi.fn(
      (spreadIndex: number, options: { side?: 'right' | 'left' } = {}): InChapterAnchor => ({
        paragraphIndex: spreadIndex * 2 + (options.side === 'left' ? 1 : 0),
        charIndex: 0,
      }),
    ),
    locateAnchor: vi.fn((anchor: InChapterAnchor) => ({
      pageIndex: anchor.paragraphIndex,
      spreadIndex: Math.floor(anchor.paragraphIndex / 2),
    })),
  } as unknown as ChapterLayout;
}

function harness(
  layout: Parameters<typeof useSpread>[0],
  options: UseSpreadOptions = {},
): UseSpreadReturn {
  let result!: UseSpreadReturn;
  mount(
    defineComponent({
      setup() {
        result = useSpread(layout, { enableKeyboard: false, ...options });
        return () => h('div');
      },
    }),
  );
  return result;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useSpread (Vue) — navigation state', () => {
  it('reports the navigation position apart from the layout spread it shows', async () => {
    const result = harness(shallowRef(pagedLayout(7)), {
      turnDurationMs: 0,
      spreadMode: 'single',
    });

    result.goTo(3);
    await nextTick();

    expect(result.index.value).toBe(3);
    expect(result.count.value).toBe(7);
    expect(result.spreadIndex.value).toBe(1);
    expect(result.spreadCount.value).toBe(4);
    expect(result.pageCount.value).toBe(7);
    expect(result.singleSide.value).toBe('left');
    expect(result.indexOfPage(5)).toBe(5);
  });

  it('counts spreads in double mode and accepts the mode as a ref', async () => {
    const mode = ref<'single' | 'double'>('double');
    const result = harness(shallowRef(pagedLayout(7)), { turnDurationMs: 0, spreadMode: mode });

    expect(result.count.value).toBe(4);
    expect(result.singleSide.value).toBeNull();
    result.goTo(2);
    await nextTick();

    mode.value = 'single';
    await nextTick();
    expect(result.index.value).toBe(4);
    expect(result.count.value).toBe(7);
  });

  it('is idle at index 0 with count 0 until a layout is ready, and goTo is a no-op', () => {
    const result = harness(shallowRef<ChapterLayout | null>(null));

    result.goTo(2);

    expect(result.index.value).toBe(0);
    expect(result.count.value).toBe(0);
    expect(result.spread.value).toBeNull();
  });

  it('follows a layout given as a getter', async () => {
    const source = shallowRef<ChapterLayout | null>(null);
    const layout = pagedLayout(4);
    const result = harness(() => source.value, { turnDurationMs: 0 });

    source.value = layout;
    await nextTick();

    expect(result.spread.value).toBe(layout.getSpread(0));
    expect(result.count.value).toBe(2);
  });
});

describe('useSpread (Vue) — goTo', () => {
  it('turns with the animation by default and jumps at once with animate: false', async () => {
    vi.useFakeTimers();
    const result = harness(shallowRef(pagedLayout(10)), { turnDurationMs: 180 });

    result.goTo(2);
    expect(result.turning.value).toBe(true);
    expect(result.index.value).toBe(0);

    result.goTo(4, { animate: false });
    expect(result.turning.value).toBe(false);
    expect(result.index.value).toBe(4);

    vi.advanceTimersByTime(180);
    await nextTick();
    expect(result.index.value).toBe(4);
  });

  it('commits the index turnDurationMs after the request and only then calls onIndexChange', async () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    const result = harness(shallowRef(pagedLayout(10)), { turnDurationMs: 100, onIndexChange });

    result.next();
    vi.advanceTimersByTime(99);
    await nextTick();
    expect(result.index.value).toBe(0);
    expect(onIndexChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await nextTick();
    expect(result.index.value).toBe(1);
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('ends on the last request made while a turn is in flight', async () => {
    vi.useFakeTimers();
    const result = harness(shallowRef(pagedLayout(10)), { turnDurationMs: 100 });

    result.goTo(1);
    result.goTo(3);
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(result.index.value).toBe(3);
    expect(result.turning.value).toBe(false);
  });

  it('clamps out-of-range indices and treats -0 as 0', async () => {
    const result = harness(shallowRef(pagedLayout(6)), { turnDurationMs: 0 });

    result.goTo(2 ** 32);
    await nextTick();
    expect(result.index.value).toBe(2);
    result.goTo(-0);
    await nextTick();
    expect(Object.is(result.index.value, 0)).toBe(true);
    result.goTo(-4);
    await nextTick();
    expect(result.index.value).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5])(
    'rejects %s with a RangeError',
    (value) => {
      const result = harness(shallowRef(pagedLayout(6)), { turnDurationMs: 0 });
      expect(() => result.goTo(value)).toThrow(RangeError);
    },
  );
});

describe('useSpread (Vue) — preservePosition', () => {
  it('keeps the text on screen when the layout is replaced', async () => {
    const source = shallowRef<ChapterLayout | null>(pagedLayout(10));
    const result = harness(source, { turnDurationMs: 0, preservePosition: true });
    result.goTo(3);
    await nextTick();

    source.value = pagedLayout(12);
    await nextTick();

    expect(result.index.value).toBe(3);
    expect(result.spreadIndex.value).toBe(3);
  });

  it('returns to the start of a replacement layout by default', async () => {
    const source = shallowRef<ChapterLayout | null>(pagedLayout(10));
    const result = harness(source, { turnDurationMs: 0 });
    result.goTo(3);
    await nextTick();

    source.value = pagedLayout(12);
    await nextTick();

    expect(result.index.value).toBe(0);
  });
});

describe('useSpread (Vue) — public types', () => {
  it('takes the renamed options and exposes the navigation state as read-only refs', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import { type GoToOptions, type ResolvedSpreadMode, useSpread } from '@libraz/mejiro-vue';
import { ref, shallowRef } from 'vue';
const layout = shallowRef<ChapterLayout | null>(null);
const mode = ref<ResolvedSpreadMode>('single');
const state = useSpread(() => layout.value, { spreadMode: mode, turnDurationMs: 0, preservePosition: true, onIndexChange: (i: number) => void i });
const animate: GoToOptions = { animate: false };
state.goTo(1, animate);
const n: number = state.index.value + state.count.value + state.spreadIndex.value + state.spreadCount.value + state.pageCount.value + state.indexOfPage(2);
void n;
state.index.value = 2;
state.turning.value = true;
useSpread(layout, { single: true });
useSpread(layout, { spreadMode: 'auto' });
useSpread(layout, { turnDuration: 100 });
useSpread(layout, { onChange: () => {} });
state.setSpread(1);
void state.spreadIdx;
void state.totalSpreads;`,
      {
        fails: [
          'state.index.value = 2',
          'state.turning.value = true',
          '{ single: true }',
          "'auto'",
          'turnDuration: 100',
          'onChange: ()',
          'state.setSpread',
          'state.spreadIdx',
          'state.totalSpreads',
        ],
      },
    );
  });
});
