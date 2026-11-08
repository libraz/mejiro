// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, InChapterAnchor, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { mockLayout, sizedSurface } from './helpers/fixtures.js';

describe('useChapterLayout (React)', () => {
  function makeEpub(): EpubBook {
    return { chapters: [{ text: 'x', paragraphs: [] }] } as unknown as EpubBook;
  }
  function makeBook(layouts: ChapterLayout[]): MejiroBook {
    let i = 0;
    return {
      fitPageSize: vi.fn(() => ({ pageWidth: 120, pageHeight: 174, contentHeight: 150 })),
      layoutChapter: vi.fn(async () => layouts[Math.min(i++, layouts.length - 1)]),
    } as unknown as MejiroBook;
  }

  it('captures the position before a reflow and exposes it via pendingRestore', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const book = makeBook([l0, l1]);
    const epub = makeEpub();
    const surface = { current: sizedSurface() };
    const anchor: InChapterAnchor = { paragraphIndex: 0, charIndex: 5 };
    const capturePosition = vi.fn(() => anchor);

    const { result } = renderHook(() =>
      useChapterLayout(book, {
        epub,
        chapterIndex: 0,
        surface,
        enableResize: false,
        capturePosition,
      }),
    );
    await waitFor(() => expect(result.current.layout).toBe(l0));
    // Initial (blank) layout: nothing captured.
    expect(capturePosition).not.toHaveBeenCalled();
    expect(result.current.pendingRestore.current).toBeNull();

    await act(async () => {
      await result.current.recompute({ blank: false });
    });
    expect(capturePosition).toHaveBeenCalledTimes(1);
    expect(capturePosition).toHaveBeenCalledWith(l0);
    expect(result.current.layout).toBe(l1);
    expect(result.current.pendingRestore.current).toEqual(anchor);
  });

  it('does not capture on a blank (content-change) re-layout', async () => {
    const book = makeBook([mockLayout(6), mockLayout(6)]);
    const epub = makeEpub();
    const surface = { current: sizedSurface() };
    const capturePosition = vi.fn(() => ({ paragraphIndex: 0, charIndex: 0 }) as InChapterAnchor);
    const { result } = renderHook(() =>
      useChapterLayout(book, {
        epub,
        chapterIndex: 0,
        surface,
        enableResize: false,
        capturePosition,
      }),
    );
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => {
      await result.current.recompute({ blank: true });
    });
    expect(capturePosition).not.toHaveBeenCalled();
    expect(result.current.pendingRestore.current).toBeNull();
  });

  it('forwards page-geometry overrides to fitPageSize', async () => {
    const book = makeBook([mockLayout(6)]);
    const epub = makeEpub();
    const surface = { current: sizedSurface() };
    const geometry = { gutterOffset: 0, headerOffset: 0 };
    renderHook(() =>
      useChapterLayout(book, {
        epub,
        chapterIndex: 0,
        surface,
        enableResize: false,
        pageGeometry: () => geometry,
      }),
    );
    await waitFor(() => expect(book.fitPageSize).toHaveBeenCalledWith(surface.current, geometry));
  });

  it('re-lays out the chapter with the new instance when the book is swapped', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const bookA = makeBook([l0]);
    const bookB = makeBook([l1]);
    const epub = makeEpub();
    const surface = { current: sizedSurface() };
    const { result, rerender } = renderHook(
      ({ book }: { book: MejiroBook }) =>
        useChapterLayout(book, { epub, chapterIndex: 0, surface, enableResize: false }),
      { initialProps: { book: bookA } },
    );
    await waitFor(() => expect(result.current.layout).toBe(l0));

    rerender({ book: bookB });
    await waitFor(() => expect(result.current.layout).toBe(l1));
    expect(bookB.layoutChapter).toHaveBeenCalledTimes(1);
  });

  it('exposes pendingRestore as a writable ref', async () => {
    // The type-level contract is compile-checked in layoutHookTypes.test.ts.
    const book = makeBook([mockLayout(6)]);
    const epub = makeEpub();
    const surface = { current: sizedSurface() };
    const { result } = renderHook(() =>
      useChapterLayout(book, { epub, chapterIndex: 0, surface, enableResize: false }),
    );
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    const anchor: InChapterAnchor = { paragraphIndex: 1, charIndex: 2 };
    result.current.pendingRestore.current = anchor;
    expect(result.current.pendingRestore.current).toBe(anchor);
    result.current.pendingRestore.current = null;
    expect(result.current.pendingRestore.current).toBeNull();
  });
});
