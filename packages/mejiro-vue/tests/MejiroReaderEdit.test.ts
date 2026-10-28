// @vitest-environment happy-dom

import { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
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
  step?.();
  for (let i = 0; i < 3; i++) {
    await vi.runAllTimersAsync();
    await nextTick();
  }
}

describe('MejiroReader (Vue) — edits of a tagged book', () => {
  it('re-lays out only an edited shown chapter and never takes the book-swap path', async () => {
    vi.useFakeTimers();
    const layoutSpy = vi.spyOn(MejiroBook.prototype, 'layoutChapter');
    const clearSpy = vi.spyOn(MejiroBook.prototype, 'clearCache');
    try {
      const onLoad = vi.fn();
      const source = {};
      const epub = shallowRef(
        markBookIdentity(
          book((i) => `a${i}`),
          source,
        ),
      );
      render(
        defineComponent({
          setup: () => () => h(MejiroReader, { epub: epub.value, onLoad }),
        }),
      );
      await settle();
      layoutSpy.mockClear();
      clearSpy.mockClear();
      onLoad.mockClear();

      await settle(() => {
        epub.value = markBookIdentity(
          book((i) => (i === 1 ? 'edited' : 'a0')),
          source,
        );
      });
      expect(layoutSpy).not.toHaveBeenCalled();

      await settle(() => {
        epub.value = markBookIdentity(
          book((i) => (i === 1 ? 'edited' : 'b0')),
          source,
        );
      });
      expect(layoutSpy).toHaveBeenCalledTimes(1);
      expect(clearSpy).not.toHaveBeenCalled();
      expect(onLoad).not.toHaveBeenCalled();

      await settle(() => {
        epub.value = book((i) => `c${i}`);
      });
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(onLoad).toHaveBeenCalledTimes(1);
    } finally {
      layoutSpy.mockRestore();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
