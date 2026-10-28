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

describe('snapshot boundary validation', () => {
  /** A copy of {@link SNAPSHOT} with its first paragraph patched. */
  function withParagraph(patch: Record<string, unknown>): ChapterLayoutSnapshot {
    const copy = structuredClone(SNAPSHOT);
    Object.assign(copy.paragraphs[0], patch);
    return copy;
  }

  /** A copy of {@link SNAPSHOT} with its config patched. */
  function withConfig(patch: Record<string, unknown>): ChapterLayoutSnapshot {
    const copy = structuredClone(SNAPSHOT);
    Object.assign(copy.config, patch);
    return copy;
  }

  /** The error `layoutFromSnapshot` throws for `snapshot`, which must be one. */
  function restoreError(snapshot: unknown): Error {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    try {
      book.layoutFromSnapshot(snapshot as ChapterLayoutSnapshot);
    } catch (error) {
      return error as Error;
    }
    throw new Error('layoutFromSnapshot accepted the snapshot');
  }

  it('rejects a malformed snapshot with a descriptive error, never an incidental one', () => {
    const { paragraphs: _, ...withoutParagraphs } = SNAPSHOT;
    const cases: unknown[] = [
      null,
      withoutParagraphs,
      { ...SNAPSHOT, config: { ...SNAPSHOT.config, fontSize: Number.NaN } },
      { ...SNAPSHOT, size: { ...SNAPSHOT.size, lineWidth: -1 } },
      withParagraph({ advances: SNAPSHOT.paragraphs[0].advances.slice(1) }),
      withParagraph({ advances: [null, ...SNAPSHOT.paragraphs[0].advances.slice(1)] }),
      withParagraph({ advances: undefined }),
      withParagraph({ breakPoints: [6, 3] }),
      withParagraph({ breakPoints: [10] }),
      withParagraph({ breakPoints: [1.5] }),
      withParagraph({ inlineAnnotations: [{ kind: 'em', startIndex: 8, endIndex: 12 }] }),
      withParagraph({
        layoutRubyAnnotations: [
          { startIndex: 9, endIndex: 11, rubyText: [12354], rubyAdvances: [8] },
        ],
      }),
      withParagraph({
        layoutRubyAnnotations: [
          { startIndex: 0, endIndex: 1, rubyText: [12354], rubyAdvances: [] },
        ],
      }),
      withParagraph({ hintClusterIds: [0, 1] }),
      { ...SNAPSHOT, images: [{ spreadIndex: 0, images: [{ x: 0, y: 0, w: Number.NaN, h: 1 }] }] },
      // Decomposed kana: restore would build 2 codepoints beside 3 characters.
      withParagraph({ text: 'か\u3099あ', advances: [16, 16, 16], breakPoints: [] }),
      withParagraph({ headingLevel: 7 }),
      withParagraph({ kind: 'banner' }),
      withConfig({ headingStyles: { 1: { scale: {} } } }),
      withConfig({ headingStyles: { 1: { scale: Number.NaN } } }),
      withConfig({ headingStyles: { 1: { gapAfterEm: -1 } } }),
      withConfig({ headingStyles: { 1: null } }),
      withConfig({ breakCost: { shortfallWeight: Number.NaN } }),
      withConfig({ breakCost: 'heavy' }),
      withConfig({ analyzer: { name: 'a' } }),
    ];
    for (const snapshot of cases) {
      const error = restoreError(snapshot);
      expect(error.constructor).toBe(Error);
      expect(error.message).toMatch(/^Malformed ChapterLayoutSnapshot: /);
    }
  });

  it('accepts sizing fields that are finite and a snapshot of an NFC paragraph', () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const snapshot = withConfig({
      headingStyles: { 1: { scale: 1.6, gapAfterEm: 0 } },
      breakCost: { penaltyWeight: 1, shortfallWeight: 1.5, maxBacktrackChars: 6 },
      analyzer: { name: 'a', version: '1' },
    });
    snapshot.paragraphs[0].headingLevel = 1;
    snapshot.paragraphs[0].kind = 'heading';
    const layout = book.layoutFromSnapshot(snapshot);
    expect(layout.snapshot().config.headingStyles).toEqual({ 1: { scale: 1.6, gapAfterEm: 0 } });
  });

  it('rejects an unsupported version', () => {
    expect(restoreError({ ...SNAPSHOT, version: 3 }).message).toBe(
      'Unsupported ChapterLayoutSnapshot version: 3',
    );
  });

  it('accepts a well-formed snapshot that went through JSON', () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const layout = book.layoutFromSnapshot(JSON.parse(JSON.stringify(SNAPSHOT)));
    expect(layout.snapshot().paragraphs[0].breakPoints).toEqual([5]);
  });
});
