// @vitest-environment happy-dom
/** @jsxImportSource react */

import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
} from '@libraz/mejiro/book';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';

function mockLayout(totalPages = 4): ChapterLayout {
  return {
    totalPages,
    getSpread: vi.fn(),
    // Anchors encode the spread they came from, so a capture/restore round trip
    // is observable in the test.
    anchorAt: vi.fn((i: number) => ({ paragraph: 0, charIndex: i * 10 })),
    locateAnchor: vi.fn((a: InChapterAnchor) => ({ spreadIdx: Math.floor(a.charIndex / 10) })),
    setImages: vi.fn(),
    clearImages: vi.fn(),
    syncImages: vi.fn(),
    resize: vi.fn(),
  } as unknown as ChapterLayout;
}

/** Book stub that hands out a different layout object on every computation. */
function mockBookSequence(layouts: ChapterLayout[]): MejiroBook {
  let i = 0;
  return {
    computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
    layoutManuscript: vi.fn(async ({ chapters }: { chapters: ManuscriptChapter[] }) => {
      const map = new Map<string, ChapterLayout>();
      const layout = layouts[Math.min(i++, layouts.length - 1)];
      for (const chapter of chapters) {
        map.set(chapter.id ?? 'fallback', layout);
      }
      return map;
    }),
    getOptions: vi.fn(() => ({ fontSize: 16 })),
  } as unknown as MejiroBook;
}

function mockBook(layout: ChapterLayout = mockLayout()): MejiroBook {
  return {
    computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
    layoutManuscript: vi.fn(async ({ chapters }: { chapters: ManuscriptChapter[] }) => {
      const map = new Map<string, ChapterLayout>();
      for (const chapter of chapters) {
        map.set(chapter.id ?? 'fallback', layout);
      }
      return map;
    }),
    getOptions: vi.fn(() => ({ fontSize: 16 })),
  } as unknown as MejiroBook;
}

function setupHook(initialChapter: ManuscriptChapter | null) {
  const book = mockBook();
  const surfaceEl = document.createElement('div');
  return {
    book,
    surfaceEl,
    hook: renderHook(
      ({ chapter }: { chapter: ManuscriptChapter | null }) => {
        const surface = useRef<HTMLElement | null>(surfaceEl);
        return useManuscriptLayout(book, chapter, surface);
      },
      { initialProps: { chapter: initialChapter } },
    ),
  };
}

