// @vitest-environment happy-dom

import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
  SpreadResult,
} from '@libraz/mejiro/book';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, type Ref, ref, shallowRef, watch } from 'vue';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';
import { useSpread } from '../src/useSpread.js';

function mockLayout(totalPages = 8): ChapterLayout {
  return {
    totalPages,
    getSpread: vi.fn(
      (i: number) =>
        ({
          spreadIdx: i,
          totalPages,
          totalSpreads: Math.ceil(totalPages / 2),
        }) as unknown as SpreadResult,
    ),
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

function harness<T>(setup: () => T): { result: { current: T }; app: ReturnType<typeof mount> } {
  const result = { current: undefined as unknown as T };
  const TestComponent = defineComponent({
    setup() {
      result.current = setup();
      return () => h('div');
    },
  });
  const app = mount(TestComponent);
  return { result, app };
}

describe('useManuscriptLayout (Vue)', () => {
  it('lays out a single manuscript chapter via layoutManuscript', async () => {
    const book = mockBook();
    const surfaceEl = document.createElement('div');
    const chapter: Ref<ManuscriptChapter | null> = shallowRef({
      id: 'c1',
      title: 'T',
      body: 'B',
    });
    const surface = ref(surfaceEl);
    const { result } = harness(() => useManuscriptLayout(book, chapter, surface));

    await nextTick();
    await nextTick();

    expect(book.layoutManuscript).toHaveBeenCalledWith({
      chapters: [chapter.value],
      dialect: 'mejiro',
    });
    expect(result.current.pageWidth.value).toBe(320);
  });

  it('clears layout when chapter becomes null', async () => {
    const book = mockBook();
    const surfaceEl = document.createElement('div');
    const chapter: Ref<ManuscriptChapter | null> = shallowRef({
      id: 'c1',
      title: 'T',
      body: 'B',
    });
    const surface = ref(surfaceEl);
    const { result } = harness(() => useManuscriptLayout(book, chapter, surface));
    await nextTick();
    await nextTick();
    expect(result.current.layout.value).not.toBeNull();

    chapter.value = null;
    await nextTick();
    await nextTick();
    expect(result.current.layout.value).toBeNull();
    expect(result.current.pageWidth.value).toBe(0);
  });

  it('honors a reactive dialect option', async () => {
    const book = mockBook();
    const surfaceEl = document.createElement('div');
    const chapter: Ref<ManuscriptChapter | null> = shallowRef({
      id: 'c1',
      title: 'T',
      body: 'B',
    });
    const surface = ref(surfaceEl);
    const dialect = shallowRef<'mejiro' | 'narou'>('mejiro');
    harness(() => useManuscriptLayout(book, chapter, surface, { dialect }));

    await nextTick();
    await nextTick();
    dialect.value = 'narou';
    await nextTick();
    await nextTick();

    const calls = (book.layoutManuscript as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.at(-1)?.[0]).toEqual({ chapters: [chapter.value], dialect: 'narou' });
  });

  it('re-lays out with the new instance when the book ref is swapped', async () => {
    const l0 = mockLayout(4);
    const l1 = mockLayout(8);
    const bookA = mockBookSequence([l0]);
    const bookB = mockBookSequence([l1]);
    const book = shallowRef(bookA);
    const chapter: Ref<ManuscriptChapter | null> = shallowRef({ id: 'c1', title: 'T', body: 'B' });
    const surface = ref(document.createElement('div'));
    const { result } = harness(() => useManuscriptLayout(book, chapter, surface));

    await nextTick();
    await nextTick();
    expect(result.current.layout.value).toBe(l0);

    book.value = bookB;
    await nextTick();
    await nextTick();
    expect(bookB.layoutManuscript).toHaveBeenCalledTimes(1);
    expect(result.current.layout.value).toBe(l1);
  });

  it('re-paginates on a surface resize without blanking the preview or losing the spread', async () => {
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
      const first = mockLayout(8);
      const second = mockLayout(8);
      const book = mockBookSequence([first, second]);
      const chapter: Ref<ManuscriptChapter | null> = shallowRef({
        id: 'c1',
        title: 'T',
        body: 'B',
      });
      const surfaceEl = document.createElement('div');
      const surface = ref(surfaceEl);
      const seen: (ChapterLayout | null)[] = [];

      const { result } = harness(() => {
        const layoutCtx = useManuscriptLayout(book, chapter, surface, {
          resizeDebounce: 0,
          capturePosition: (l) => l.anchorAt(spreadCtx.spreadIdx.value, 'right'),
          restorePosition: (l, anchor) =>
            spreadCtx.setSpread(l.locateAnchor(anchor)?.spreadIdx ?? 0),
        });
        const spreadCtx = useSpread(layoutCtx.layout, { enableKeyboard: false });
        watch(layoutCtx.layout, (v) => seen.push(v), { flush: 'sync' });
        return { layoutCtx, spreadCtx };
      });

      await nextTick();
      await nextTick();
      expect(observe).toHaveBeenCalledWith(surfaceEl);
      expect(result.current.layoutCtx.layout.value).toBe(first);

      result.current.spreadCtx.setSpread(2);
      expect(result.current.spreadCtx.spreadIdx.value).toBe(2);
      seen.length = 0;

      // Only the surface reports a new size — no window resize event is fired.
      resizeCallback?.([], {} as ResizeObserver);
      await nextTick();
      await nextTick();
      await nextTick();

      // A full re-layout, not the `resize()` fast-path.
      expect(book.layoutManuscript).toHaveBeenCalledTimes(2);
      expect(first.resize).not.toHaveBeenCalled();
      // The consumer sees a new layout handle, and never a null in between.
      expect(result.current.layoutCtx.layout.value).toBe(second);
      expect(seen).toEqual([second]);
      // The spread the reader was on survives the reflow, and reads through to
      // the replacement layout.
      expect(result.current.spreadCtx.spreadIdx.value).toBe(2);
      expect(second.getSpread).toHaveBeenCalledWith(2);
      expect(result.current.spreadCtx.spread.value).toEqual(
        expect.objectContaining({ spreadIdx: 2 }),
      );
    } finally {
      vi.stubGlobal('ResizeObserver', originalResizeObserver);
    }
  });
});
