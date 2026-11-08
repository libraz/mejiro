import { enMessages, jaMessages } from '@libraz/mejiro';
import { type BookParagraph, estimateReadingTime, formatReadingTime } from '@libraz/mejiro/book';
import { describe, expect, it } from 'vitest';
import { isHeadingParagraph } from '../../src/book/reading-time.js';
import { expectTypeErrors } from '../type-probe.js';

function chapterOf(...texts: Array<[string, number?]>): { paragraphs: BookParagraph[] } {
  return {
    paragraphs: texts.map(([text, headingLevel]) =>
      headingLevel == null ? { text } : { text, headingLevel, kind: 'heading' },
    ) as BookParagraph[],
  };
}

describe('estimateReadingTime', () => {
  it('returns ms based on characters and the reading rate', () => {
    const chapter = chapterOf(['あ'.repeat(600)]);
    // 600 chars at 600cpm => exactly 60 seconds.
    expect(estimateReadingTime(chapter)).toBe(60_000);
  });

  it('uses a configurable reading rate', () => {
    const chapter = chapterOf(['a'.repeat(1200)]);
    expect(estimateReadingTime(chapter, { charsPerMinute: 1200 })).toBe(60_000);
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

  it('excludes headings marked only by kind, with no heading level', () => {
    const chapter: { paragraphs: BookParagraph[] } = {
      paragraphs: [{ text: '本文'.repeat(300) }, { text: '見出し'.repeat(200), kind: 'heading' }],
    };
    expect(estimateReadingTime(chapter)).toBe(60_000);
    expect(estimateReadingTime(chapter, { includeHeadings: true })).toBe(120_000);
  });

  it('returns zero for a zero or negative reading rate', () => {
    const chapter = chapterOf(['x'.repeat(1000)]);
    expect(estimateReadingTime(chapter, { charsPerMinute: 0 })).toBe(0);
    expect(estimateReadingTime(chapter, { charsPerMinute: -1 })).toBe(0);
  });
});

describe('isHeadingParagraph', () => {
  it('accepts either heading marker and rejects body paragraphs', () => {
    expect(isHeadingParagraph({ headingLevel: 1 })).toBe(true);
    expect(isHeadingParagraph({ kind: 'heading' })).toBe(true);
    expect(isHeadingParagraph({ headingLevel: 1, kind: 'heading' })).toBe(true);
    expect(isHeadingParagraph({})).toBe(false);
    expect(isHeadingParagraph({ kind: 'blockquote' })).toBe(false);
  });
});

describe('formatReadingTime', () => {
  it('formats Japanese hours/minutes/seconds', () => {
    expect(formatReadingTime(0)).toBe('0秒');
    expect(formatReadingTime(45_000)).toBe('45秒');
    expect(formatReadingTime(125_000)).toBe('2分5秒');
    expect(formatReadingTime(3_660_000)).toBe('1時間1分');
  });

  it('formats with the unit templates of the given message catalog', () => {
    expect(formatReadingTime(60_000, { messages: enMessages })).toBe('1m 0s');
    expect(formatReadingTime(125_000, { messages: enMessages })).toBe('2m 5s');
    expect(formatReadingTime(45_000, { messages: enMessages })).toBe('45s');
    expect(formatReadingTime(3_660_000, { messages: enMessages })).toBe('1h 1m');
    expect(formatReadingTime(120_000, { messages: jaMessages })).toBe('2分');
    expect(
      formatReadingTime(125_000, {
        messages: { ...jaMessages, readingTimeMinutesSeconds: '{minutes}:{seconds}' },
      }),
    ).toBe('2:5');
  });

  it('names the reading rate and the catalog option in the types', () => {
    expectTypeErrors(
      `import { enMessages } from '@libraz/mejiro';
import {
  estimateReadingTime,
  formatReadingTime,
  type FormatReadingTimeOptions,
  type ReadingTimeOptions,
} from '@libraz/mejiro/book';
const rate: ReadingTimeOptions = { charsPerMinute: 400 };
const format: FormatReadingTimeOptions = { messages: enMessages };
formatReadingTime(estimateReadingTime({ paragraphs: [] }, rate), format);
estimateReadingTime({ paragraphs: [] }, { cpm: 400 });
formatReadingTime(0, 'en');`,
      { fails: ['cpm: 400', "formatReadingTime(0, 'en')"] },
    );
  });
});
