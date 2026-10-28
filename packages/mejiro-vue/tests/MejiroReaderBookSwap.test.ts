// @vitest-environment happy-dom

import { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { MejiroReader, type MejiroReaderHandle } from '../src/MejiroReader.js';

function threeChapterEpub(title: string): EpubBook {
  return {
    title,
    author: 'Author',
    chapters: [0, 1, 2].map((i) => ({
      title: `Chapter ${i}`,
      paragraphs: [{ text: `${title}${i}`, inlineAnnotations: [] }],
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

describe('MejiroReader (Vue) — book swap', () => {
  it('lays out only chapter 0 of the new book and reports the reset', async () => {
    vi.useFakeTimers();
    const layoutSpy = vi.spyOn(MejiroBook.prototype, 'layoutChapter');
    try {
      const onChapterChange = vi.fn();
      const reader = ref<MejiroReaderHandle | null>(null);
      const epub = shallowRef(threeChapterEpub('A'));
      render(
        defineComponent({
          setup: () => () =>
            h(MejiroReader, { ref: reader, epub: epub.value, 'onChapter-change': onChapterChange }),
        }),
      );
      await settle();
      await settle(() => reader.value?.goToChapter(2));
      expect(reader.value?.getReadingPosition().chapter).toBe(2);
      layoutSpy.mockClear();
      onChapterChange.mockClear();

      const second = threeChapterEpub('B');
      await settle(() => {
        epub.value = second;
      });

      expect(layoutSpy).toHaveBeenCalledTimes(1);
      expect(layoutSpy.mock.calls[0][0]).toBe(second.chapters[0]);
      expect(onChapterChange.mock.calls).toEqual([[0]]);
      expect(reader.value?.getReadingPosition().chapter).toBe(0);
    } finally {
      layoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
