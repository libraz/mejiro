// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';

function mockLayout(): ChapterLayout {
  return {
    totalPages: 4,
    getSpread: vi.fn(),
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
});
