/**
 * @vitest-environment happy-dom
 */
import {
  layoutText,
  MejiroBrowser,
  MejiroError,
  type ParagraphsLayoutResult,
  WidthCache,
  type WidthCacheStats,
} from '@libraz/mejiro/browser';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

const BASE = { text: 'あいうえおかきくけこ', lineWidth: 100 };

describe('MejiroBrowser font defaults', () => {
  it('uses fontFamily and fontSize from the constructor options when a call omits them', async () => {
    const browser = new MejiroBrowser({ fontFamily: 'serif', fontSize: 16 });

    await expect(browser.layout(BASE)).resolves.toBeDefined();
    await expect(browser.preloadFont()).resolves.toBeUndefined();
    expect(browser.verticalLineWidth(400)).toBe(392);
  });

  it('rejects the fixed-prefixed option names at the type level', () => {
    const header = `import { MejiroBrowser } from '@libraz/mejiro/browser';`;
    expectTypeErrors(`${header}\nnew MejiroBrowser({ fontFamily: 'serif', fontSize: 16 });`, {
      fails: [],
    });
    expectTypeErrors(
      `${header}\nnew MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });`,
      { fails: ['fixedFontFamily'] },
    );
  });

  it('keeps the width-cache measurer out of the instance surface', () => {
    const browser = new MejiroBrowser({ fontFamily: 'serif', fontSize: 16 });
    expect('getMeasurer' in browser).toBe(false);

    const header = `import { MejiroBrowser } from '@libraz/mejiro/browser';\nconst browser = new MejiroBrowser();`;
    expectTypeErrors(`${header}\nbrowser.cacheStats();`, { fails: [] });
    expectTypeErrors(`${header}\nbrowser.getMeasurer();`, { fails: ['getMeasurer'] });
  });
});

describe('font spec cache invalidation', () => {
  it('WidthCache clears and counts a single font spec', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 16);
    cache.set('16px serif', 0x3044, 16);
    cache.set('24px serif', 0x3042, 24);

    expect(cache.size('16px serif')).toBe(2);
    cache.clear('16px serif');
    expect(cache.get('16px serif', 0x3042)).toBeUndefined();
    expect(cache.get('24px serif', 0x3042)).toBe(24);
    expect(cache.size('24px serif')).toBe(1);
  });

  it('MejiroBrowser.clearCache drops only the named font spec', async () => {
    const browser = new MejiroBrowser({ fontFamily: 'serif', fontSize: 16 });
    await browser.layout({ ...BASE, fontSize: 16 });
    await browser.layout({ ...BASE, fontSize: 24 });
    expect(browser.cacheStats().fonts).toBe(2);

    browser.clearCache('16px serif');
    expect(browser.cacheStats().fonts).toBe(1);
    browser.clearCache();
    expect(browser.cacheStats()).toEqual({ fonts: 0, codepoints: 0 });
  });
});

describe('cache statistics type', () => {
  it('names the statistics shape returned by the cache and the browser', () => {
    const stats: WidthCacheStats = new WidthCache().stats();
    expect(stats).toEqual({ fonts: 0, codepoints: 0 });
    const fromBrowser: WidthCacheStats = new MejiroBrowser().cacheStats();
    expect(fromBrowser).toEqual({ fonts: 0, codepoints: 0 });

    expectTypeErrors(
      `import { MejiroBrowser, WidthCache, type WidthCacheStats } from '@libraz/mejiro/browser';
const a: WidthCacheStats = new WidthCache().stats();
const b: WidthCacheStats = new MejiroBrowser().cacheStats();
const c: WidthCacheStats = { fonts: 'one', codepoints: 0 };`,
      { fails: ["fonts: 'one'"] },
    );
  });
});

describe('MejiroBrowser.layoutParagraphs', () => {
  it('lays out paragraphs and returns NFC characters', async () => {
    const browser = new MejiroBrowser({ fontFamily: 'serif', fontSize: 16 });

    const result: ParagraphsLayoutResult = await browser.layoutParagraphs({
      paragraphs: [{ text: 'がく' }, { text: 'あいう', fontSize: 24 }],
      lineWidth: 100,
    });

    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0].chars).toEqual(['が', 'く']);
    expect(result.paragraphs[1].chars).toEqual(['あ', 'い', 'う']);
  });

  it('replaces the chapter-named method and result type', () => {
    expect('layoutChapter' in new MejiroBrowser()).toBe(false);
    expectTypeErrors(
      `import { MejiroBrowser, type ParagraphsLayoutResult } from '@libraz/mejiro/browser';
const browser = new MejiroBrowser();
browser.layoutParagraphs({ paragraphs: [], lineWidth: 100, fontFamily: 'serif', fontSize: 16 });`,
      { fails: [] },
    );
    expectTypeErrors(
      `import { MejiroBrowser } from '@libraz/mejiro/browser';
const browser = new MejiroBrowser();
browser.layoutChapter({ paragraphs: [], lineWidth: 100 });`,
      { fails: ['layoutChapter'] },
    );
    expectTypeErrors(`import type { ChapterLayoutResult } from '@libraz/mejiro/browser';`, {
      fails: ['ChapterLayoutResult'],
    });
  });
});

