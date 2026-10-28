// @vitest-environment happy-dom
/** @jsxImportSource react */

import { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
  await act(async () => {
    step?.();
    await vi.runAllTimersAsync();
  });
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  }
}

describe('MejiroReader (React) — book swap', () => {
  it('lays out only chapter 0 of the new book and reports the reset', async () => {
    vi.useFakeTimers();
    const layoutSpy = vi.spyOn(MejiroBook.prototype, 'layoutChapter');
    try {
      const onChapterChange = vi.fn();
      const ref = createRef<MejiroReaderHandle>();
      const first = threeChapterEpub('A');
      const { rerender } = render(
        <MejiroReader ref={ref} epub={first} onChapterChange={onChapterChange} />,
      );
      await settle();
      await settle(() => ref.current?.goToChapter(2));
      expect(ref.current?.getReadingPosition().chapter).toBe(2);
      layoutSpy.mockClear();
      onChapterChange.mockClear();

      const second = threeChapterEpub('B');
      await settle(() =>
        rerender(<MejiroReader ref={ref} epub={second} onChapterChange={onChapterChange} />),
      );

      expect(layoutSpy).toHaveBeenCalledTimes(1);
      expect(layoutSpy.mock.calls[0][0]).toBe(second.chapters[0]);
      expect(onChapterChange.mock.calls).toEqual([[0]]);
      expect(ref.current?.getReadingPosition().chapter).toBe(0);
    } finally {
      layoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
