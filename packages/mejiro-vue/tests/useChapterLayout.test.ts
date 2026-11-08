// @vitest-environment happy-dom

import type { ChapterLayout, InChapterAnchor, MejiroBook } from '@libraz/mejiro/book';

import type { EpubBook } from '@libraz/mejiro/epub';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { mockLayout, withSetup } from './helpers/fixtures.js';

describe('useChapterLayout (Vue)', () => {
  function makeEpub(): EpubBook {
    return { chapters: [{ text: 'x', paragraphs: [] }] } as unknown as EpubBook;
  }
  function makeBook(layouts: ChapterLayout[]): MejiroBook {
    let i = 0;
    return {
      fitPageSize: vi.fn(() => ({
        pageWidth: 120,
        lineWidth: 150,
        pageHeight: 174,
        contentHeight: 150,
      })),
      layoutChapter: vi.fn(async () => layouts[Math.min(i++, layouts.length - 1)]),
    } as unknown as MejiroBook;
  }
  /** A surface element with a measurable box, as a mounted reader has. */
  function sizedSurface(): HTMLElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 480 });
    return el;
  }
  // Flush the immediate (sync) layout watch plus the async `layoutChapter`.
  async function flush(): Promise<void> {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('captures the reading position before a reflow and restores it into the new layout', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const book = makeBook([l0, l1]);
    const surface = ref<HTMLElement | null>(sizedSurface());
    const anchor: InChapterAnchor = { paragraphIndex: 0, charIndex: 5 };
    const capturePosition = vi.fn(() => anchor);
    const restorePosition = vi.fn();

    const { result, unmount } = withSetup(() =>
      useChapterLayout(book, {
        epub: ref<EpubBook | null>(makeEpub()),
        chapterIndex: ref(0),
        surface,
        enableResize: false,
        capturePosition,
        restorePosition,
      }),
    );
    await flush();
    // Initial (blank) layout: position hooks are not invoked.
    expect(result.layout.value).toBe(l0);
    expect(capturePosition).not.toHaveBeenCalled();
    expect(restorePosition).not.toHaveBeenCalled();

    // A reflow captures from the outgoing layout and restores into the new one.
    await result.recompute({ blank: false });
    expect(capturePosition).toHaveBeenCalledTimes(1);
    expect(capturePosition).toHaveBeenCalledWith(l0);
    expect(restorePosition).toHaveBeenCalledTimes(1);
    expect(restorePosition).toHaveBeenCalledWith(l1, anchor);
    expect(result.layout.value).toBe(l1);
    unmount();
  });

  it('does not capture/restore on a blank (content-change) re-layout', async () => {
    const book = makeBook([mockLayout(6), mockLayout(6)]);
    const surface = ref<HTMLElement | null>(sizedSurface());
    const capturePosition = vi.fn(() => ({ paragraphIndex: 0, charIndex: 0 }) as InChapterAnchor);
    const restorePosition = vi.fn();
    const { result, unmount } = withSetup(() =>
      useChapterLayout(book, {
        epub: ref<EpubBook | null>(makeEpub()),
        chapterIndex: ref(0),
        surface,
        enableResize: false,
        capturePosition,
        restorePosition,
      }),
    );
    await flush();
    await result.recompute({ blank: true });
    expect(capturePosition).not.toHaveBeenCalled();
    expect(restorePosition).not.toHaveBeenCalled();
    unmount();
  });

  it('forwards page-geometry overrides to fitPageSize', async () => {
    const book = makeBook([mockLayout(6)]);
    const surface = ref<HTMLElement | null>(sizedSurface());
    const geometry = { gutterOffset: 0, headerOffset: 0 };
    const { unmount } = withSetup(() =>
      useChapterLayout(book, {
        epub: ref<EpubBook | null>(makeEpub()),
        chapterIndex: ref(0),
        surface,
        enableResize: false,
        pageGeometry: () => geometry,
      }),
    );
    await flush();
    expect(book.fitPageSize).toHaveBeenCalledWith(surface.value, geometry);
    unmount();
  });

  it('re-lays out the chapter with the new instance when the book ref is swapped', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const bookA = makeBook([l0]);
    const bookB = makeBook([l1]);
    const book = shallowRef(bookA);
    const surface = ref<HTMLElement | null>(sizedSurface());
    const { result, unmount } = withSetup(() =>
      useChapterLayout(book, {
        epub: ref<EpubBook | null>(makeEpub()),
        chapterIndex: ref(0),
        surface,
        enableResize: false,
      }),
    );
    await flush();
    expect(result.layout.value).toBe(l0);

    book.value = bookB;
    await flush();
    expect(bookB.layoutChapter).toHaveBeenCalledTimes(1);
    expect(result.layout.value).toBe(l1);
    unmount();
  });
});
