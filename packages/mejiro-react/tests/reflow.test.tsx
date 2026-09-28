// @vitest-environment happy-dom

import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
  SpreadResult,
} from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';
import { useMultiImageOverlay } from '../src/useMultiImageOverlay.js';

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

const EPUB = { chapters: [{ title: 'x', paragraphs: [] }] } as unknown as EpubBook;
const MANUSCRIPT: ManuscriptChapter = { title: 'x', body: 'y' };
const ANCHOR: InChapterAnchor = { paragraph: 0, charIndex: 5 };
const SURFACE = { current: document.createElement('div') };

describe('reflow position restore (React)', () => {
  const hooks = {
    useChapterLayout: (book: MejiroBook, options: Parameters<typeof useChapterLayout>[4]) =>
      useChapterLayout(book, EPUB, 0, SURFACE, options),
    useManuscriptLayout: (book: MejiroBook, options: Parameters<typeof useManuscriptLayout>[3]) =>
      useManuscriptLayout(book, MANUSCRIPT, SURFACE, options),
  };

  for (const [name, useLayout] of Object.entries(hooks)) {
    it(`${name} hands the captured anchor to restorePosition once the new layout is in place`, async () => {
      const [l0, l1] = [mockLayout(), mockLayout()];
      const restorePosition = vi.fn();
      const book = makeBook([l0, l1]);
      const { result } = renderHook(() =>
        useLayout(book, {
          enableResize: false,
          capturePosition: () => ANCHOR,
          restorePosition,
        }),
      );
      await waitFor(() => expect(result.current.layout).toBe(l0));
      expect(restorePosition).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.recompute({ blank: false });
      });
      expect(restorePosition).toHaveBeenCalledTimes(1);
      expect(restorePosition).toHaveBeenCalledWith(l1, ANCHOR);
      expect(result.current.pendingRestore.current).toBeNull();
    });

    it(`${name} leaves the anchor in pendingRestore without restorePosition`, async () => {
      const [l0, l1] = [mockLayout(), mockLayout()];
      const book = makeBook([l0, l1]);
      const { result } = renderHook(() =>
        useLayout(book, { enableResize: false, capturePosition: () => ANCHOR }),
      );
      await waitFor(() => expect(result.current.layout).toBe(l0));
      await act(async () => {
        await result.current.recompute({ blank: false });
      });
      expect(result.current.layout).toBe(l1);
      expect(result.current.pendingRestore.current).toEqual(ANCHOR);
    });
  }
});

describe('useMultiImageOverlay reflow (React)', () => {
  it('sets every spread on a replaced layout before reading any back', () => {
    const onUpdate = vi.fn();
    const { result, rerender } = renderHook(
      ({ layout, s }: { layout: ChapterLayout; s: number }) =>
        useMultiImageOverlay(layout, s, { onUpdate }),
      { initialProps: { layout: mockLayout(), s: 0 } },
    );
    const first = mockLayout();
    rerender({ layout: first, s: 0 });
    for (const s of [0, 1, 2]) {
      rerender({ layout: first, s });
      act(() => {
        result.current.addImage();
      });
    }

    const replaced = mockLayout();
    rerender({ layout: replaced, s: 2 });

    const setOrder = vi.mocked(replaced.setImages).mock.invocationCallOrder;
    const getOrder = vi.mocked(replaced.getSpread).mock.invocationCallOrder;
    expect(setOrder).toHaveLength(3);
    expect(getOrder).toHaveLength(3);
    expect(Math.max(...setOrder)).toBeLessThan(Math.min(...getOrder));
  });
});
