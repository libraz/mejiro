/**
 * @vitest-environment happy-dom
 */
import { MejiroError } from '@libraz/mejiro';
import {
  type BookImage,
  type ChapterLayout,
  estimateReadingTime,
  MejiroBook,
  type PageGeometry,
} from '@libraz/mejiro/book';
import { toFontSpec } from '@libraz/mejiro/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

const PAGE = { pageWidth: 200, lineWidth: 100 };
/** Long enough to fill several spreads at {@link PAGE}. */
const LONG_TEXT = 'あいうえおかきくけこさしすせそたちつてと'.repeat(20);

function containerOf(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  return el;
}

async function longLayout(): Promise<ChapterLayout> {
  const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
  return book.layoutChapter({ paragraphs: [{ text: LONG_TEXT }] });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MejiroBook page size', () => {
  it('fitPageSize measures the container, stores the size and returns the page geometry', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const geometry: PageGeometry = book.fitPageSize(containerOf(1000, 800));

    expect(geometry).toEqual({
      pageWidth: 476,
      lineWidth: 586,
      paddingX: 52,
      paddingY: 56,
      pageHeight: 690,
      contentHeight: 594,
    });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいう' }] });
    expect(layout.geometry).toEqual(geometry);

    expectTypeErrors(
      `import { MejiroBook, type PageGeometry, type FitPageSizeOptions } from '@libraz/mejiro/book';
const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
const options: FitPageSizeOptions = { paddingX: 10, paddingY: 10, paddingBottom: 10, columns: 1 };
const geometry: PageGeometry = book.fitPageSize(document.body, options);
book.computePageSize(document.body);
book.fitPageSize(document.body, { padding: { x: 1 } });`,
      { fails: ['computePageSize', 'padding: { x'] },
    );
  });

  it('accepts the page size at construction so layout needs no second call', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいう' }] });
    expect(layout.geometry.pageWidth).toBe(200);
    expect(layout.geometry.lineWidth).toBe(100);
  });

  it('fitPageSize rejects a container that measures zero and keeps no size', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    expect(() => book.fitPageSize(containerOf(0, 800))).toThrow(RangeError);
    expect(() => book.fitPageSize(containerOf(800, 0))).toThrow(RangeError);
    await expect(book.layoutChapter({ paragraphs: [{ text: 'あ' }] })).rejects.toMatchObject({
      name: 'MejiroError',
      code: 'page-size-unset',
    });
  });

  it('rejects layout before a page size with page-size-unset, and invalid sizes with RangeError', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const rejection = book.layoutChapter({ paragraphs: [] });
    await expect(rejection).rejects.toBeInstanceOf(MejiroError);
    await expect(rejection).rejects.toMatchObject({ code: 'page-size-unset' });

    for (const size of [
      { pageWidth: 0, lineWidth: 100 },
      { pageWidth: Number.NaN, lineWidth: 100 },
      { pageWidth: 200, lineWidth: Number.POSITIVE_INFINITY },
      { pageWidth: 200, lineWidth: -1 },
      { pageWidth: 200, lineWidth: 100, paddingX: -1 },
      { pageWidth: 200, lineWidth: 100, paddingX: 100 },
      { pageWidth: 200 } as unknown as { pageWidth: number; lineWidth: number },
    ]) {
      expect(() => book.setPageSize(size)).toThrow(RangeError);
      expect(() => new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: size })).toThrow(
        RangeError,
      );
    }
    expect(() => book.setPageSize({ pageWidth: 200, lineWidth: 100, paddingX: 0 })).not.toThrow();

    const layout = await longLayout();
    expect(() => layout.resize({ paddingX: 100 })).toThrow(RangeError);
    expect(() => layout.resize({ pageWidth: Number.NaN })).toThrow(RangeError);
    expect(layout.geometry.pageWidth).toBe(200);
  });
});

