/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import { FontLoader } from '../../src/browser/font-loader.js';
import { layoutText, MejiroBrowser } from '../../src/browser/integration.js';
import { CharMeasurer } from '../../src/browser/measure.js';

/** Advance width per glyph when the host falls back to its default font. */
const FALLBACK_WIDTH = 10;
/** Advance width per glyph once the requested family is really in use. */
const FAMILY_WIDTH = 17;

const restore: Array<() => void> = [];

afterEach(() => {
  while (restore.length > 0) restore.pop()?.();
});

function isCjk(ch: string): boolean {
  return ch >= '　';
}

function replaceDocumentFonts(stub: object): void {
  const original = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: stub });
  restore.push(() => {
    if (original) Object.defineProperty(document, 'fonts', original);
    else Reflect.deleteProperty(document, 'fonts');
  });
}

function replaceCanvasMetrics(widthOf: (font: string, text: string) => number): void {
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a read-only DOM API
  const original = (HTMLCanvasElement.prototype as any).getContext;
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a read-only DOM API
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    font: '',
    measureText(text: string) {
      return { width: widthOf(this.font as string, text) };
    },
  });
  restore.push(() => {
    // biome-ignore lint/suspicious/noExplicitAny: restoring a read-only DOM API
    (HTMLCanvasElement.prototype as any).getContext = original;
  });
}

/**
 * Models a webfont delivered as separate Latin and CJK subsets: the family
 * renders Latin immediately, but CJK falls back until the CJK subset has been
 * fetched.
 */
function installSubsettedFont(family: string): { cjkFetched: boolean } {
  const state = { cjkFetched: false };
  const needsCjk = (text: string) => [...text].some(isCjk);

  replaceDocumentFonts({
    check: (spec: string, text = '') =>
      !(spec.includes(family) && needsCjk(text)) || state.cjkFetched,
    load: async (spec: string, text = '') => {
      if (spec.includes(family) && needsCjk(text)) state.cjkFetched = true;
      return [];
    },
    addEventListener: () => {},
    [Symbol.iterator]: function* () {},
  });

  replaceCanvasMetrics((font, text) => {
    const covered = font.includes(family) && (state.cjkFetched || !needsCjk(text));
    return (covered ? FAMILY_WIDTH : FALLBACK_WIDTH) * [...text].length;
  });

  return state;
}

/**
 * Models a host that can render `installedFamilies` — none of which are
 * registered as a `FontFace`, exactly like an OS-installed font. Every other
 * family measures as the default font.
 */
function installLocalFonts(installedFamilies: readonly string[]): void {
  replaceDocumentFonts({
    check: () => true,
    load: async () => [],
    addEventListener: () => {},
    [Symbol.iterator]: function* () {},
  });

  replaceCanvasMetrics((font, text) => {
    const installed = installedFamilies.some((family) => font.includes(family));
    return (installed ? FAMILY_WIDTH : FALLBACK_WIDTH) * [...text].length;
  });
}

function isLatin(ch: string): boolean {
  return ch < '\u0100';
}

/**
 * Models a family delivered as separate Latin and CJK `unicode-range` faces,
 * each fetched only when text in its range is requested. With `hasLatin`
 * false the family ships no Latin face at all.
 */
function installSplitSubsetFont(
  family: string,
  { hasLatin }: { hasLatin: boolean },
): { latin: boolean; cjk: boolean } {
  const state = { latin: false, cjk: false };
  const ours = (spec: string) => spec.includes(family);

  replaceDocumentFonts({
    check: (spec: string, text = '') =>
      !ours(spec) ||
      ((![...text].some(isLatin) || state.latin) && (![...text].some(isCjk) || state.cjk)),
    load: async (spec: string, text = '') => {
      if (!ours(spec)) return [];
      if ([...text].some(isCjk)) state.cjk = true;
      if (hasLatin && [...text].some(isLatin)) state.latin = true;
      return [];
    },
    addEventListener: () => {},
    [Symbol.iterator]: function* () {},
  });

  replaceCanvasMetrics((font, text) => {
    const covered = ours(font) && [...text].every((ch) => (isCjk(ch) ? state.cjk : state.latin));
    return (covered ? FAMILY_WIDTH : FALLBACK_WIDTH) * [...text].length;
  });

  return state;
}

/** Models a web font whose every request fails: the fetch rejects and nothing renders. */
function installUnreachableFont(): void {
  replaceDocumentFonts({
    check: () => false,
    load: () => Promise.reject(new Error('network error')),
    addEventListener: () => {},
    [Symbol.iterator]: function* () {},
  });
  replaceCanvasMetrics((_font, text) => FALLBACK_WIDTH * [...text].length);
}

/**
 * Models a host whose `document.fonts` supports `loadingdone` subscriptions and
 * counts the listeners currently attached. `fire` delivers the event.
 */
function installListenerCountingFonts(): { listeners: () => number; fire: () => void } {
  const handlers = new Set<EventListener>();
  replaceDocumentFonts({
    check: () => true,
    load: async () => [],
    addEventListener: (type: string, listener: EventListener) => {
      if (type === 'loadingdone') handlers.add(listener);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      if (type === 'loadingdone') handlers.delete(listener);
    },
    [Symbol.iterator]: function* () {},
  });
  return {
    listeners: () => handlers.size,
    fire: () => {
      for (const handler of [...handlers]) handler(new Event('loadingdone'));
    },
  };
}

