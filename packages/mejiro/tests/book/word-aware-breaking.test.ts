/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import type { BookOptions, PageResult } from '../../src/book/types.js';
import type {
  AnalyzerIdentity,
  MorphemeLike,
  TextAnalysis,
  TextAnalyzer,
} from '../../src/types.js';

/**
 * The book layer must not depend on any particular analyzer, so these tests use
 * a hand-written one rather than a real morphological analyzer. It segments on
 * character class alone — digit runs, ASCII letter runs, one code point each for
 * everything else — which is enough to fire the cluster and penalty rules.
 */
interface FakeAnalyzer extends TextAnalyzer {
  /** Every text handed to `analyze`, in call order. */
  readonly calls: string[];
}

/** Matches one morpheme of the fake segmentation, `u`-mode so it is code point safe. */
const TOKEN = /[0-9０-９]+|[A-Za-z]+|[\s\S]/gu;

/**
 * Function words and bound morphemes the fake recognises, by surface. A `Map`
 * rather than an object literal, because the surfaces are the data here and an
 * object would make them identifiers subject to the ASCII naming rule.
 */
const EXTENDED_POS = new Map<string, string>([
  ['は', 'PART_係助詞'],
  ['を', 'PART_格助詞'],
  ['の', 'PART_格助詞'],
  ['が', 'PART_格助詞'],
  ['第', 'PREFIX'],
  ['お', 'PREFIX'],
  ['章', 'SUFFIX'],
  ['人', 'SUFFIX'],
  ['。', 'SYMBOL'],
  ['、', 'SYMBOL'],
]);

function extendedPosOf(surface: string): string {
  if (/^[0-9０-９]+$/u.test(surface)) return 'NOUN_数';
  if (/^[A-Za-z]+$/u.test(surface)) return 'NOUN_固有';
  return EXTENDED_POS.get(surface) ?? 'NOUN';
}

function segment(text: string): MorphemeLike[] {
  const morphemes: MorphemeLike[] = [];
  let start = 0;
  for (const match of text.matchAll(TOKEN)) {
    const surface = match[0];
    const length = [...surface].length;
    const extendedPos = extendedPosOf(surface);
    morphemes.push({
      surface,
      start,
      end: start + length,
      pos: extendedPos.split('_')[0],
      extendedPos,
    });
    start += length;
  }
  return morphemes;
}

function createAnalyzer(
  options: { name?: string; version?: string; throws?: boolean } = {},
): FakeAnalyzer {
  const calls: string[] = [];
  // The same object on both sides, because the contract requires an analyzer's
  // identity to be the one every analysis of its own reports.
  const identity: AnalyzerIdentity = {
    name: options.name ?? 'fake',
    version: options.version ?? '1.0.0',
  };
  return {
    calls,
    identity,
    analyze(text: string): TextAnalysis {
      calls.push(text);
      if (options.throws) throw new Error('analyzer unavailable');
      return {
        text,
        morphemes: segment(text),
        analyzer: identity,
        warnings: [],
      };
    },
    dispose(): void {
      // Nothing native to release.
    },
  };
}

const baseOptions: BookOptions = { fontFamily: 'serif', fontSize: 16 };

/** A paragraph whose digit, prefix/suffix and Latin runs all trip a cluster rule. */
const CHAPTER = {
  paragraphs: [
    { text: '第１２章はABCDEFという名前の物語である。' },
    { text: 'これは二つ目の段落であり、数字も９８７が含まれる。' },
  ],
};

/** Every cached paragraph's break points, as plain arrays for comparison. */
function breakPointsOf(layout: { getSpread(index: number): unknown }): number[][] {
  // Break points live on the render entries, which `snapshot()` exposes without
  // reaching into private state.
  const snapshot = (
    layout as { snapshot(): { paragraphs: { breakPoints: number[] }[] } }
  ).snapshot();
  return snapshot.paragraphs.map((p) => p.breakPoints);
}

