import { describe, expect, it } from 'vitest';
import { getLineRanges, paginate } from '../src/paginate.js';

describe('paginate', () => {
  it('fits all lines on one page when content is small', () => {
    const pages = paginate(100, [{ lineCount: 3, linePitch: 20, gapBefore: 0 }]);
    expect(pages).toEqual([[{ paragraphIndex: 0, lineStart: 0, lineEnd: 3 }]]);
  });

  it('splits across pages when content exceeds page size', () => {
    const pages = paginate(100, [{ lineCount: 8, linePitch: 20, gapBefore: 0 }]);
    // 5 lines × 20 = 100 fits, 6th would exceed
    expect(pages).toEqual([
      [{ paragraphIndex: 0, lineStart: 0, lineEnd: 5 }],
      [{ paragraphIndex: 0, lineStart: 5, lineEnd: 8 }],
    ]);
  });

  it('accounts for paragraph gaps', () => {
    const pages = paginate(100, [
      { lineCount: 3, linePitch: 20, gapBefore: 0 },
      { lineCount: 3, linePitch: 20, gapBefore: 10 },
    ]);
    // Para 0: 3 × 20 = 60
    // Para 1: 10 (gap) + 20 = 90. Next: 90 + 20 = 110 > 100
    expect(pages).toEqual([
      [
        { paragraphIndex: 0, lineStart: 0, lineEnd: 3 },
        { paragraphIndex: 1, lineStart: 0, lineEnd: 1 },
      ],
      [{ paragraphIndex: 1, lineStart: 1, lineEnd: 3 }],
    ]);
  });

  it('skips gap at page start', () => {
    const pages = paginate(60, [
      { lineCount: 3, linePitch: 20, gapBefore: 0 },
      { lineCount: 3, linePitch: 20, gapBefore: 10 },
    ]);
    // Page 1: 3 × 20 = 60 (full)
    // Page 2: gap skipped at start, 3 × 20 = 60
    expect(pages).toEqual([
      [{ paragraphIndex: 0, lineStart: 0, lineEnd: 3 }],
      [{ paragraphIndex: 1, lineStart: 0, lineEnd: 3 }],
    ]);
  });

  it('handles heading with different linePitch', () => {
    const pages = paginate(100, [
      { lineCount: 1, linePitch: 30, gapBefore: 0 },
      { lineCount: 5, linePitch: 20, gapBefore: 15 },
    ]);
    // Heading: 30
    // Body: 15 (gap) + 20 = 65. Next: 65 + 20 = 85. Next: 85 + 20 = 105 > 100
    expect(pages).toEqual([
      [
        { paragraphIndex: 0, lineStart: 0, lineEnd: 1 },
        { paragraphIndex: 1, lineStart: 0, lineEnd: 2 },
      ],
      [{ paragraphIndex: 1, lineStart: 2, lineEnd: 5 }],
    ]);
  });

  it('returns one empty page for no paragraphs', () => {
    expect(paginate(100, [])).toEqual([[]]);
  });
});

describe('getLineRanges', () => {
  it('returns a single range for no break points', () => {
    expect(getLineRanges(new Uint32Array([]), 5)).toEqual([[0, 5]]);
  });

  it('splits at break points', () => {
    expect(getLineRanges(new Uint32Array([3, 7]), 10)).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ]);
  });

  it('returns empty array for zero characters', () => {
    expect(getLineRanges(new Uint32Array([]), 0)).toEqual([]);
  });
});