describe('useManuscriptLayout (React)', () => {
  it('lays out a single manuscript chapter via layoutManuscript', async () => {
    const chapter: ManuscriptChapter = { id: 'c1', title: 'Title', body: 'Body.' };
    const { book, hook } = setupHook(chapter);

    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());

    expect(book.layoutManuscript).toHaveBeenCalledWith({
      chapters: [chapter],
      dialect: 'mejiro',
    });
    expect(hook.result.current.pageWidth).toBe(320);
    expect(hook.result.current.pageHeight).toBe(480);
    expect(hook.result.current.contentHeight).toBe(400);
  });

  it('honors the dialect option', async () => {
    const book = mockBook();
    const surfaceEl = document.createElement('div');
    const chapter: ManuscriptChapter = { id: 'c1', title: 'T', body: 'B' };
    const { result } = renderHook(() => {
      const surface = useRef<HTMLElement | null>(surfaceEl);
      return useManuscriptLayout(book, chapter, surface, { dialect: 'narou' });
    });
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    expect(book.layoutManuscript).toHaveBeenCalledWith({
      chapters: [chapter],
      dialect: 'narou',
    });
  });

  it('clears layout when chapter becomes null', async () => {
    const chapter: ManuscriptChapter = { id: 'c1', title: 'T', body: 'B' };
    const { hook } = setupHook(chapter);
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());

    hook.rerender({ chapter: null });
    await waitFor(() => expect(hook.result.current.layout).toBeNull());
    expect(hook.result.current.pageWidth).toBe(0);
  });

  it('exposes a recompute callback that re-runs layout', async () => {
    const chapter: ManuscriptChapter = { id: 'c1', title: 'T', body: 'B' };
    const { book, hook } = setupHook(chapter);
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());
    expect(book.layoutManuscript).toHaveBeenCalledTimes(1);

    await act(async () => {
      await hook.result.current.recompute();
    });
    expect(book.layoutManuscript).toHaveBeenCalledTimes(2);
  });

  it('recomputes through ResizeObserver when the surface size changes', async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let resizeCallback: ResizeObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    try {
      const book = mockBook();
      const surfaceEl = document.createElement('div');
      const chapter: ManuscriptChapter = { id: 'c1', title: 'T', body: 'B' };
      const { unmount } = renderHook(() => {
        const surface = useRef<HTMLElement | null>(surfaceEl);
        return useManuscriptLayout(book, chapter, surface, { resizeDebounce: 0 });
      });

      await waitFor(() => expect(book.layoutManuscript).toHaveBeenCalledTimes(1));
      expect(observe).toHaveBeenCalledWith(surfaceEl);

      act(() => resizeCallback?.([], {} as ResizeObserver));
      await waitFor(() => expect(book.layoutManuscript).toHaveBeenCalledTimes(2));

      act(() => resizeCallback?.([], {} as ResizeObserver));
      await waitFor(() => expect(book.layoutManuscript).toHaveBeenCalledTimes(3));
      expect(book.computePageSize).toHaveBeenCalledTimes(3);
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.stubGlobal('ResizeObserver', originalResizeObserver);
    }
  });

  it('re-paginates on a surface resize without blanking the preview or losing the spread', async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let resizeCallback: ResizeObserverCallback | null = null;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    try {
      const first = mockLayout(8);
      const second = mockLayout(8);
      const book = mockBookSequence([first, second]);
      const surfaceEl = document.createElement('div');
      const chapter: ManuscriptChapter = { id: 'c1', title: 'T', body: 'B' };
      const seen: (ChapterLayout | null)[] = [];
      // The reader's spread index lives outside the hook; capture it the same
      // way `MejiroReader` does so the reflow round trip is observable.
      const spreadIdx = 2;

      const { result } = renderHook(() => {
        const surface = useRef<HTMLElement | null>(surfaceEl);
        const ctx = useManuscriptLayout(book, chapter, surface, {
          resizeDebounce: 0,
          capturePosition: (l) => l.anchorAt(spreadIdx, 'right'),
        });
        seen.push(ctx.layout);
        return ctx;
      });

      await waitFor(() => expect(result.current.layout).toBe(first));
      seen.length = 0;

      // Only the surface reports a new size — no window resize event is fired.
      await act(async () => {
        resizeCallback?.([], {} as ResizeObserver);
      });
      await waitFor(() => expect(result.current.layout).toBe(second));

      // A full re-layout, not the `resize()` fast-path.
      expect(book.layoutManuscript).toHaveBeenCalledTimes(2);
      expect(first.resize).not.toHaveBeenCalled();
      // The preview is never blanked while the new layout is computed.
      expect(seen).not.toContain(null);
      // The spread the reader was on is handed back for restoration.
      const anchor = result.current.pendingRestore.current;
      expect(anchor).toEqual({ paragraph: 0, charIndex: 20 });
      expect(second.locateAnchor(anchor as InChapterAnchor)?.spreadIdx).toBe(2);
    } finally {
      vi.stubGlobal('ResizeObserver', originalResizeObserver);
    }
  });

  it('re-lays out with the new instance when the book is swapped', async () => {
    const l0 = mockLayout(4);
    const l1 = mockLayout(8);
    const bookA = mockBookSequence([l0]);
    const bookB = mockBookSequence([l1]);
    const surfaceEl = document.createElement('div');
    const chapter: ManuscriptChapter = { id: 'c1', title: 'T', body: 'B' };
    const { result, rerender } = renderHook(
      ({ book }: { book: MejiroBook }) => {
        const surface = useRef<HTMLElement | null>(surfaceEl);
        return useManuscriptLayout(book, chapter, surface, { enableResize: false });
      },
      { initialProps: { book: bookA } },
    );
    await waitFor(() => expect(result.current.layout).toBe(l0));

    rerender({ book: bookB });
    await waitFor(() => expect(result.current.layout).toBe(l1));
    expect(bookB.layoutManuscript).toHaveBeenCalledTimes(1);
  });
});