describe('MejiroBook options', () => {
  it('rejects an unusable font family or size at construction', () => {
    for (const fontFamily of ['', undefined, []]) {
      expect(() => new MejiroBook({ fontFamily, fontSize: 16 } as never)).toThrow(TypeError);
    }
    for (const fontSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new MejiroBook({ fontFamily: 'serif', fontSize })).toThrow(RangeError);
    }
  });

  it('updateOptions merges a patch of the runtime options into the current ones', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, kinsoku: 'loose' });
    await book.updateOptions({ lineSpacing: 2 });
    await book.updateOptions({ fontSize: 20 });
    expect(book.getOptions()).toMatchObject({
      fontFamily: 'serif',
      fontSize: 20,
      lineSpacing: 2,
      kinsoku: 'loose',
    });
  });

  it('types the patch with the runtime keys only and drops the separate constructor type', () => {
    expectTypeErrors(
      `import { MejiroBook, type BookOptions, type BookOptionsPatch, type ResolvedBookOptions } from '@libraz/mejiro/book';
import type { MejiroBookOptions } from '@libraz/mejiro/book';
const options: BookOptions = { fontFamily: 'serif', fontSize: 16, strictFontCheck: true };
const book = new MejiroBook(options);
const patch: BookOptionsPatch = { fontSize: 18, kinsoku: 'loose', headingScale: 1.2 };
void book.updateOptions(patch);
void book.updateOptions({ wordAwareBreaking: 'full' });
void book.updateOptions({ strictFontCheck: true });
void book.setOptions({ fontSize: 18 });
const resolved: ResolvedBookOptions = book.getOptions();
const mode = resolved.mode;`,
      {
        fails: [
          'MejiroBookOptions',
          "wordAwareBreaking: 'full'",
          'updateOptions({ strictFontCheck',
          'setOptions',
          'resolved.mode',
        ],
      },
    );
  });

  it('reports the resolved options under one named type', () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    expect(book.getOptions()).toMatchObject({
      fontFamily: 'serif',
      fontSize: 16,
      lineSpacing: 1.8,
      kinsoku: 'strict',
      enableHanging: true,
      headingScale: 1.4,
      wordAwareBreaking: 'off',
    });
    expectTypeErrors(
      `import { MejiroBook, type ResolvedBookOptions } from '@libraz/mejiro/book';
const resolved: ResolvedBookOptions = new MejiroBook({ fontFamily: 'serif', fontSize: 16 }).getOptions();
const size: number = resolved.fontSize;
const family: number = resolved.fontFamily;`,
      { fails: ['const family'] },
    );
  });

  it('subscribe notifies listeners when the book re-measures, until unsubscribed', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
    const layout = await book.layoutChapter({ paragraphs: [{ text: LONG_TEXT }] });
    const seen: number[] = [];
    const off = book.subscribe(() => seen.push(layout.typography.fontSize));

    await book.updateOptions({ fontSize: 20 });
    expect(seen).toEqual([20]);

    off();
    await book.updateOptions({ fontSize: 24 });
    expect(seen).toEqual([20]);
  });

  it('keeps notifying other listeners when one throws and rethrows on a microtask', async () => {
    const queued: Array<() => void> = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      queued.push(task);
    });
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
    await book.layoutChapter({ paragraphs: [{ text: 'あいう' }] });
    const boom = new Error('listener failed');
    const after = vi.fn();
    book.subscribe(() => {
      throw boom;
    });
    book.subscribe(after);

    await book.updateOptions({ fontSize: 20 });
    expect(after).toHaveBeenCalledTimes(1);
    expect(queued).toHaveLength(1);
    expect(() => queued[0]()).toThrow(boom);
  });

  it('passes an analyzer failure to onError as analyzer-failed instead of the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cause = new Error('analyzer broke');
    const analyzer = {
      identity: { name: 'broken', version: '1' },
      analyze: () => {
        throw cause;
      },
    };
    const onError = vi.fn();
    const book = new MejiroBook({
      fontFamily: 'serif',
      fontSize: 16,
      pageSize: PAGE,
      analyzer,
      wordAwareBreaking: 'clusters',
      onError,
    });
    await book.layoutChapter({ paragraphs: [{ text: 'あいう' }] });

    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(MejiroError);
    expect(error).toMatchObject({ code: 'analyzer-failed', cause });
    expect(warn).not.toHaveBeenCalled();

    const quiet = new MejiroBook({
      fontFamily: 'serif',
      fontSize: 16,
      pageSize: PAGE,
      analyzer,
      wordAwareBreaking: 'clusters',
    });
    await quiet.layoutChapter({ paragraphs: [{ text: 'あいう' }] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('clearCache drops the widths of one font spec', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
    await book.layoutChapter({
      paragraphs: [{ text: 'あいう' }, { text: 'えお', headingLevel: 1 }],
    });
    const before = book.cacheStats();
    expect(before.fonts).toBeGreaterThanOrEqual(2);

    book.clearCache(toFontSpec('serif', 16));
    expect(book.cacheStats().fonts).toBe(before.fonts - 1);
  });
});

