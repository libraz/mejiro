// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, MejiroBook, SpreadResult } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, render, renderHook } from '@testing-library/react';
import { type ReactNode, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';
import { useSpread } from '../src/useSpread.js';

interface ObserverStub {
  callback: ResizeObserverCallback;
  target: Element | null;
  connected: boolean;
}

let observers: ObserverStub[] = [];

class StubResizeObserver {
  stub: ObserverStub;
  constructor(callback: ResizeObserverCallback) {
    this.stub = { callback, target: null, connected: false };
    observers.push(this.stub);
  }
  observe(target: Element): void {
    this.stub.target = target;
    this.stub.connected = true;
  }
  unobserve(): void {}
  disconnect(): void {
    this.stub.connected = false;
  }
}

function stubBook(): MejiroBook {
  return {
    computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
    layoutChapter: vi.fn(async () => ({ totalPages: 1 }) as unknown as ChapterLayout),
    layoutManuscript: vi.fn(async () => new Map()),
    getOptions: vi.fn(() => ({ fontSize: 16 })),
  } as unknown as MejiroBook;
}

function oneChapterEpub(): EpubBook {
  return {
    title: 'T',
    author: 'A',
    chapters: [{ title: 'c', paragraphs: [{ text: 'a', inlineAnnotations: [] }] }],
  };
}

function mockLayout(totalPages = 8): ChapterLayout {
  return {
    totalPages,
    getSpread: vi.fn((i: number) => ({ spreadIdx: i, totalPages }) as unknown as SpreadResult),
  } as unknown as ChapterLayout;
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

function sizedDiv(width: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  observers = [];
});

describe('useChapterLayout (React) — surface mounted after the source', () => {
  it('lays out once the surface attaches and watches it with exactly one observer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const book = stubBook();
    const epub = oneChapterEpub();
    const el = sizedDiv(800);
    let layout: ChapterLayout | null = null;

    function Host({ show }: { show: boolean }): ReactNode {
      const ref = useRef<HTMLDivElement | null>(null);
      layout = useChapterLayout(book, epub, 0, ref, { resizeDebounce: 10 }).layout;
      return show ? (
        <div
          ref={(node) => {
            ref.current = node ? el : null;
          }}
        />
      ) : null;
    }

    const { rerender } = render(<Host show={false} />);
    await flush();
    expect(layout).toBeNull();
    expect(book.layoutChapter).not.toHaveBeenCalled();

    rerender(<Host show />);
    await flush();
    expect(layout).not.toBeNull();
    expect(book.layoutChapter).toHaveBeenCalledTimes(1);
    expect(observers.filter((o) => o.connected)).toHaveLength(1);
    expect(observers.find((o) => o.connected)?.target).toBe(el);

    // A resize of the attached element re-flows it.
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 500 });
    await act(async () => {
      for (const o of observers.filter((s) => s.connected)) o.callback([], {} as ResizeObserver);
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(book.layoutChapter).toHaveBeenCalledTimes(2);

    // Detaching the element releases its observer.
    rerender(<Host show={false} />);
    await flush();
    expect(observers.filter((o) => o.connected)).toHaveLength(0);
  });
});

describe('React layout hooks — unmount cleanup', () => {
  it('useChapterLayout disconnects its ResizeObserver on unmount', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const surface = { current: document.createElement('div') };
    const { unmount } = renderHook(() => useChapterLayout(stubBook(), null, 0, surface));
    expect(observers.filter((o) => o.connected)).toHaveLength(1);
    unmount();
    expect(observers.filter((o) => o.connected)).toHaveLength(0);
  });

  it('useManuscriptLayout disconnects its ResizeObserver on unmount', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const surface = { current: document.createElement('div') };
    const { unmount } = renderHook(() => useManuscriptLayout(stubBook(), null, surface));
    expect(observers.filter((o) => o.connected)).toHaveLength(1);
    unmount();
    expect(observers.filter((o) => o.connected)).toHaveLength(0);
  });

  it('useChapterLayout removes its window resize fallback on unmount', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const remove = vi.spyOn(window, 'removeEventListener');
    const surface = { current: document.createElement('div') };
    const { unmount } = renderHook(() => useChapterLayout(stubBook(), null, 0, surface));
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    remove.mockRestore();
  });

  it('useChapterLayout cancels a pending debounced re-flow on unmount', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const book = stubBook();
    const el = sizedDiv(800);
    const surface = { current: el };
    const epub = oneChapterEpub();
    const { unmount } = renderHook(() =>
      useChapterLayout(book, epub, 0, surface, { resizeDebounce: 100 }),
    );
    await flush();
    const callsBefore = vi.mocked(book.layoutChapter).mock.calls.length;

    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 500 });
    // The first observation runs at once; the second is the debounced one.
    for (const o of observers) o.callback([], {} as ResizeObserver);
    await flush();
    const afterFirst = vi.mocked(book.layoutChapter).mock.calls.length;
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 400 });
    for (const o of observers) o.callback([], {} as ResizeObserver);
    expect(afterFirst).toBeGreaterThan(callsBefore);
    unmount();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.mocked(book.layoutChapter).mock.calls.length).toBe(afterFirst);
  });

  it('useSpread cancels a pending page turn on unmount', () => {
    vi.useFakeTimers();
    const layout = mockLayout();
    const { result, unmount } = renderHook(() => useSpread(layout, { turnDuration: 100 }));
    act(() => result.current.goTo(1));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
