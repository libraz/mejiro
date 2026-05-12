import { describe, expect, it } from 'vitest';
import { estimateReadingTime, formatReadingTime } from '../../src/book/reading-time.js';
import type { BookParagraph } from '../../src/book/types.js';

function chapterOf(...texts: Array<[string, number?]>): { paragraphs: BookParagraph[] } {
  return {
    paragraphs: texts.map(([text, headingLevel]) =>
      headingLevel == null ? { text } : { text, headingLevel, kind: 'heading' },
    ) as BookParagraph[],
  };
}

describe('estimateReadingTime', () => {
  it('returns ms based on characters and cpm', () => {
    const chapter = chapterOf(['あ'.repeat(600)]);
    // 600 chars at 600cpm => exactly 60 seconds.
    expect(estimateReadingTime(chapter)).toBe(60_000);
  });

  it('uses configurable cpm', () => {
    const chapter = chapterOf(['a'.repeat(1200)]);
    expect(estimateReadingTime(chapter, { cpm: 1200 })).toBe(60_000);
  });

  it('counts codepoints, not UTF-16 code units (no surrogate pair inflation)', () => {
    // A single astral codepoint counts as one, even though it occupies two
    // UTF-16 units. 600 codepoints at 600cpm = 60 sec.
    const chapter = chapterOf(['😀'.repeat(600)]);
    expect(estimateReadingTime(chapter)).toBe(60_000);
  });

  it('excludes headings by default and includes them on demand', () => {
    const chapter = chapterOf(['本文'.repeat(300)], ['見出し'.repeat(200), 1]);
    expect(estimateReadingTime(chapter)).toBe(60_000);
    expect(estimateReadingTime(chapter, { includeHeadings: true })).toBe(120_000);
  });

  it('returns zero for zero or negative cpm', () => {
    const chapter = chapterOf(['x'.repeat(1000)]);
    expect(estimateReadingTime(chapter, { cpm: 0 })).toBe(0);
    expect(estimateReadingTime(chapter, { cpm: -1 })).toBe(0);
  });
});

describe('formatReadingTime', () => {
  it('formats Japanese hours/minutes/seconds', () => {
    expect(formatReadingTime(0)).toBe('0秒');
    expect(formatReadingTime(45_000)).toBe('45秒');
    expect(formatReadingTime(125_000)).toBe('2分5秒');
    expect(formatReadingTime(3_660_000)).toBe('1時間1分');
  });

  it('formats English when requested', () => {
    expect(formatReadingTime(60_000, 'en')).toBe('1m 0s');
    expect(formatReadingTime(3_660_000, 'en')).toBe('1h 1m');
  });
});