describe('MejiroBook chapter input', () => {
  it('lays out and estimates any ChapterSource, the shared chapter shape', async () => {
    const chapter = { paragraphs: [{ text: 'あいうえお' }] } as const;
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
    await expect(book.layoutChapter(chapter)).resolves.toBeDefined();
    expect(estimateReadingTime(chapter, { charsPerMinute: 300 })).toBe(1000);

    expectTypeErrors(
      `import { MejiroBook, estimateReadingTime, type ChapterSource } from '@libraz/mejiro/book';
import type { ChapterLike } from '@libraz/mejiro/book';
const chapter: ChapterSource = { paragraphs: [{ text: 'あ' }] };
void new MejiroBook({ fontFamily: 'serif', fontSize: 16 }).layoutChapter(chapter);
estimateReadingTime(chapter);`,
      { fails: ['ChapterLike'] },
    );
  });

  it('layoutManuscript returns one layout per chapter in input order', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
    const layouts = await book.layoutManuscript({
      chapters: [
        { id: 'same', title: '一', body: 'あ' },
        { id: 'same', title: '二', body: 'い\n\nう\n\nえ' },
        { title: '', body: 'お' },
      ],
    });

    expect(Array.isArray(layouts)).toBe(true);
    expect(layouts.map((layout) => layout.endAnchor()?.paragraphIndex)).toEqual([1, 3, 0]);
  });

  it('treats a paragraph of kind heading as a heading without any other marker', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16, pageSize: PAGE });
    const layout = await book.layoutChapter({
      paragraphs: [{ text: '見出し', kind: 'heading' }, { text: '本文' }],
    });
    const lines = layout.getPage(0).lines;
    expect(lines[0].kind).toBe('heading');
    expect(lines[0].fontSize).toBeGreaterThan(16);

    const snapshot = layout.snapshot();
    expect(snapshot.paragraphs[0].kind).toBe('heading');
    expect('isHeading' in snapshot.paragraphs[0]).toBe(false);
  });
});

