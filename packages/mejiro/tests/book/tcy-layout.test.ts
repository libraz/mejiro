/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import type { ChapterLayout } from '../../src/book/chapter-layout.js';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import type { BookImage, BookParagraph } from '../../src/book/types.js';

/**
 * The stub canvas gives every character 10px regardless of font size, so a
 * three-character tcy span measures 30px on its own and one em is the book's
 * `fontSize`. That gap is what every assertion below observes.
 */
const TCY_START = 2;
const TCY_END = 5;

function paragraph(withTcy: boolean): BookParagraph {
  return {
    text: '昭和五十六年に刊行された作品である',
    inlineAnnotations: withTcy ? [{ kind: 'tcy', startIndex: TCY_START, endIndex: TCY_END }] : [],
  };
}

async function layoutChapter(options: {
  lineWidth: number;
  fontSize?: number;
  withTcy?: boolean;
}): Promise<{ book: MejiroBook; layout: ChapterLayout }> {
  const book = new MejiroBook({ fontFamily: 'serif', fontSize: options.fontSize ?? 16 });
  book.setPageSize({ pageWidth: 400, lineWidth: options.lineWidth });
  const layout = await book.layoutChapter({
    paragraphs: [paragraph(options.withTcy ?? true)],
  });
  return { book, layout };
}

/** Break points of the only paragraph, read back through the snapshot. */
function breakPoints(layout: ChapterLayout): number[] {
  return layout.snapshot().paragraphs[0].breakPoints;
}

/** Whether any break falls strictly inside the combined box. */
function splitsSpan(points: readonly number[]): boolean {
  return points.some((bp) => bp >= TCY_START && bp <= TCY_END - 2);
}

/** Line index each character of the span resolves to in the current layout. */
function spanLineIndices(layout: ChapterLayout): (number | null)[] {
  const lines: (number | null)[] = [];
  for (let charIndex = TCY_START; charIndex < TCY_END; charIndex++) {
    lines.push(layout.locateAnchor({ paragraph: 0, charIndex })?.lineIdx ?? null);
  }
  return lines;
}

const IMAGES: BookImage[] = [{ x: 40, y: 0, w: 120, h: 18, margin: 4 }];

describe('tate-chu-yoko in the book layout', () => {
  it('reserves one em for the span and keeps it on one line', async () => {
    const { layout } = await layoutChapter({ lineWidth: 45 });
    const control = await layoutChapter({ lineWidth: 45, withTcy: false });

    expect(splitsSpan(breakPoints(layout))).toBe(false);
    // Without the annotation the same geometry does split there, so the
    // assertion above is about the cluster and not about the line width.
    expect(splitsSpan(breakPoints(control.layout))).toBe(true);

    const advances = layout.snapshot().paragraphs[0].advances;
    // Snapshot advances are the measured ones; the reserved extent is what the
    // breaker used, and it shows up as the span fitting where 30px would not.
    expect(advances.slice(TCY_START, TCY_END)).toEqual([10, 10, 10]);
  });

  it('breaks the same after a resize as it does when laid out at that width', async () => {
    const fresh = await layoutChapter({ lineWidth: 45 });
    const resized = await layoutChapter({ lineWidth: 100 });

    resized.layout.resize({ lineWidth: 45 });

    expect(breakPoints(resized.layout)).toEqual(breakPoints(fresh.layout));
    expect(splitsSpan(breakPoints(resized.layout))).toBe(false);
  });

  it('breaks the same after a font-size change as it does when laid out at that size', async () => {
    // 38px of column is narrow enough that a 16px box and a 20px box choose
    // different break positions, so a stale box width would show up here.
    const fresh = await layoutChapter({ lineWidth: 38, fontSize: 16 });
    const changed = await layoutChapter({ lineWidth: 38, fontSize: 20 });
    const before = breakPoints(changed.layout);

    await changed.book.setOptions({ fontSize: 16 });

    expect(breakPoints(changed.layout)).toEqual(breakPoints(fresh.layout));
    expect(breakPoints(changed.layout)).not.toEqual(before);
  });

  it('keeps the span on one line after image exclusion reflows the columns', async () => {
    const { layout } = await layoutChapter({ lineWidth: 45 });
    const control = await layoutChapter({ lineWidth: 45, withTcy: false });

    layout.setImages(0, IMAGES);
    control.layout.setImages(0, IMAGES);

    const lines = spanLineIndices(layout);
    expect(lines[0]).not.toBeNull();
    expect(new Set(lines).size).toBe(1);
    // The same image on the unannotated paragraph does spread the characters
    // over more than one line.
    expect(new Set(spanLineIndices(control.layout)).size).toBeGreaterThan(1);
  });

  it('restores the same break points from a snapshot', async () => {
    const { layout } = await layoutChapter({ lineWidth: 45 });
    const snapshot = layout.snapshot();
    expect(snapshot.paragraphs[0].layoutTcyAnnotations).toEqual([
      { startIndex: TCY_START, endIndex: TCY_END, advance: 16 },
    ]);

    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const restored = book.layoutFromSnapshot(snapshot);
    // A resize forces a re-break from the restored cache alone.
    restored.resize({ lineWidth: 100 });
    restored.resize({ lineWidth: 45 });

    expect(breakPoints(restored)).toEqual(breakPoints(layout));
  });
});
