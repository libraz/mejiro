// @vitest-environment happy-dom

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, isReactive, nextTick, ref, shallowRef } from 'vue';
import { useSpread } from '../src/useSpread.js';
import { mockLayout as sharedMockLayout, withSetup } from './helpers/fixtures.js';

/** Layout stub that hands out one stable spread object per index. */
function mockLayout(pageCount = 8): ChapterLayout {
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
    const { result } = harness(() =>
      useSpread(layout, { turnDurationMs: 0, enableKeyboard: false }),
    );
    await nextTick();

    const produced = (layout.value as ChapterLayout).getSpread(0);
    expect(result.current.spread.value).toBe(produced);
    expect(isReactive(result.current.spread.value)).toBe(false);
  });

  it('follows a spread index restored in the same tick as a layout swap', async () => {
    const onIndexChange = vi.fn();
    const first = mockLayout(8);
    const second = mockLayout(8);
    const layout = shallowRef<ChapterLayout | null>(first);
    const { result } = harness(() =>
      useSpread(layout, { turnDurationMs: 0, enableKeyboard: false, onIndexChange }),
    );
    await nextTick();

    result.current.goTo(2, { animate: false });
    await nextTick();
    expect(result.current.spread.value).toBe(first.getSpread(2));
    onIndexChange.mockClear();

    // A reflow replaces the layout (which resets the index to 0) and the host
    // restores the reading position synchronously, in the same tick.
    layout.value = second;
    result.current.goTo(2, { animate: false });
    await nextTick();

    expect(result.current.index.value).toBe(2);
    expect(second.getSpread).toHaveBeenCalledWith(2);
    expect(result.current.spread.value).toBe(second.getSpread(2));
    // The index never effectively moved, so subscribers are not notified.
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('reports a spread index that the layout swap really moved', async () => {
    const onIndexChange = vi.fn();
    const first = mockLayout(8);
    const second = mockLayout(8);
    const layout = shallowRef<ChapterLayout | null>(first);
    const { result } = harness(() =>
      useSpread(layout, { turnDurationMs: 0, enableKeyboard: false, onIndexChange }),
    );
    await nextTick();

    result.current.goTo(2, { animate: false });
    await nextTick();
    onIndexChange.mockClear();

    layout.value = second;
    await nextTick();

    expect(result.current.index.value).toBe(0);
    expect(result.current.spread.value).toBe(second.getSpread(0));
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it.each([7, 6])(
    'single mode visits every page of a %i-page chapter once, in order',
    async (n) => {
      const onIndexChange = vi.fn();
      const layout = shallowRef<ChapterLayout | null>(mockLayout(n));
      const { result } = harness(() =>
        useSpread(layout, {
          turnDurationMs: 0,
          enableKeyboard: false,
          spreadMode: 'single',
          onIndexChange,
        }),
      );
      await nextTick();
      expect(result.current.count.value).toBe(n);

      const shown: string[] = [];
      for (let i = 0; i < n + 2; i++) {
        const { index, spreadIndex, singleSide, spread } = result.current;
        shown.push(`${index.value}:${spreadIndex.value}:${singleSide.value}`);
        expect(spread.value).toBe((layout.value as ChapterLayout).getSpread(spreadIndex.value));
        result.current.next();
        await nextTick();
      }
      const expected = Array.from(
        { length: n },
        (_, p) => `${p}:${Math.floor(p / 2)}:${p % 2 === 0 ? 'right' : 'left'}`,
      );
      expect([...new Set(shown)]).toEqual(expected);
      expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual(
        Array.from({ length: n - 1 }, (_, i) => i + 1),
      );

      result.current.goTo(3);
      await nextTick();
      expect(result.current.spreadIndex.value).toBe(1);
      expect(result.current.singleSide.value).toBe('left');
    },
  );

  it('advances one position per next()/prev() call while a turn is in flight', async () => {
    vi.useFakeTimers();
    try {
      const onIndexChange = vi.fn();
      const layout = shallowRef<ChapterLayout | null>(mockLayout(10));
      const { result } = harness(() =>
        useSpread(layout, { turnDurationMs: 180, enableKeyboard: false, onIndexChange }),
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
      expect(result.current.index.value).toBe(3);
      // Each earlier target landed before the next turn started.
      expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);

      result.current.prev();
      result.current.prev();
      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.current.index.value).toBe(1);

      // Clamped at the end: extra calls past the last spread do not move further.
      for (let i = 0; i < 6; i++) result.current.next();
      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.current.index.value).toBe(4);
      expect(result.current.turning.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets to spread 0 of a replacement layout with the new page count', async () => {
    const first = mockLayout(6);
    const second = mockLayout(10);
    const layout = shallowRef<ChapterLayout | null>(first);
    const { result } = harness(() =>
      useSpread(layout, { turnDurationMs: 0, enableKeyboard: false }),
    );
    await nextTick();
    result.current.goTo(2, { animate: false });
    await nextTick();

    layout.value = second;
    await nextTick();
    expect(result.current.index.value).toBe(0);
    expect(result.current.pageCount.value).toBe(10);
    expect(result.current.count.value).toBe(5);
    expect(result.current.spread.value).toBe(second.getSpread(0));
  });

  it('keeps the visible page when single mode is toggled mid-chapter', async () => {
    const layout = shallowRef<ChapterLayout | null>(mockLayout(9));
    const single = ref<'single' | 'double'>('double');
    const { result } = harness(() =>
      useSpread(layout, { turnDurationMs: 0, enableKeyboard: false, spreadMode: single }),
    );
    await nextTick();
    result.current.goTo(2, { animate: false });
    await nextTick();
    expect(result.current.spreadIndex.value).toBe(2);

    // Double → single: the first page of the spread in reading order.
    single.value = 'single';
    await nextTick();
    expect(result.current.index.value).toBe(4);
    expect(result.current.spreadIndex.value).toBe(2);
    expect(result.current.singleSide.value).toBe('right');

    // Single on a left page → double: the spread containing that page.
    result.current.next();
    await nextTick();
    expect(result.current.singleSide.value).toBe('left');
    single.value = 'double';
    await nextTick();
    expect(result.current.index.value).toBe(2);
    expect(result.current.spreadIndex.value).toBe(2);
    expect(result.current.singleSide.value).toBeNull();
  });
});

describe('useSpread (Vue) — anchors past image-blocked pages', () => {
  // Spread 0's right page and all of spread 1 are covered by images.
  function blockedLayout(): ChapterLayout {
    return Object.assign(mockLayout(8), {
      anchorAt: vi.fn((spread: number, { side }: { side: 'right' | 'left' }) => {
        if ((spread === 0 && side === 'right') || spread === 1) return null;
        return { paragraphIndex: spread, charIndex: side === 'right' ? 0 : 5 };
      }),
    });
  }

  it('takes the anchor from the next page that holds text', () => {
    const layout = shallowRef<ChapterLayout | null>(blockedLayout());
    const { result } = harness(() => useSpread(layout, { turnDurationMs: 0 }));
    expect(result.current.anchorAt(0)).toEqual({ paragraphIndex: 0, charIndex: 5 });
    expect(result.current.anchorAt(1)).toEqual({ paragraphIndex: 2, charIndex: 0 });
    expect(result.current.anchorAt(4)).toBeNull();
  });

  it('counts pages the same way in single-page mode', () => {
    const layout = shallowRef<ChapterLayout | null>(blockedLayout());
    const { result } = harness(() =>
      useSpread(layout, { turnDurationMs: 0, spreadMode: 'single' }),
    );
    expect(result.current.anchorAt(0)).toEqual({ paragraphIndex: 0, charIndex: 5 });
    expect(result.current.anchorAt(2)).toEqual({ paragraphIndex: 2, charIndex: 0 });
  });
});

describe('useSpread (Vue)', () => {
  it('returns idle state when layout is null', () => {
    const layoutRef = ref<ChapterLayout | null>(null);
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 0 }));
    expect(result.spread.value).toBeNull();
    expect(result.pageCount.value).toBe(0);
    expect(result.count.value).toBe(0);
    unmount();
  });

  it('refreshes spread when layout becomes available', async () => {
    const layoutRef = ref<ChapterLayout | null>(null);
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 0 }));
    layoutRef.value = sharedMockLayout(6);
    await nextTick();
    expect(result.spread.value).not.toBeNull();
    expect(result.pageCount.value).toBe(6);
    expect(result.count.value).toBe(3);
    unmount();
  });

  it('exposes the spread immediately when mounted with a non-null layout', () => {
    const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 0 }));

    // No tick awaited: the composable must be usable as soon as it returns.
    const layout = layoutRef.value as ChapterLayout & { getSpread: ReturnType<typeof vi.fn> };
    expect(result.spread.value).not.toBeNull();
    expect(result.spread.value).toEqual(layout.getSpread(result.index.value));
    expect(result.pageCount.value).toBe(6);
    unmount();
  });

  it('next/prev/goTo move the spread index and call onIndexChange', async () => {
    const onIndexChange = vi.fn();
    const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
    const { result, unmount } = withSetup(() =>
      useSpread(layoutRef, { turnDurationMs: 0, onIndexChange }),
    );
    await nextTick();

    result.next();
    await nextTick();
    expect(result.index.value).toBe(1);

    result.next();
    await nextTick();
    expect(result.index.value).toBe(2);

    result.prev();
    await nextTick();
    expect(result.index.value).toBe(1);

    result.goTo(99);
    await nextTick();
    expect(result.index.value).toBe(2);

    result.goTo(-5);
    await nextTick();
    expect(result.index.value).toBe(0);

    expect(onIndexChange).toHaveBeenCalled();
    unmount();
  });

  it('moves on ArrowLeft / ArrowRight when enableKeyboard is set', async () => {
    const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
    const { result, unmount } = withSetup(() =>
      useSpread(layoutRef, { turnDurationMs: 0, enableKeyboard: true }),
    );
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.index.value).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await nextTick();
    expect(result.index.value).toBe(0);

    unmount();
  });

  it('leaves arrow keys to editable fields, modifiers and handled events', async () => {
    const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 0 }));
    await nextTick();

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    for (const el of [input, textarea, editable]) document.body.appendChild(el);
    const preventer = (e: Event) => e.preventDefault();

    try {
      for (const el of [input, textarea, editable]) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        await nextTick();
        expect(result.index.value).toBe(0);
      }

      for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', [modifier]: true }));
        await nextTick();
        expect(result.index.value).toBe(0);
      }

      document.body.addEventListener('keydown', preventer);
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
      await nextTick();
      expect(result.index.value).toBe(0);
      document.body.removeEventListener('keydown', preventer);

      // A plain arrow key on the page still turns the spread.
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      await nextTick();
      expect(result.index.value).toBe(1);
    } finally {
      document.body.removeEventListener('keydown', preventer);
      for (const el of [input, textarea, editable]) el.remove();
      unmount();
    }
  });

  it('follows enableKeyboard when it flips at runtime', async () => {
    const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
    const enableKeyboard = ref(true);
    const { result, unmount } = withSetup(() =>
      useSpread(layoutRef, { turnDurationMs: 0, enableKeyboard }),
    );
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.index.value).toBe(1);

    enableKeyboard.value = false;
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.index.value).toBe(1);

    enableKeyboard.value = true;
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.index.value).toBe(2);

    unmount();
  });

  it('refresh() re-fetches the spread at the current index', async () => {
    const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 0 }));
    await nextTick();
    const layout = layoutRef.value as ChapterLayout & { getSpread: ReturnType<typeof vi.fn> };
    const callsBefore = layout.getSpread.mock.calls.length;
    result.refresh();
    expect(layout.getSpread.mock.calls.length).toBe(callsBefore + 1);
    unmount();
  });

  it('flips `turning` true while the page-turn animation is in flight', async () => {
    vi.useFakeTimers();
    try {
      const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
      const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 180 }));
      await nextTick();
      result.next();
      // The setTimeout has not yet fired — `turning` is on.
      expect(result.turning.value).toBe(true);
      expect(result.index.value).toBe(0);

      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.turning.value).toBe(false);
      expect(result.index.value).toBe(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a pending page-turn timer when disposed without keyboard listeners', async () => {
    vi.useFakeTimers();
    try {
      const onIndexChange = vi.fn();
      const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
      const { result, unmount } = withSetup(() =>
        useSpread(layoutRef, { turnDurationMs: 180, enableKeyboard: false, onIndexChange }),
      );
      await nextTick();
      result.next();
      unmount();
      vi.advanceTimersByTime(180);
      expect(onIndexChange).not.toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('goTo without animation jumps immediately and clamps to range', async () => {
    const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 180 }));
    await nextTick();

    result.goTo(2, { animate: false });
    await nextTick();
    expect(result.index.value).toBe(2);
    expect(result.turning.value).toBe(false);

    result.goTo(99, { animate: false });
    await nextTick();
    expect(result.index.value).toBe(2); // clamped to count − 1

    result.goTo(-5, { animate: false });
    await nextTick();
    expect(result.index.value).toBe(0);
    unmount();
  });

  it('goTo without animation cancels an in-flight page-turn animation', async () => {
    vi.useFakeTimers();
    try {
      const layoutRef = ref<ChapterLayout | null>(sharedMockLayout(6));
      const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDurationMs: 180 }));
      await nextTick();
      result.goTo(2);
      expect(result.turning.value).toBe(true);

      // An immediate jump should win and clear the pending animation.
      result.goTo(1, { animate: false });
      await nextTick();
      expect(result.turning.value).toBe(false);
      expect(result.index.value).toBe(1);

      // The superseded goTo timer must not fire afterwards.
      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.index.value).toBe(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