/** The text of each line on a page, which is what a break position looks like on screen. */
function pageLineTexts(page: PageResult): string[] {
  return page.lines.map((line) =>
    line.segments.map((segment) => ('text' in segment ? segment.text : '')).join(''),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('word-aware breaking', () => {
  it("never consults the analyzer at the default 'off' stage", async () => {
    const analyzer = createAnalyzer();
    const book = new MejiroBook({ ...baseOptions, analyzer });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });

    const layout = await book.layoutChapter(CHAPTER);

    expect(analyzer.calls).toEqual([]);
    for (const para of layout.getCachedParagraphs()) {
      expect(para.hintClusterIds).toBeUndefined();
      expect(para.hintBreakPenalties).toBeUndefined();
    }
  });

  it("analyses each paragraph once at 'clusters' and emits cluster ids only", async () => {
    const analyzer = createAnalyzer();
    const book = new MejiroBook({ ...baseOptions, analyzer, wordAwareBreaking: 'clusters' });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });

    const layout = await book.layoutChapter(CHAPTER);

    expect(analyzer.calls).toEqual(CHAPTER.paragraphs.map((p) => p.text));
    for (const para of layout.getCachedParagraphs()) {
      expect(para.hintClusterIds).toBeInstanceOf(Uint32Array);
      expect(para.hintClusterIds?.length).toBe(para.text.length);
      // The safe stage adds no penalties, so break positions stay what the
      // character-class rules alone would choose.
      expect(para.hintBreakPenalties).toBeUndefined();
    }
  });

  it("emits both cluster ids and break penalties at 'full'", async () => {
    const analyzer = createAnalyzer();
    const book = new MejiroBook({ ...baseOptions, analyzer, wordAwareBreaking: 'full' });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });

    const layout = await book.layoutChapter(CHAPTER);

    expect(analyzer.calls).toHaveLength(2);
    for (const para of layout.getCachedParagraphs()) {
      expect(para.hintClusterIds).toBeInstanceOf(Uint32Array);
      expect(para.hintBreakPenalties).toBeInstanceOf(Uint8Array);
      expect(para.hintBreakPenalties?.length).toBe(para.text.length);
    }
  });

  it('keeps a hinted cluster off a column boundary', async () => {
    // Seven code points fit a column, which would otherwise cut `ABCDEF` after
    // `C`; the Latin-word cluster pushes the break back to the character before it.
    const paragraphs = [{ text: 'あいうえABCDEFかきくけこ' }];
    const withoutHints = new MejiroBook(baseOptions);
    const withHints = new MejiroBook({
      ...baseOptions,
      analyzer: createAnalyzer(),
      wordAwareBreaking: 'clusters',
    });
    withoutHints.setPageSize({ pageWidth: 400, lineWidth: 70 });
    withHints.setPageSize({ pageWidth: 400, lineWidth: 70 });

    const plain = await withoutHints.layoutChapter({ paragraphs });
    const hinted = await withHints.layoutChapter({ paragraphs });

    expect(breakPointsOf(plain)[0][0]).toBe(6);
    expect(breakPointsOf(hinted)[0][0]).toBe(3);
  });

  it('applies the hints on the image exclusion path too', async () => {
    // The exclusion reflow breaks through its own `computeBreaks` call, on
    // per-column widths rather than a uniform one. If that call did not receive
    // the cached hints, an image would silently undo the clustering — a
    // divergence that only appears once something reflows.
    const paragraphs = [{ text: 'あいうえABCDEFかきくけこさしすせそ'.repeat(4) }];
    const image = [{ x: 10, y: 0, w: 40, h: 200, margin: 0 }];

    const plainBook = new MejiroBook(baseOptions);
    const hintedBook = new MejiroBook({
      ...baseOptions,
      analyzer: createAnalyzer(),
      wordAwareBreaking: 'clusters',
    });
    plainBook.setPageSize({ pageWidth: 200, lineWidth: 120 });
    hintedBook.setPageSize({ pageWidth: 200, lineWidth: 120 });

    const plain = await plainBook.layoutChapter({ paragraphs });
    const hinted = await hintedBook.layoutChapter({ paragraphs });
    plain.setImages(0, image);
    hinted.setImages(0, image);

    const plainLines = pageLineTexts(plain.getSpread(0).right);
    const hintedLines = pageLineTexts(hinted.getSpread(0).right);

    expect(plain.getSpread(0).right.hasImages).toBe(true);
    expect(hinted.getSpread(0).right.hasImages).toBe(true);
    expect(hintedLines).not.toEqual(plainLines);
    // No reflowed line ends part-way through the Latin word.
    for (const line of hintedLines.slice(0, -1)) {
      expect(line).not.toMatch(/[A-E]$/u);
    }
  });

  it('replays the analysis on every re-break instead of redoing it', async () => {
    const analyzer = createAnalyzer();
    const book = new MejiroBook({ ...baseOptions, analyzer, wordAwareBreaking: 'full' });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });
    const layout = await book.layoutChapter(CHAPTER);
    const initialBreaks = breakPointsOf(layout);
    expect(analyzer.calls).toHaveLength(2);

    // A resize re-breaks every paragraph at the new width.
    layout.resize({ lineWidth: 90 });
    expect(breakPointsOf(layout)).not.toEqual(initialBreaks);

    // So does an image exclusion reflow, on the other `computeBreaks` path.
    layout.setImages(0, [{ x: 20, y: 10, w: 60, h: 60, margin: 0 }]);
    expect(layout.getSpread(0).right.hasImages).toBe(true);

    // And so does a font change, which re-measures before re-breaking.
    await book.setOptions({ fontSize: 24 });
    expect(layout.getSpread(0)).toBeDefined();

    expect(analyzer.calls).toHaveLength(2);
    for (const para of layout.getCachedParagraphs()) {
      expect(para.hintClusterIds).toBeInstanceOf(Uint32Array);
      expect(para.hintBreakPenalties).toBeInstanceOf(Uint8Array);
    }
  });

  it('takes a paragraph that carries its own hints at its word', async () => {
    const analyzer = createAnalyzer();
    const book = new MejiroBook({ ...baseOptions, analyzer, wordAwareBreaking: 'clusters' });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });

    // One cluster binding the first three code points together.
    const clusterIds = Uint32Array.from({ length: 8 }, (_, i) => (i < 3 ? 0 : i));
    const layout = await book.layoutChapter({
      paragraphs: [{ text: 'あいうえおかきく', hints: { clusterIds } }, { text: '第１２章です。' }],
    });

    expect(analyzer.calls).toEqual(['第１２章です。']);
    expect(layout.getCachedParagraphs()[0].hintClusterIds).toBe(clusterIds);
  });

  it('lays the chapter out anyway when the analyzer throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const analyzer = createAnalyzer({ throws: true });
    const book = new MejiroBook({ ...baseOptions, analyzer, wordAwareBreaking: 'full' });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });

    const layout = await book.layoutChapter(CHAPTER);

    expect(layout.totalPages).toBeGreaterThan(0);
    expect(layout.getSpread(0).right.lines.length).toBeGreaterThan(0);
    for (const para of layout.getCachedParagraphs()) {
      expect(para.hintClusterIds).toBeUndefined();
      expect(para.hintBreakPenalties).toBeUndefined();
    }
    // Degraded, not silent — and reported once rather than once per paragraph.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('round-trips hints through a snapshot restored by the same analyzer', async () => {
    const book = new MejiroBook({
      ...baseOptions,
      analyzer: createAnalyzer(),
      wordAwareBreaking: 'full',
      breakCost: { penaltyWeight: 2 },
    });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });
    const layout = await book.layoutChapter(CHAPTER);
    const snapshot = layout.snapshot();

    expect(snapshot.config.analyzer).toEqual({ name: 'fake', version: '1.0.0' });
    expect(snapshot.config.breakCost).toEqual({ penaltyWeight: 2 });
    expect(snapshot.paragraphs[0].hintClusterIds).toHaveLength(CHAPTER.paragraphs[0].text.length);
    expect(snapshot.paragraphs[0].hintBreakPenalties).toBeDefined();

    const restoring = createAnalyzer();
    const fresh = new MejiroBook({
      ...baseOptions,
      analyzer: restoring,
      wordAwareBreaking: 'full',
      breakCost: { penaltyWeight: 2 },
    });
    const restored = fresh.layoutFromSnapshot(snapshot);

    // Nothing was analysed: the identities were compared, not re-derived.
    expect(restoring.calls).toEqual([]);
    expect(restored.getCachedParagraphs()[0].hintBreakPenalties).toEqual(
      layout.getCachedParagraphs()[0].hintBreakPenalties,
    );

    // The decisive property: re-breaking both at the same new width agrees.
    layout.resize({ lineWidth: 90 });
    restored.resize({ lineWidth: 90 });
    expect(breakPointsOf(restored)).toEqual(breakPointsOf(layout));
  });

  it('drops hints when the restoring book has a different analyzer', async () => {
    const book = new MejiroBook({
      ...baseOptions,
      analyzer: createAnalyzer({ name: 'alpha', version: '1.0.0' }),
      wordAwareBreaking: 'clusters',
    });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });
    const snapshot = (await book.layoutChapter(CHAPTER)).snapshot();

    const other = createAnalyzer({ name: 'beta', version: '2.0.0' });
    const fresh = new MejiroBook({
      ...baseOptions,
      analyzer: other,
      wordAwareBreaking: 'clusters',
    });
    const restored = fresh.layoutFromSnapshot(snapshot);

    // Dropped, not re-derived: nothing was analysed at all.
    expect(other.calls).toEqual([]);
    for (const para of restored.getCachedParagraphs()) {
      expect(para.hintClusterIds).toBeUndefined();
    }
    // A snapshot of the restored layout no longer claims an analysis it lost.
    expect(restored.snapshot().config.analyzer).toBeUndefined();
    // The restored break points are the snapshot's own and are unaffected.
    expect(restored.snapshot().paragraphs.map((p) => p.breakPoints)).toEqual(
      snapshot.paragraphs.map((p) => p.breakPoints),
    );
  });

  it('never wakes an analyzer when restoring a snapshot that carries no hints', async () => {
    const book = new MejiroBook(baseOptions);
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });
    const snapshot = (await book.layoutChapter(CHAPTER)).snapshot();

    const analyzer = createAnalyzer();
    const fresh = new MejiroBook({ ...baseOptions, analyzer, wordAwareBreaking: 'full' });
    expect(fresh.layoutFromSnapshot(snapshot).totalPages).toBeGreaterThan(0);
    expect(analyzer.calls).toEqual([]);
  });
});
