/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterLayout } from '../../src/book/chapter-layout.js';
import { DEFAULT_HEADING_STYLES } from '../../src/book/constants.js';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import type { BookOptions } from '../../src/book/types.js';
import { toFontSpec } from '../../src/browser/types.js';
import { manuscriptParagraphs, parseInlineImageMarker } from '../../src/epub/manuscript-source.js';
import { parseManuscript } from '../../src/manuscript.js';

const breakCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../src/layout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/layout.js')>();
  return {
    ...actual,
    computeBreaks: (input: Parameters<typeof actual.computeBreaks>[0]) => {
      breakCalls.count++;
      return actual.computeBreaks(input);
    },
  };
});

const baseOptions: BookOptions = {
  fontFamily: 'serif',
  fontSize: 16,
};

describe('MejiroBook', () => {
  let book: MejiroBook;
  beforeEach(() => {
    book = new MejiroBook(baseOptions);
  });

  it('layoutChapter throws when setPageSize has not been called', async () => {
    await expect(book.layoutChapter({ paragraphs: [] })).rejects.toThrow(
      'Page size not set. Call setPageSize() first.',
    );
  });

  it('getOptions returns defaults filled in for omitted fields', () => {
    const opts = book.getOptions();
    expect(opts.fontFamily).toBe('serif');
    expect(opts.fontSize).toBe(16);
    expect(opts.lineSpacing).toBe(1.8);
    expect(opts.mode).toBe('strict');
    expect(opts.enableHanging).toBe(true);
    expect(opts.headingScale).toBe(1.4);
  });

  it('getOptions reports construction-time options and setOptions leaves them as built', async () => {
    const analyzer = { identity: { name: 'a', version: '1' }, analyze: () => ({ morphemes: [] }) };
    const built = new MejiroBook({
      ...baseOptions,
      analyzer: analyzer as unknown as BookOptions['analyzer'],
      wordAwareBreaking: 'clusters',
      keepWholePos: ['名詞'],
      keepWholePenalty: 3,
      breakCost: { shortfallWeight: 2 },
    });
    expect(built.getOptions()).toMatchObject({
      analyzer,
      wordAwareBreaking: 'clusters',
      keepWholePos: ['名詞'],
      keepWholePenalty: 3,
      breakCost: { shortfallWeight: 2 },
    });

    await built.setOptions({
      analyzer: undefined,
      wordAwareBreaking: 'full',
      keepWholePos: ['動詞'],
      keepWholePenalty: 1,
      breakCost: { shortfallWeight: 9 },
    });
    expect(built.getOptions()).toMatchObject({
      analyzer,
      wordAwareBreaking: 'clusters',
      keepWholePos: ['名詞'],
      keepWholePenalty: 3,
      breakCost: { shortfallWeight: 2 },
    });
    expect(new MejiroBook(baseOptions).getOptions().wordAwareBreaking).toBe('off');
  });

  it('provides default heading styles for h1 through h6', () => {
    expect(DEFAULT_HEADING_STYLES[1]).toEqual({ scale: 1.6, gapAfterEm: 1.4 });
    expect(DEFAULT_HEADING_STYLES[5]).toEqual({ scale: 1.0, gapAfterEm: 0.6 });
    expect(DEFAULT_HEADING_STYLES[6]).toEqual({ scale: 1.0, gapAfterEm: 0.6 });
  });

  it('setOptions patches only provided fields', async () => {
    // fontSize needs re-measurement, so the patch lands once the font resolves.
    await book.setOptions({ fontSize: 24, mode: 'loose' });
    const opts = book.getOptions();
    expect(opts.fontSize).toBe(24);
    expect(opts.mode).toBe('loose');
    // Untouched fields keep their previous value
    expect(opts.fontFamily).toBe('serif');
    expect(opts.enableHanging).toBe(true);
  });

  it('setPageSize fills pagePaddingX/Y with zero when omitted', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    // Empty chapter still resolves now that the page is sized
    const layout = await book.layoutChapter({ paragraphs: [] });
    expect(layout).toBeDefined();
  });

  it('computePageSize honours minimum sizes and computes lineWidth', () => {
    // happy-dom containers have 0 dimensions → minimum clamps apply.
    const container = document.createElement('div');
    const dims = book.computePageSize(container);
    expect(dims.pageWidth).toBeGreaterThanOrEqual(280);
    expect(dims.pageHeight).toBeGreaterThanOrEqual(400);
    expect(dims.contentHeight).toBeGreaterThan(0);
  });

  it('computePageSize honours custom min/max overrides', () => {
    const container = document.createElement('div');
    const dims = book.computePageSize(container, {
      minWidth: 200,
      minHeight: 300,
      aspect: 1.6,
    });
    expect(dims.pageWidth).toBe(200);
    expect(dims.pageHeight).toBe(300);
  });

  it('computePageSize gives a single-page reader the full container width', () => {
    // Portrait-ish container where a two-page spread would be width-bound and
    // therefore halved. A single page should instead fill the width.
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true });

    const double = book.computePageSize(container); // columns defaults to 2
    const single = book.computePageSize(container, { columns: 1 });

    // Two-page spread is halved (width-bound, then clamped up to the 280 min);
    // a single page is height-bound and ends up markedly wider.
    expect(double.pageWidth).toBe(280);
    expect(single.pageWidth).toBe(538);
    expect(single.pageWidth).toBeGreaterThan(double.pageWidth);
  });

  describe('computePageSize padding', () => {
    /**
     * A surface whose computed style carries the reader's page-padding
     * properties. They are set on the surface itself because happy-dom does
     * not inherit custom properties into computed style; browsers do.
     */
    function surfaceWithin(vars: Record<string, string>): HTMLElement {
      const surface = document.createElement('div');
      for (const [name, value] of Object.entries(vars)) surface.style.setProperty(name, value);
      Object.defineProperty(surface, 'clientWidth', { value: 1200, configurable: true });
      Object.defineProperty(surface, 'clientHeight', { value: 700, configurable: true });
      document.body.append(surface);
      return surface;
    }

    async function laidOutPadding(): Promise<{ x: number; y: number }> {
      const { size } = (await book.layoutChapter({ paragraphs: [] })).snapshot();
      return { x: size.pagePaddingX ?? 0, y: size.pagePaddingY ?? 0 };
    }

    it('lays out for the padding the reader stylesheet draws', async () => {
      const surface = surfaceWithin({
        '--mejiro-page-pad-x': '28px',
        '--mejiro-page-pad-y': '40px',
        '--mejiro-page-pad-bottom': '30px',
      });
      const dims = book.computePageSize(surface);

      expect(dims.contentHeight).toBe(dims.pageHeight - 40 - 30);
      expect(await laidOutPadding()).toEqual({ x: 28, y: 40 });
    });

    it('prefers padding passed in options over the stylesheet', async () => {
      const surface = surfaceWithin({
        '--mejiro-page-pad-x': '28px',
        '--mejiro-page-pad-y': '40px',
      });
      book.computePageSize(surface, { padding: { x: 12, y: 16 } });

      expect(await laidOutPadding()).toEqual({ x: 12, y: 16 });
    });

    it('falls back to the default padding without the stylesheet', async () => {
      const dims = book.computePageSize(surfaceWithin({}));

      expect(dims.contentHeight).toBe(dims.pageHeight - 56 - 40);
      expect(await laidOutPadding()).toEqual({ x: 52, y: 56 });
    });
  });

  it('clearCache(spec) drops that font only and clearCache() drops all', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });
    await book.setOptions({ fontSize: 32 });
    const before = book.cacheStats();
    expect(before.fonts).toBe(2);

    book.clearCache(toFontSpec('serif', 16));
    const after = book.cacheStats();
    expect(after.fonts).toBe(1);
    expect(after.codepoints).toBeLessThan(before.codepoints);
    expect(after.codepoints).toBeGreaterThan(0);

    book.clearCache();
    expect(book.cacheStats()).toEqual({ fonts: 0, codepoints: 0 });
  });

  it('cacheStats reports zero on a fresh book and grows with layouts', async () => {
    expect(book.cacheStats()).toEqual({ fonts: 0, codepoints: 0 });
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });
    const stats = book.cacheStats();
    expect(stats.fonts).toBeGreaterThan(0);
    expect(stats.codepoints).toBeGreaterThan(0);
    book.clearCache();
    expect(book.cacheStats()).toEqual({ fonts: 0, codepoints: 0 });
  });

  it('carries paragraph kinds through to the render page', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({
      paragraphs: [
        { text: '見出し', kind: 'heading', headingLevel: 2 },
        { text: '引用文です', kind: 'blockquote' },
        { text: '＊＊＊', kind: 'sceneBreak' },
        { text: 'const x = 1;', kind: 'pre' },
        { text: '図版キャプション', kind: 'figure' },
      ],
    });

    const { page } = layout.getSpread(0).right;
    expect(page.paragraphs.map((p) => p.kind)).toEqual([
      'heading',
      'blockquote',
      'sceneBreak',
      'pre',
      'figure',
    ]);
  });

  it('setOptions propagates lineSpacing changes to live layouts', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({
      paragraphs: [{ text: 'あいうえお' }, { text: 'かきくけこ' }],
    });
    const beforeSlots = layout.getSpread(0).right.slots.map((s) => s.xPos);
    expect(layout.snapshot().config.lineSpacing).toBe(1.8);

    await book.setOptions({ lineSpacing: 3.0 });

    expect(layout.snapshot().config.lineSpacing).toBe(3);
    const afterSlots = layout.getSpread(0).right.slots.map((s) => s.xPos);
    expect(afterSlots).toHaveLength(beforeSlots.length);
    expect(afterSlots).not.toEqual(beforeSlots);
  });

  it('setOptions propagates fontSize changes by re-measuring live layouts', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });
    const beforeStats = book.cacheStats();
    await book.setOptions({ fontSize: 32 });
    const afterStats = book.cacheStats();
    // A new font size means a new fontSpec key in the cache.
    expect(afterStats.fonts).toBeGreaterThan(beforeStats.fonts);
    // Layout still serves data after the propagation completes.
    expect(layout.getSpread(0)).toBeDefined();
  });

  it('setOptions re-breaks a live layout once, on its next read', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });
    // biome-ignore lint/suspicious/noExplicitAny: private method spy verifies an internal regression.
    const rebreak = vi.spyOn(layout as any, 'breakEntries');

    await book.setOptions({ fontSize: 32 });
    expect(rebreak).not.toHaveBeenCalled();

    layout.getSpread(0);
    layout.getSpread(0);
    expect(rebreak).toHaveBeenCalledTimes(1);
  });

  it('breaks each paragraph once when an option change is followed by a fresh layout', async () => {
    const paragraphs = [{ text: 'あいうえおかきくけこ' }, { text: '夏目漱石は東京で生まれた。' }];
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const outgoing = await book.layoutChapter({ paragraphs });
    outgoing.getSpread(0);

    // The reflow the framework hooks run: change options, then lay the chapter
    // out again and render only the replacement.
    breakCalls.count = 0;
    await book.setOptions({ fontSize: 32, mode: 'loose' });
    const replacement = await book.layoutChapter({ paragraphs });
    replacement.getSpread(0);

    expect(breakCalls.count).toBe(paragraphs.length);
  });

  it('setOptions re-measures live heading paragraphs when headingScale changes', async () => {
    const headed = new MejiroBook({ ...baseOptions, headingScale: 1 });
    headed.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await headed.layoutChapter({
      paragraphs: [{ text: '見出し', headingLevel: 1 }],
    });
    const recompute = vi.spyOn(layout, 'recomputeAfterMeasurement');

    await headed.setOptions({ headingScale: 2 });

    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('snapshot ↔ layoutFromSnapshot round-trips a layout without re-measuring', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({
      paragraphs: [
        { text: 'あいうえおかきくけこ' },
        { text: '夏目漱石は、東京で生まれ育った作家である。' },
      ],
    });
    const snapshot = layout.snapshot();
    expect(snapshot.version).toBe(2);
    expect(snapshot.paragraphs).toHaveLength(2);
    expect(snapshot.paragraphs[0].text).toBe('あいうえおかきくけこ');
    expect(snapshot.paragraphs[0].advances.length).toBeGreaterThan(0);

    const fresh = new MejiroBook(baseOptions);
    const before = fresh.cacheStats();
    const restored = fresh.layoutFromSnapshot(snapshot);
    const after = fresh.cacheStats();
    // No measurement happened — the cache should not have grown.
    expect(after.fonts).toBe(before.fonts);
    expect(after.codepoints).toBe(before.codepoints);
    // The restored layout serves data identical to the original.
    expect(restored.totalPages).toBe(layout.totalPages);
    expect(restored.getSpread(0)).toBeDefined();
  });

  it('snapshot ↔ layoutFromSnapshot round-trips the structural kind of each paragraph', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({
      paragraphs: [
        { text: '第一章', kind: 'heading', headingLevel: 1 },
        { text: '本文です。' },
        { text: '引用です。', kind: 'blockquote' },
        { text: '＊', kind: 'sceneBreak' },
      ],
    });

    const restored = new MejiroBook(baseOptions).layoutFromSnapshot(layout.snapshot());

    const kinds = restored.getPage(0).page.paragraphs.map((p) => p.kind);
    expect(kinds).toEqual(layout.getPage(0).page.paragraphs.map((p) => p.kind));
    expect(kinds).toEqual(['heading', undefined, 'blockquote', 'sceneBreak']);
  });

  it('snapshot ↔ layoutFromSnapshot preserves image exclusions', async () => {
    book.setPageSize({ pageWidth: 180, lineWidth: 120 });
    const layout = await book.layoutChapter({
      paragraphs: [{ text: 'あ'.repeat(240) }],
    });
    layout.setImages(0, [{ x: 20, y: 10, w: 40, h: 60, margin: 0 }]);
    const originalSpread = layout.getSpread(0);
    const snapshot = layout.snapshot();

    expect(snapshot.images).toEqual([
      { spreadIndex: 0, images: [{ x: 20, y: 10, w: 40, h: 60, margin: 0 }] },
    ]);

    const fresh = new MejiroBook(baseOptions);
    const restored = fresh.layoutFromSnapshot(snapshot);
    const restoredSpread = restored.getSpread(0);

    expect(restored.hasImages).toBe(true);
    expect(restored.totalPages).toBe(layout.totalPages);
    expect(restoredSpread.right.hasImages).toBe(originalSpread.right.hasImages);
    expect(restoredSpread.right.slots).toEqual(originalSpread.right.slots);
  });

  it('layoutFromSnapshot rejects an unsupported version', () => {
    expect(() =>
      book.layoutFromSnapshot({
        // biome-ignore lint/suspicious/noExplicitAny: forcing an invalid version
        version: 99 as any,
        config: {
          fontSize: 16,
          lineSpacing: 1.8,
          headingScale: 1.4,
          mode: 'strict',
          enableHanging: true,
        },
        size: { pageWidth: 400, lineWidth: 600, pagePaddingX: 0, pagePaddingY: 0 },
        paragraphs: [],
      }),
    ).toThrow('Unsupported ChapterLayoutSnapshot version');
  });

  it('layoutManuscript lays out the paragraphs the EPUB export path yields', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const body = [
      '　一段目の字下げ。',
      '　',
      '[[mejiro-image:fig.png|図]]',
      '　 \t\n  二行目だけ字下げ。\n続き。',
      '',
      '',
      '末尾の段落。',
    ].join('\n\n');
    const layouts = await book.layoutManuscript({ chapters: [{ title: '題', body }] });
    const texts = (layouts.get('chapter-1') as ChapterLayout)
      .snapshot()
      .paragraphs.map((p) => p.text);

    const expected = manuscriptParagraphs(body)
      .filter((block) => parseInlineImageMarker(block) === null)
      .map((block) => parseManuscript(block, { dialect: 'mejiro' }).text);
    expect(texts).toEqual(['題', ...expected]);
    // Indents and the lone ideographic-space divider survive; the marker is dropped.
    expect(texts).toContain('　一段目の字下げ。');
    expect(texts).toContain('　');
    expect(texts.some((t) => t.includes('mejiro-image'))).toBe(false);
  });

  it('layoutManuscript parses manuscript markup and returns layouts keyed by chapter id', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layouts = await book.layoutManuscript({
      chapters: [
        { id: 'ch-1', title: '第一話', body: '漢字《かんじ》です。\n\n次の段落です。' },
        { title: '第二話', body: '本文。' },
      ],
    });
    expect(layouts.size).toBe(2);
    expect(layouts.has('ch-1')).toBe(true);
    expect(layouts.has('chapter-2')).toBe(true);
  });
});
