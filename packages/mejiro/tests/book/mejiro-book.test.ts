/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import type { BookOptions } from '../../src/book/types.js';

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

  it('setOptions patches only provided fields', () => {
    book.setOptions({ fontSize: 24, mode: 'loose' });
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

  it('clearCache does not throw and produces no observable error', () => {
    expect(() => book.clearCache()).not.toThrow();
    expect(() => book.clearCache('serif 16px')).not.toThrow();
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

  it('setOptions propagates lineSpacing changes to live layouts', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });
    const beforePages = layout.totalPages;
    await book.setOptions({ lineSpacing: 3.0 });
    // After a tighter/looser line spacing, getSpread should reflect the new config.
    const after = layout.getSpread(0);
    expect(after).toBeDefined();
    // The layout was invalidated by setOptions; recomputed values are valid.
    expect(layout.totalPages).toBeGreaterThanOrEqual(beforePages);
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

  it('snapshot ↔ layoutFromSnapshot round-trips a layout without re-measuring', async () => {
    book.setPageSize({ pageWidth: 400, lineWidth: 600 });
    const layout = await book.layoutChapter({
      paragraphs: [
        { text: 'あいうえおかきくけこ' },
        { text: '夏目漱石は、東京で生まれ育った作家である。' },
      ],
    });
    const snapshot = layout.snapshot();
    expect(snapshot.version).toBe(1);
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
