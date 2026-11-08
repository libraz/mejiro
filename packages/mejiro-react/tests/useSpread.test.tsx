// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSpread } from '../src/useSpread.js';
import { mockLayout } from './helpers/fixtures.js';

describe('useSpread (React)', () => {
  it('returns idle state when layout is null', () => {
    const { result } = renderHook(() => useSpread(null, { turnDurationMs: 0 }));
    expect(result.current.spread).toBeNull();
    expect(result.current.pageCount).toBe(0);
    expect(result.current.count).toBe(0);
    expect(result.current.index).toBe(0);
  });

  it('refreshes spread when layout becomes available', () => {
    const layout = mockLayout(6);
    const { result, rerender } = renderHook(
      ({ l }: { l: ChapterLayout | null }) => useSpread(l, { turnDurationMs: 0 }),
      { initialProps: { l: null as ChapterLayout | null } },
    );
    expect(result.current.spread).toBeNull();
    rerender({ l: layout });
    expect(result.current.spread).not.toBeNull();
    expect(result.current.pageCount).toBe(6);
    expect(result.current.count).toBe(3);
    expect(result.current.spreadCount).toBe(3);
  });

  it('next/prev/goTo move the spread index and call onIndexChange', () => {
    const onIndexChange = vi.fn();
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 0, onIndexChange }));

    act(() => result.current.next());
    expect(result.current.index).toBe(1);

    act(() => result.current.next());
    expect(result.current.index).toBe(2);

    act(() => result.current.prev());
    expect(result.current.index).toBe(1);

    act(() => result.current.goTo(99));
    expect(result.current.index).toBe(2);

    act(() => result.current.goTo(-5));
    expect(result.current.index).toBe(0);

    expect(onIndexChange).toHaveBeenCalled();
  });

  it('moves on ArrowLeft / ArrowRight when enableKeyboard is set', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() =>
      useSpread(layout, { turnDurationMs: 0, enableKeyboard: true }),
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.index).toBe(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(result.current.index).toBe(0);
  });

  it('leaves arrow keys to editable fields, modifiers and handled events', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 0 }));

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    for (const el of [input, textarea, editable]) document.body.appendChild(el);
    const preventer = (e: Event) => e.preventDefault();

    try {
      for (const el of [input, textarea, editable]) {
        act(() => {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        });
        expect(result.current.index).toBe(0);
      }

      for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
        act(() => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowLeft', [modifier]: true }),
          );
        });
        expect(result.current.index).toBe(0);
      }

      document.body.addEventListener('keydown', preventer);
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
        );
      });
      expect(result.current.index).toBe(0);
      document.body.removeEventListener('keydown', preventer);

      // A plain arrow key on the page still turns the spread.
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
        );
      });
      expect(result.current.index).toBe(1);
    } finally {
      document.body.removeEventListener('keydown', preventer);
      for (const el of [input, textarea, editable]) el.remove();
    }
  });

  it('follows enableKeyboard when it flips at runtime', () => {
    const layout = mockLayout(6);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSpread(layout, { turnDurationMs: 0, enableKeyboard: enabled }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.index).toBe(1);

    rerender({ enabled: false });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.index).toBe(1);

    rerender({ enabled: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.index).toBe(2);
  });

  it('refresh() re-fetches the spread at the current index', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 0 }));
    const callsBefore = (layout.getSpread as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => result.current.refresh());
    expect((layout.getSpread as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
  });

  it('flips `turning` true while the page-turn animation is in flight', () => {
    vi.useFakeTimers();
    try {
      const layout = mockLayout(6);
      const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 180 }));
      act(() => result.current.next());
      // setTimeout has not yet fired — `turning` is on, index unchanged.
      expect(result.current.turning).toBe(true);
      expect(result.current.index).toBe(0);

      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect(result.current.turning).toBe(false);
      expect(result.current.index).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('goTo without animation jumps immediately and clamps to range', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 180 }));

    act(() => result.current.goTo(2, { animate: false }));
    expect(result.current.index).toBe(2);
    expect(result.current.turning).toBe(false);

    act(() => result.current.goTo(99, { animate: false }));
    expect(result.current.index).toBe(2); // clamped to count − 1

    act(() => result.current.goTo(-5, { animate: false }));
    expect(result.current.index).toBe(0);
  });

  it('goTo without animation cancels an in-flight page-turn animation', () => {
    vi.useFakeTimers();
    try {
      const layout = mockLayout(6);
      const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 180 }));
      act(() => result.current.goTo(2));
      expect(result.current.turning).toBe(true);

      act(() => result.current.goTo(1, { animate: false }));
      expect(result.current.turning).toBe(false);
      expect(result.current.index).toBe(1);

      // The superseded goTo timer must not fire afterwards.
      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect(result.current.index).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([7, 6])('single mode visits every page of a %i-page chapter once, in order', (n) => {
    const onIndexChange = vi.fn();
    const layout = mockLayout(n);
    const { result } = renderHook(() =>
      useSpread(layout, { turnDurationMs: 0, spreadMode: 'single', onIndexChange }),
    );
    expect(result.current.count).toBe(n);
    expect(result.current.spreadCount).toBe(Math.ceil(n / 2));

    const shown: string[] = [];
    for (let i = 0; i < n + 2; i++) {
      const { index, spreadIndex, singleSide, spread } = result.current;
      shown.push(`${index}:${spreadIndex}:${singleSide}`);
      expect((spread as unknown as { spreadIndex: number }).spreadIndex).toBe(spreadIndex);
      act(() => result.current.next());
    }
    const expected = Array.from(
      { length: n },
      (_, p) => `${p}:${Math.floor(p / 2)}:${p % 2 === 0 ? 'right' : 'left'}`,
    );
    expect([...new Set(shown)]).toEqual(expected);
    expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual(
      Array.from({ length: n - 1 }, (_, i) => i + 1),
    );

    act(() => result.current.goTo(3));
    expect(result.current.spreadIndex).toBe(1);
    expect(result.current.singleSide).toBe('left');
  });

  it('keeps the visible page when single mode is toggled mid-chapter', () => {
    const layout = mockLayout(9);
    const { result, rerender } = renderHook(
      ({ single }: { single: boolean }) =>
        useSpread(layout, { turnDurationMs: 0, spreadMode: single ? 'single' : 'double' }),
      { initialProps: { single: false } },
    );
    act(() => result.current.goTo(2, { animate: false }));
    expect(result.current.spreadIndex).toBe(2);

    // Double → single: the first page of the spread in reading order.
    rerender({ single: true });
    expect(result.current.index).toBe(4);
    expect(result.current.spreadIndex).toBe(2);
    expect(result.current.singleSide).toBe('right');

    // Single on a left page → double: the spread containing that page.
    act(() => result.current.next());
    expect(result.current.singleSide).toBe('left');
    rerender({ single: false });
    expect(result.current.index).toBe(2);
    expect(result.current.spreadIndex).toBe(2);
    expect(result.current.singleSide).toBeNull();
  });

  it('advances one position per next()/prev() call while a turn is in flight', () => {
    vi.useFakeTimers();
    try {
      const onIndexChange = vi.fn();
      const layout = mockLayout(10);
      const { result } = renderHook(() =>
        useSpread(layout, { turnDurationMs: 180, onIndexChange }),
      );

      act(() => result.current.next());
      act(() => result.current.next());
      act(() => result.current.next());
      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect(result.current.index).toBe(3);
      // The turn in flight lands once, on the last target requested.
      expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual([3]);

      act(() => result.current.prev());
      act(() => result.current.prev());
      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect(result.current.index).toBe(1);

      // Clamped at the end: extra calls past the last spread do not move further.
      for (let i = 0; i < 6; i++) act(() => result.current.next());
      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect(result.current.index).toBe(4);
      expect(result.current.turning).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets to spread 0 of a replacement layout and reports the move', () => {
    const onIndexChange = vi.fn();
    const first = mockLayout(6);
    const second = mockLayout(10);
    const { result, rerender } = renderHook(
      ({ l }: { l: ChapterLayout }) => useSpread(l, { turnDurationMs: 0, onIndexChange }),
      { initialProps: { l: first } },
    );
    act(() => result.current.goTo(2));
    onIndexChange.mockClear();

    rerender({ l: second });
    expect(result.current.index).toBe(0);
    expect(result.current.pageCount).toBe(10);
    expect(result.current.count).toBe(5);
    expect(second.getSpread).toHaveBeenLastCalledWith(0);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it('follows a spread index restored in the same commit as a layout swap', () => {
    const onIndexChange = vi.fn();
    const first = mockLayout(8);
    const second = mockLayout(8);
    const { result, rerender } = renderHook(
      ({ l, restore }: { l: ChapterLayout; restore: number | null }) => {
        const ctx = useSpread(l, { turnDurationMs: 0, onIndexChange });
        // Registered after useSpread's reset, as a reader's restore effect is.
        // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the layout object, like the reader's restore.
        useLayoutEffect(() => {
          if (restore != null) ctx.goTo(restore, { animate: false });
        }, [l]);
        return ctx;
      },
      { initialProps: { l: first, restore: null as number | null } },
    );
    act(() => result.current.goTo(2));
    onIndexChange.mockClear();

    rerender({ l: second, restore: 2 });
    expect(result.current.index).toBe(2);
    expect(second.getSpread).toHaveBeenLastCalledWith(2);
    expect((result.current.spread as unknown as { spreadIndex: number }).spreadIndex).toBe(2);
    // The index never effectively moved, so subscribers are not notified.
    expect(onIndexChange).not.toHaveBeenCalled();
  });
});

describe('useSpread (React) — anchors past image-blocked pages', () => {
  // Spread 0's right page and all of spread 1 are covered by images.
  function blockedLayout(): ChapterLayout {
    const layout = mockLayout(8);
    return Object.assign(layout, {
      anchorAt: vi.fn((spread: number, options: { side: 'right' | 'left' }) => {
        if ((spread === 0 && options.side === 'right') || spread === 1) return null;
        return { paragraphIndex: spread, charIndex: options.side === 'right' ? 0 : 5 };
      }),
    });
  }

  it('takes the anchor from the next page that holds text', () => {
    const layout = blockedLayout();
    const { result } = renderHook(() => useSpread(layout, { turnDurationMs: 0 }));
    expect(result.current.anchorAt(0)).toEqual({ paragraphIndex: 0, charIndex: 5 });
    expect(result.current.anchorAt(1)).toEqual({ paragraphIndex: 2, charIndex: 0 });
    expect(result.current.anchorAt(4)).toBeNull();
  });

  it('counts pages the same way in single-page mode', () => {
    const layout = blockedLayout();
    const { result } = renderHook(() =>
      useSpread(layout, { turnDurationMs: 0, spreadMode: 'single' }),
    );
    expect(result.current.anchorAt(0)).toEqual({ paragraphIndex: 0, charIndex: 5 });
    expect(result.current.anchorAt(2)).toEqual({ paragraphIndex: 2, charIndex: 0 });
  });
});