describe('layoutText options', () => {
  it('requires the font and accepts kinsoku in place of mode at the type level', () => {
    const header = `import { layoutText, type LayoutTextOptions } from '@libraz/mejiro/browser';`;
    expectTypeErrors(
      `${header}
const full: LayoutTextOptions = { text: 'a', lineWidth: 10, fontFamily: 'serif', fontSize: 16, kinsoku: 'loose' };
layoutText(full);`,
      { fails: [] },
    );
    expectTypeErrors(
      `${header}
const noFont: LayoutTextOptions = { text: 'a', lineWidth: 10 };`,
      { fails: ['noFont'] },
    );
    expectTypeErrors(
      `${header}
const oldMode: LayoutTextOptions = { text: 'a', lineWidth: 10, fontFamily: 'serif', fontSize: 16, mode: 'loose' };`,
      { fails: ['oldMode'] },
    );
  });

  it('keeps the kinsoku option to built-in modes where no rules type is accepted', () => {
    expectTypeErrors(
      `import { buildKinsokuRules } from '@libraz/mejiro';
import { MejiroBrowser } from '@libraz/mejiro/browser';
const rules = buildKinsokuRules({ lineStartProhibited: [], lineEndProhibited: [] });
new MejiroBrowser().layout({ text: 'a', lineWidth: 10, kinsoku: 'strict' });
new MejiroBrowser().layout({ text: 'a', lineWidth: 10, kinsoku: rules });`,
      { fails: ['kinsoku: rules'] },
    );
  });

  it('applies the kinsoku mode in layoutText and MejiroBrowser.layout alike', async () => {
    // Ten characters of 10px fit a 50px line; the small kana lands at a line
    // start after a plain 5-character cut, which only the loose mode permits.
    const text = 'あいうえおっかきくけ';
    const base = { text, lineWidth: 50, fontFamily: 'serif', fontSize: 16 };

    const strict = await layoutText({ ...base, kinsoku: 'strict' });
    const loose = await layoutText({ ...base, kinsoku: 'loose' });
    expect([...strict.breakPoints]).not.toEqual([...loose.breakPoints]);

    const browser = new MejiroBrowser();
    expect([...(await browser.layout({ ...base, kinsoku: 'loose' })).breakPoints]).toEqual([
      ...loose.breakPoints,
    ]);
  });

  it('rejects an unknown kinsoku mode with a RangeError', async () => {
    const bogus = 'sloppy' as unknown as 'strict';
    await expect(
      layoutText({ text: 'あ', lineWidth: 50, fontFamily: 'serif', fontSize: 16, kinsoku: bogus }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('font argument validation', () => {
  const browser = new MejiroBrowser();

  it('rejects a missing or empty fontFamily with a TypeError', async () => {
    await expect(browser.layout({ ...BASE, fontSize: 16 })).rejects.toBeInstanceOf(TypeError);
    await expect(browser.layout({ ...BASE, fontFamily: '', fontSize: 16 })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(browser.layout({ ...BASE, fontFamily: [], fontSize: 16 })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(browser.preloadFont(undefined, 16)).rejects.toBeInstanceOf(TypeError);
    await expect(
      browser.layoutParagraphs({ paragraphs: [], lineWidth: 100, fontSize: 16 }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a missing fontSize with a TypeError', async () => {
    await expect(browser.layout({ ...BASE, fontFamily: 'serif' })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(browser.preloadFont('serif', undefined)).rejects.toBeInstanceOf(TypeError);
    expect(() => browser.verticalLineWidth(400)).toThrow(TypeError);
  });

  it.each([0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects fontSize %s with a RangeError',
    async (fontSize) => {
      await expect(
        browser.layout({ ...BASE, fontFamily: 'serif', fontSize }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(browser.preloadFont('serif', fontSize)).rejects.toBeInstanceOf(RangeError);
      expect(() => browser.verticalLineWidth(400, fontSize)).toThrow(RangeError);
      expect(() => new MejiroBrowser({ fontFamily: 'serif', fontSize })).toThrow(RangeError);
    },
  );

  it('rejects an empty constructor fontFamily with a TypeError', () => {
    expect(() => new MejiroBrowser({ fontFamily: '', fontSize: 16 })).toThrow(TypeError);
  });

  it('validates layoutText the same way', async () => {
    await expect(layoutText({ ...BASE, fontFamily: 'serif', fontSize: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(layoutText({ ...BASE, fontFamily: '', fontSize: 16 })).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe('font failures', () => {
  it('rejects with font-unavailable when strictFontCheck sees a fallback', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ strictFontCheck: true });

    await expect(
      browser.layout({ ...BASE, fontFamily: 'serif', fontSize: 16 }),
    ).rejects.toMatchObject({ name: 'MejiroError', code: 'font-unavailable' });
    await expect(browser.preloadFont('serif', 16)).rejects.toBeInstanceOf(MejiroError);
  });
});

describe('collaborator option types', () => {
  it('names the options accepted by FontLoader and CharMeasurer', () => {
    expectTypeErrors(
      `import { CharMeasurer, FontLoader, WidthCache, type CharMeasurerOptions, type FontLoaderOptions } from '@libraz/mejiro/browser';
const loaderOptions: FontLoaderOptions = { onFontsLoaded: () => {} };
const measurerOptions: CharMeasurerOptions = { cache: new WidthCache() };
new FontLoader(loaderOptions);
new CharMeasurer(measurerOptions);
const stray: CharMeasurerOptions = { canvass: undefined };`,
      { fails: ['canvass'] },
    );
  });

  it('exposes the paragraph results as read-only lists', () => {
    expectTypeErrors(
      `import type { ParagraphsLayoutResult } from '@libraz/mejiro/browser';
declare const result: ParagraphsLayoutResult;
result.paragraphs[0].chars.length;
result.paragraphs.push(result.paragraphs[0]);`,
      { fails: ['.push('] },
    );
  });
});