describe('font availability', () => {
  it('resolves ensureLoaded only once the measured range is covered', async () => {
    const state = installSubsettedFont('Noto Serif JP');
    const spec = '16px "Noto Serif JP"';

    // Baseline: with the CJK subset still missing, U+3042 measures as fallback.
    expect(new CharMeasurer().measure(spec, 0x3042)).toBe(FALLBACK_WIDTH);

    const loader = new FontLoader();
    await loader.ensureLoaded(spec, 'あ');

    expect(state.cjkFetched).toBe(true);
    const afterEnsure = new CharMeasurer().measure(spec, 0x3042);
    expect(afterEnsure).toBe(FAMILY_WIDTH);
    expect(afterEnsure).not.toBe(FALLBACK_WIDTH);
  });

  it('lays out with an unregistered local family when strictFontCheck is off', async () => {
    installLocalFonts(['ヒラギノ明朝 ProN']);
    const browser = new MejiroBrowser({ strictFontCheck: false });

    await expect(
      browser.layout({
        text: 'あいうえお',
        lineWidth: 200,
        fontFamily: '"ヒラギノ明朝 ProN"',
        fontSize: 16,
      }),
    ).resolves.toBeDefined();
  });

  it('surfaces a fallback through strictFontCheck configured on MejiroBook', async () => {
    installLocalFonts(['Real JP']);
    const paragraphs = [{ text: 'あいうえお' }];

    const lenient = new MejiroBook({ fontFamily: '"Absent JP"', fontSize: 16 });
    lenient.setPageSize({ pageWidth: 400, lineWidth: 200 });
    await expect(lenient.layoutChapter({ paragraphs })).resolves.toBeDefined();

    const strict = new MejiroBook({
      fontFamily: '"Absent JP"',
      fontSize: 16,
      strictFontCheck: true,
    });
    strict.setPageSize({ pageWidth: 400, lineWidth: 200 });
    await expect(strict.layoutChapter({ paragraphs })).rejects.toThrow(
      /Font not available \(possible fallback\)/,
    );

    // The same strict book accepts a family the host can really render.
    const strictOnInstalled = new MejiroBook({
      fontFamily: '"Real JP"',
      fontSize: 16,
      strictFontCheck: true,
    });
    strictOnInstalled.setPageSize({ pageWidth: 400, lineWidth: 200 });
    await expect(strictOnInstalled.layoutChapter({ paragraphs })).resolves.toBeDefined();
  });

  it.each([
    { hasLatin: true, label: 'a Latin face not yet fetched' },
    { hasLatin: false, label: 'no Latin face at all' },
  ])('accepts a CJK-loaded family with $label under strictFontCheck', async ({ hasLatin }) => {
    const state = installSplitSubsetFont('Split JP', { hasLatin });
    const browser = new MejiroBrowser({ strictFontCheck: true });

    await expect(
      browser.layout({
        text: 'あいうえお',
        lineWidth: 200,
        fontFamily: '"Split JP"',
        fontSize: 16,
      }),
    ).resolves.toBeDefined();
    expect(state.cjk).toBe(true);
    expect(state.latin).toBe(hasLatin);
  });

  it('lays out with the resolved font when a web font fails to load, unless strict', async () => {
    installUnreachableFont();
    const request = { text: 'あいうえお', lineWidth: 200, fontFamily: '"Down JP"', fontSize: 16 };

    const lenient = new MejiroBrowser();
    await expect(lenient.layout(request)).resolves.toBeDefined();
    await expect(
      lenient.layoutChapter({ ...request, paragraphs: [{ text: request.text }] }),
    ).resolves.toBeDefined();
    await expect(lenient.preloadFont('"Down JP"', 16)).resolves.toBeUndefined();
    await expect(layoutText(request)).resolves.toBeDefined();

    const book = new MejiroBook({ fontFamily: '"Down JP"', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });
    await expect(
      book.layoutChapter({ paragraphs: [{ text: request.text }] }),
    ).resolves.toBeDefined();

    const strict = new MejiroBrowser({ strictFontCheck: true });
    await expect(strict.layout(request)).rejects.toThrow(/possible fallback/);
    await expect(strict.preloadFont('"Down JP"', 16)).rejects.toThrow(/possible fallback/);
  });

  it('leaves no loadingdone listener behind once a book or browser is disposed', async () => {
    const fonts = installListenerCountingFonts();
    replaceCanvasMetrics((_font, text) => FAMILY_WIDTH * [...text].length);

    for (let i = 0; i < 3; i++) {
      const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
      book.setPageSize({ pageWidth: 400, lineWidth: 200 });
      await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });
      await book.setOptions({ fontSize: 18 });
      expect(fonts.listeners()).toBe(1);
      book.dispose();
      expect(fonts.listeners()).toBe(0);
    }

    const browser = new MejiroBrowser();
    browser.dispose();
    expect(fonts.listeners()).toBe(0);

    await layoutText({ text: 'あいう', fontFamily: 'serif', fontSize: 16, lineWidth: 200 });
    expect(fonts.listeners()).toBe(0);
  });

  it('re-measures live book layouts when fonts finish loading', async () => {
    const fonts = installListenerCountingFonts();
    let arrived = false;
    replaceCanvasMetrics(
      (font, text) =>
        (arrived && font.includes('Late JP') ? FAMILY_WIDTH : FALLBACK_WIDTH) * [...text].length,
    );
    const book = new MejiroBook({ fontFamily: '"Late JP"', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });
    expect(layout.snapshot().paragraphs[0].advances[0]).toBe(FALLBACK_WIDTH);

    arrived = true;
    fonts.fire();

    expect(layout.snapshot().paragraphs[0].advances[0]).toBe(FAMILY_WIDTH);
  });
});
