import { describe, expect, it, vi } from 'vitest';
import { type CachedParagraph, ChapterLayout } from '../../src/book/chapter-layout.js';
import { computeBreaks } from '../../src/layout.js';
import type { RenderEntry } from '../../src/render/types.js';
import { toCodepoints, uniformAdvances } from '../helpers.js';

const counters = vi.hoisted(() => ({ buildRenderPage: 0, breakChars: 0 }));

vi.mock('../../src/layout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/layout.js')>();
  return {
    ...actual,
    computeBreaks: (input: Parameters<typeof actual.computeBreaks>[0]) => {
      counters.breakChars += input.text.length;
      return actual.computeBreaks(input);
    },
  };
});

vi.mock('../../src/render/page.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/page.js')>();
  return {
    ...actual,
    buildRenderPage: (...args: Parameters<typeof actual.buildRenderPage>) => {
      counters.buildRenderPage++;
      return actual.buildRenderPage(...args);
    },
  };
});

/**
 * Builds a layout of `paragraphCount` paragraphs of `charsPerParagraph`
 * characters each, measured at 10px per character.
 *
 * With lineWidth 100 and pageWidth 100 this gives 10 characters per line and
 * 10 lines per page, so page boundaries are easy to reason about.
 */
function makeLayout(paragraphCount: number, charsPerParagraph: number): ChapterLayout {
  const text = 'あ'.repeat(charsPerParagraph);
  const codepoints = toCodepoints(text);
  const chars = [...text];
  const advances = uniformAdvances(codepoints.length, 10);
  const breakPoints = computeBreaks({ text: codepoints, advances, lineWidth: 100 }).breakPoints;

  const cached: CachedParagraph[] = [];
  const entries: RenderEntry[] = [];
  for (let i = 0; i < paragraphCount; i++) {
    cached.push({ text: codepoints, advances, chars, inlineAnnotations: [] });
    entries.push({ chars, breakPoints, inlineAnnotations: [] });
  }

  return new ChapterLayout(
    cached,
    entries,
    { fontSize: 10, lineSpacing: 1, headingScale: 1.4, mode: 'strict', enableHanging: true },
    { pageWidth: 100, lineWidth: 100, pagePaddingX: 0, pagePaddingY: 0 },
  );
}

/**
 * Builds a book-sized chapter of `totalChars` characters in 200-character
 * paragraphs, on demo-like geometry: 400px pages, 600px columns, 16px text.
 */
function makeBookLayout(totalChars: number): ChapterLayout {
  const perParagraph = 200;
  const text = 'あ'.repeat(perParagraph);
  const codepoints = toCodepoints(text);
  const chars = [...text];
  const advances = uniformAdvances(codepoints.length, 16);
  const breakPoints = computeBreaks({ text: codepoints, advances, lineWidth: 600 }).breakPoints;

  const cached: CachedParagraph[] = [];
  const entries: RenderEntry[] = [];
  for (let i = 0; i < totalChars / perParagraph; i++) {
    cached.push({ text: codepoints, advances, chars, inlineAnnotations: [] });
    entries.push({ chars, breakPoints, inlineAnnotations: [] });
  }

  return new ChapterLayout(
    cached,
    entries,
    { fontSize: 16, lineSpacing: 1.9, headingScale: 1.4, mode: 'strict', enableHanging: true },
    { pageWidth: 400, lineWidth: 600, pagePaddingX: 40, pagePaddingY: 40 },
  );
}

/** Median elapsed milliseconds of five image moves, as during a drag. */
function medianDragMs(layout: ChapterLayout): number {
  layout.syncImages(0, [{ x: 100, y: 40, w: 120, h: 160 }]);
  const samples = [60, 80, 100, 120, 140].map((y) => {
    const started = performance.now();
    layout.syncImages(0, [{ x: 100, y, w: 120, h: 160 }]);
    return performance.now() - started;
  });
  return samples.sort((a, b) => a - b)[2];
}

/** Characters fed to `computeBreaks` by five image moves, as during a drag. */
function dragBreakChars(layout: ChapterLayout): number {
  layout.syncImages(0, [{ x: 100, y: 40, w: 120, h: 160 }]);
  counters.breakChars = 0;
  for (const y of [60, 80, 100, 120, 140]) {
    layout.syncImages(0, [{ x: 100, y, w: 120, h: 160 }]);
  }
  return counters.breakChars;
}

describe('image reflow cost', () => {
  it('reflows a book-length chapter within a frame budget', () => {
    // The frame budget is 16.7ms; the bound is loosened for slower machines.
    expect(medianDragMs(makeBookLayout(80_000))).toBeLessThan(50);
  }, 30_000);

  it('scales with the line count rather than the character count', () => {
    // Counting the characters fed to computeBreaks measures the same blow-up
    // as wall-clock time, without depending on how loaded the machine is.
    const small = dragBreakChars(makeBookLayout(40_000));
    const large = dragBreakChars(makeBookLayout(80_000));

    expect(small).toBeGreaterThan(0);
    // Twice the text must not cost dramatically more than twice the work.
    expect(large).toBeLessThan(small * 3);
  }, 30_000);
});

describe('selectionRects cost', () => {
  it('builds each page it crosses exactly once', () => {
    const layout = makeLayout(50, 100);
    // Warm the pagination cache so only the rect pass is measured.
    expect(layout.totalPages).toBeGreaterThan(10);

    counters.buildRenderPage = 0;
    const rects = layout.selectionRects({
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 9, charIndex: 100 },
    });

    const pagesSpanned = new Set(rects.map((r) => r.pageIdx)).size;
    expect(pagesSpanned).toBeGreaterThan(1);
    expect(counters.buildRenderPage).toBe(pagesSpanned);
    // One rectangle per line, never one per character.
    expect(rects).toHaveLength(100);
  });

  it('does not grow with the page depth of the range', () => {
    const layout = makeLayout(200, 100);
    expect(layout.totalPages).toBeGreaterThan(100);

    counters.buildRenderPage = 0;
    const started = performance.now();
    const deep = layout.selectionRects({
      start: { paragraph: 180, charIndex: 0 },
      end: { paragraph: 189, charIndex: 100 },
    });
    const elapsed = performance.now() - started;

    const pagesSpanned = new Set(deep.map((r) => r.pageIdx)).size;
    expect(counters.buildRenderPage).toBe(pagesSpanned);
    expect(deep).toHaveLength(100);
    expect(elapsed).toBeLessThan(50);
  });
});
