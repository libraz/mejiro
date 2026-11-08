// @vitest-environment happy-dom

import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
  SpreadResult,
} from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick, ref } from 'vue';
import { type UseChapterLayoutOptions, useChapterLayout } from '../src/useChapterLayout.js';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';

function withSetup<T>(setup: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = setup();
        return () => null;
      },
    }),
  );
  app.mount(document.createElement('div'));
  return { result, unmount: () => app.unmount() };
}

function mockLayout(): ChapterLayout {
  return {
    pageCount: 8,
    getSpread: vi.fn((i: number) => ({ spreadIndex: i }) as unknown as SpreadResult),
    setImages: vi.fn((i: number) => ({ spreadIndex: i }) as unknown as SpreadResult),
    clearImages: vi.fn(),
  } as unknown as ChapterLayout;
}

function makeBook(layouts: ChapterLayout[]): MejiroBook {
  let i = 0;
  const next = () => layouts[Math.min(i++, layouts.length - 1)];
  return {
    fitPageSize: vi.fn(() => ({
      pageWidth: 120,
      lineWidth: 150,
      pageHeight: 174,
      contentHeight: 150,
    })),
    layoutChapter: vi.fn(async () => next()),
    layoutManuscript: vi.fn(async () => [next()]),
  } as unknown as MejiroBook;
}

async function flush(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

const EPUB = { chapters: [{ title: 'x', paragraphs: [] }] } as unknown as EpubBook;
const MANUSCRIPT: ManuscriptChapter = { title: 'x', body: 'y' };
const ANCHOR: InChapterAnchor = { paragraphIndex: 0, charIndex: 5 };

/** A surface element with a measurable box, as a mounted reader has. */
function sizedSurface(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 480 });
  return el;
}

/** The behavior options both layout composables share. */
type ReflowOptions = Pick<
  UseChapterLayoutOptions,
  'enableResize' | 'capturePosition' | 'restorePosition'
>;

describe('reflow position restore (Vue)', () => {
  const composables = {
    useChapterLayout: (book: MejiroBook, options: ReflowOptions) =>
      useChapterLayout(book, {
        epub: ref(EPUB),
        chapterIndex: ref(0),
        surface: ref(sizedSurface()),
        ...options,
      }),
    useManuscriptLayout: (book: MejiroBook, options: ReflowOptions) =>
      useManuscriptLayout(book, {
        chapter: ref(MANUSCRIPT),
        surface: ref(sizedSurface()),
        ...options,
      }),
  };

  for (const [name, useLayout] of Object.entries(composables)) {
    it(`${name} hands the captured anchor to restorePosition once the new layout is in place`, async () => {
      const [l0, l1] = [mockLayout(), mockLayout()];
      const restorePosition = vi.fn();
      const { result, unmount } = withSetup(() =>
        useLayout(makeBook([l0, l1]), {
          enableResize: false,
          capturePosition: () => ANCHOR,
          restorePosition,
        }),
      );
      await flush();
      expect(result.layout.value).toBe(l0);

      await result.recompute({ blank: false });
      expect(restorePosition).toHaveBeenCalledTimes(1);
      expect(restorePosition).toHaveBeenCalledWith(l1, ANCHOR);
      expect(result.pendingRestore.value).toBeNull();
      unmount();
    });

    it(`${name} leaves the anchor in pendingRestore without restorePosition`, async () => {
      const [l0, l1] = [mockLayout(), mockLayout()];
      const { result, unmount } = withSetup(() =>
        useLayout(makeBook([l0, l1]), { enableResize: false, capturePosition: () => ANCHOR }),
      );
      await flush();
      await result.recompute({ blank: false });
      expect(result.layout.value).toBe(l1);
      expect(result.pendingRestore.value).toEqual(ANCHOR);
      unmount();
    });
  }
});

describe('useImageOverlay reflow (Vue)', () => {
  it('sets every spread on a replaced layout and reports each reflowed spread', async () => {
    const layout = ref<ChapterLayout | null>(mockLayout());
    const spreadIndex = ref(0);
    const onReflow = vi.fn();
    const { result, unmount } = withSetup(() => useImageOverlay(layout, { spreadIndex, onReflow }));
    for (const s of [0, 1, 2]) {
      spreadIndex.value = s;
      result.addOverlay();
    }
    onReflow.mockClear();

    const replaced = mockLayout();
    layout.value = replaced;
    await flush();

    expect(vi.mocked(replaced.setImages).mock.calls.map((call) => call[0])).toEqual([0, 1, 2]);
    expect(onReflow.mock.calls.map(([spread]) => spread)).toEqual(
      vi.mocked(replaced.setImages).mock.results.map((r) => r.value),
    );
    unmount();
  });
});
