// @vitest-environment happy-dom
/** @jsxImportSource react */

import { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { markBookIdentity } from '../src/bookIdentity.js';
import { MejiroReader } from '../src/MejiroReader.js';

function book(text: (chapter: number) => string): EpubBook {
  return {
    title: 'T',
    chapters: [0, 1].map((i) => ({
      title: `Chapter ${i}`,
      paragraphs: [{ text: text(i), inlineAnnotations: [] }],
    })),
  };
}

async function settle(step?: () => void): Promise<void> {
  await act(async () => {
    step?.();
    await vi.runAllTimersAsync();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe('MejiroReader (React) — edits of a tagged book', () => {
  it('re-lays out only an edited shown chapter and never takes the book-swap path', async () => {
    vi.useFakeTimers();
    const layoutSpy = vi.spyOn(MejiroBook.prototype, 'layoutChapter');
    const clearSpy = vi.spyOn(MejiroBook.prototype, 'clearCache');
    try {
      const onLoad = vi.fn();
      const source = {};
      const first = markBookIdentity(
        book((i) => `a${i}`),
        source,
      );
      const { rerender } = render(<MejiroReader epub={first} onLoad={onLoad} />);
      await settle();
      layoutSpy.mockClear();
      clearSpy.mockClear();
      onLoad.mockClear();

      const otherChapterEdited = markBookIdentity(
        book((i) => (i === 1 ? 'edited' : 'a0')),
        source,
      );
      await settle(() => rerender(<MejiroReader epub={otherChapterEdited} onLoad={onLoad} />));
      expect(layoutSpy).not.toHaveBeenCalled();

      const shownChapterEdited = markBookIdentity(
        book((i) => (i === 1 ? 'edited' : 'b0')),
        source,
      );
      await settle(() => rerender(<MejiroReader epub={shownChapterEdited} onLoad={onLoad} />));
      expect(layoutSpy).toHaveBeenCalledTimes(1);
      expect(clearSpy).not.toHaveBeenCalled();
      expect(onLoad).not.toHaveBeenCalled();

      await settle(() => rerender(<MejiroReader epub={book((i) => `c${i}`)} onLoad={onLoad} />));
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(onLoad).toHaveBeenCalledTimes(1);
    } finally {
      layoutSpy.mockRestore();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