describe('ChapterLayout surface', () => {
  it('reports locations and rectangles with spelled-out index names and a page count', async () => {
    const layout = await longLayout();
    expect(layout.pageCount).toBeGreaterThan(2);
    expect(layout.getSpread(0).pageCount).toBe(layout.pageCount);

    expect(layout.locateAnchor({ paragraphIndex: 0, charIndex: 0 })).toEqual({
      spreadIndex: 0,
      pageIndex: 0,
      lineIndex: 0,
      side: 'right',
    });
    const rect = layout.coordOfAnchor({ paragraphIndex: 0, charIndex: 0 });
    expect(rect).toMatchObject({ spreadIndex: 0, pageIndex: 0, side: 'right' });
    if (!rect) throw new Error('expected a rectangle');

    expect(layout.anchorAtCoord(0, { x: rect.x + 1, y: rect.y + 1 })).toEqual({
      paragraphIndex: 0,
      charIndex: 0,
    });
    const left = layout.anchorAt(0, { side: 'left' });
    expect(left?.charIndex).toBeGreaterThan(0);
    expect(layout.locateAnchor(left ?? { paragraphIndex: 0, charIndex: 0 })?.pageIndex).toBe(1);
    expect(layout.anchorAt(0)).toEqual({ paragraphIndex: 0, charIndex: 0 });

    expectTypeErrors(
      `import type { ChapterLayout, AnchorAtOptions, SpreadPoint } from '@libraz/mejiro/book';
declare const layout: ChapterLayout;
const side: AnchorAtOptions = { side: 'left' };
const point: SpreadPoint = { x: 1, y: 2 };
layout.anchorAt(0, side);
layout.anchorAtCoord(0, point);
const count: number = layout.pageCount;
layout.anchorAtCoord(0, 1, 2);
layout.anchorAt(0, 'left');
const old = layout.totalPages;`,
      { fails: ['anchorAtCoord(0, 1, 2)', "anchorAt(0, 'left')", 'layout.totalPages'] },
    );
  });

  it('setImages returns the reflowed spread and clearImages clears one spread or all', async () => {
    const layout = await longLayout();
    const image: BookImage = { x: 60, y: 0, width: 80, height: 60 };

    const spread = layout.setImages(0, [image]);
    expect(spread).toEqual(layout.getSpread(0));
    expect(spread.right.hasImages || spread.left.hasImages).toBe(true);

    layout.setImages(1, [image]);
    layout.clearImages(0);
    expect(layout.hasImages).toBe(true);
    expect(layout.getSpread(0).right.hasImages).toBe(false);
    layout.clearImages();
    expect(layout.hasImages).toBe(false);

    layout.setImages(0, [image]);
    const cleared = layout.setImages(0, []);
    expect(layout.hasImages).toBe(false);
    expect(cleared.right.hasImages).toBe(false);

    expectTypeErrors(
      `import type { ChapterLayout, BookImage } from '@libraz/mejiro/book';
declare const layout: ChapterLayout;
const images: readonly BookImage[] = [{ x: 0, y: 0, width: 10, height: 10 }];
const spread = layout.setImages(0, images);
const count: number = spread.pageCount;
layout.syncImages(0, []);
const old: BookImage = { x: 0, y: 0, w: 10, h: 10 };`,
      { fails: ['syncImages', 'w: 10'] },
    );
  });

  it('exposes the geometry and typography it was last measured with', async () => {
    const book = new MejiroBook({
      fontFamily: '"Noto Serif JP"',
      fontSize: 16,
      lineSpacing: 2,
      pageSize: { ...PAGE, paddingX: 10, paddingY: 12 },
    });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいう' }] });
    expect(layout.typography).toEqual({
      fontFamily: '"Noto Serif JP"',
      fontSize: 16,
      lineSpacing: 2,
    });
    expect(layout.geometry).toMatchObject({ ...PAGE, paddingX: 10, paddingY: 12 });

    await book.updateOptions({ fontSize: 20 });
    expect(layout.typography.fontSize).toBe(20);

    expectTypeErrors(
      `import type { ChapterLayout, ChapterTypography, PageGeometry } from '@libraz/mejiro/book';
declare const layout: ChapterLayout;
const typography: ChapterTypography = layout.typography;
const geometry: PageGeometry = layout.geometry;
layout.typography = typography;`,
      { fails: ['layout.typography = typography'] },
    );
  });

  it('exports ChapterLayout as a type only, constructed by the book', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import { ChapterLayout as LayoutValue } from '@libraz/mejiro/book';
declare const layout: ChapterLayout;
const count: number = layout.pageCount;
const made = new LayoutValue();`,
      { fails: ['new LayoutValue'] },
    );
  });
});
