/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import { FontLoader } from '../../src/browser/font-loader.js';
import { MejiroBrowser } from '../../src/browser/integration.js';
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
});
