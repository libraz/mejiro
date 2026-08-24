import { describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import type { ChapterLayoutSnapshot } from '../../src/book/snapshot.js';

// No `@vitest-environment` docblock: this file runs on bare Node, so any DOM
// access on the construction or replay path fails it.

const SNAPSHOT: ChapterLayoutSnapshot = {
  version: 2,
  config: {
    fontSize: 16,
    lineSpacing: 1.8,
    headingScale: 1.4,
    mode: 'strict',
    enableHanging: true,
  },
  size: { pageWidth: 400, lineWidth: 80, pagePaddingX: 0, pagePaddingY: 0 },
  paragraphs: [
    {
      text: 'あいうえおかきくけこ',
      advances: Array.from({ length: 10 }, () => 16),
      breakPoints: [5],
      inlineAnnotations: [],
    },
  ],
};

describe('server-side layout replay', () => {
  it('constructs a book and replays a snapshot without a DOM', () => {
    expect(typeof document).toBe('undefined');

    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const layout = book.layoutFromSnapshot(SNAPSHOT);

    expect(layout.totalPages).toBeGreaterThan(0);
    expect(layout.getPage(0).slots.length).toBeGreaterThan(0);
    expect(layout.snapshot().size.lineWidth).toBe(80);
  });
});
