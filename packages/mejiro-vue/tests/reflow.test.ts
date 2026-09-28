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
import { useChapterLayout } from '../src/useChapterLayout.js';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';
import { useMultiImageOverlay } from '../src/useMultiImageOverlay.js';

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
    totalPages: 8,
    getSpread: vi.fn((i: number) => ({ spreadIdx: i }) as unknown as SpreadResult),
    setImages: vi.fn(),
    clearImages: vi.fn(),
  } as unknown as ChapterLayout;
}

function makeBook(layouts: ChapterLayout[]): MejiroBook {
  let i = 0;
  const next = () => layouts[Math.min(i++, layouts.length - 1)];
  return {
    computePageSize: vi.fn(() => ({ pageWidth: 120, pageHeight: 174, contentHeight: 150 })),
    layoutChapter: vi.fn(async () => next()),
    layoutManuscript: vi.fn(async () => new Map([['c', next()]])),
  } as unknown as MejiroBook;
}

async function flush(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

const EPUB = { chapters: [{ title: 'x', paragraphs: [] }] } as unknown as EpubBook;
const MANUSCRIPT: ManuscriptChapter = { title: 'x', body: 'y' };
const ANCHOR: InChapterAnchor = { paragraph: 0, charIndex: 5 };

describe('reflow position restore (Vue)', () => {
  const composables = {
    useChapterLayout: (book: MejiroBook, options: Parameters<typeof useChapterLayout>[4]) =>
      useChapterLayout(book, ref(EPUB), ref(0), ref(document.createElement('div')), options),
    useManuscriptLayout: (book: MejiroBook, options: Parameters<typeof useManuscriptLayout>[3]) =>
      useManuscriptLayout(book, ref(MANUSCRIPT), ref(document.createElement('div')), options),
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
      expect(result.pendingRestore.current).toBeNull();
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
      expect(result.pendingRestore.current).toEqual(ANCHOR);
      unmount();
    });
  }
});

describe('useMultiImageOverlay reflow (Vue)', () => {
  it('sets every spread on a replaced layout before reading any back', async () => {
    const layout = ref<ChapterLayout | null>(mockLayout());
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() =>
      useMultiImageOverlay(layout, spreadIdx, { onUpdate: vi.fn() }),
    );
    for (const s of [0, 1, 2]) {
      spreadIdx.value = s;
      result.addImage();
    }

    const replaced = mockLayout();
    layout.value = replaced;
    await flush();

    const setOrder = vi.mocked(replaced.setImages).mock.invocationCallOrder;
    const getOrder = vi.mocked(replaced.getSpread).mock.invocationCallOrder;
    expect(setOrder).toHaveLength(3);
    expect(getOrder).toHaveLength(3);
    expect(Math.max(...setOrder)).toBeLessThan(Math.min(...getOrder));
    unmount();
  });
});
