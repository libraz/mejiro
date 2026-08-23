/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import type { BookParagraph } from '../../src/book/types.js';

/**
 * Relative glyph width per family, so a measurement can be traced back to the
 * font spec that produced it. The shared test setup measures every glyph at a
 * fixed width, which would hide font-size / font-family regressions.
 */
const FAMILY_WIDTH_RATIO: Record<string, number> = {
  serif: 1,
  'sans-serif': 0.75,
  monospace: 0.5,
};

function parseFontSpec(spec: string): { size: number; family: string } {
  const m = /^(\d+(?:\.\d+)?)px\s+(.*)$/u.exec(spec);
  if (!m) return { size: 16, family: 'serif' };
  return { size: Number(m[1]), family: m[2] };
}

/**
 * Installs a canvas stub whose advance widths are proportional to the font
 * size and family currently set on the context. Each `getContext` call returns
 * a fresh context so concurrently live measurers cannot desynchronise their
 * cached `font` value.
 */
function installMetricCanvas(): void {
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a read-only DOM API
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    font: '',
    measureText(text: string) {
      const { size, family } = parseFontSpec(this.font as string);
      const ratio = FAMILY_WIDTH_RATIO[family] ?? 1;
      return { width: size * ratio * [...text].length };
    },
  });
}

const HEADING_WITH_RUBY: BookParagraph[] = [
  {
    text: '東京都と大阪府',
    headingLevel: 1,
    inlineAnnotations: [
      { kind: 'ruby', startIndex: 0, endIndex: 3, rubyText: 'とうきょうとふう', type: 'group' },
    ],
  },
];

/** Controls for the `document.fonts` stub installed by {@link installFontsStub}. */
interface FontsStubControls {
  /** Resolves the pending load of the configured slow family. */
  release(): void;
}

let restoreFonts: (() => void) | null = null;

/**
 * Replaces `document.fonts` with a stub that can hold one family's load
 * pending and make another family's load reject, so overlapping and failing
 * option changes can be driven deterministically.
 */
function installFontsStub(
  options: { slowFamily?: string; failingFamily?: string } = {},
): FontsStubControls {
  let release: () => void = () => {};
  let slowLoaded = false;
  const isSlow = (spec: string) =>
    options.slowFamily !== undefined && spec.includes(options.slowFamily);
  const isFailing = (spec: string) =>
    options.failingFamily !== undefined && spec.includes(options.failingFamily);

  const stub = {
    check: (spec: string) => !isFailing(spec) && (!isSlow(spec) || slowLoaded),
    load: (spec: string) => {
      if (isFailing(spec)) return Promise.reject(new Error('font fetch failed'));
      if (isSlow(spec)) {
        return new Promise<FontFace[]>((resolve) => {
          release = () => {
            slowLoaded = true;
            resolve([]);
          };
        });
      }
      return Promise.resolve([]);
    },
    addEventListener: () => {},
    [Symbol.iterator]: function* () {},
  };

  const original = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: stub });
  restoreFonts = () => {
    if (original) Object.defineProperty(document, 'fonts', original);
    else Reflect.deleteProperty(document, 'fonts');
  };
  return { release: () => release() };
}

describe('MejiroBook measurement', () => {
  let originalGetContext: unknown;

  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: stubbing a read-only DOM API
    originalGetContext = (HTMLCanvasElement.prototype as any).getContext;
    installMetricCanvas();
  });

  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: restoring a read-only DOM API
    (HTMLCanvasElement.prototype as any).getContext = originalGetContext;
    restoreFonts?.();
    restoreFonts = null;
  });

  it('measures heading ruby at the paragraph scale on the re-measure path', async () => {
    const direct = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    direct.setPageSize({ pageWidth: 400, lineWidth: 160 });
    const fromScratch = await direct.layoutChapter({ paragraphs: HEADING_WITH_RUBY });

    const stepped = new MejiroBook({ fontFamily: 'serif', fontSize: 14 });
    stepped.setPageSize({ pageWidth: 400, lineWidth: 160 });
    const viaSetOptions = await stepped.layoutChapter({ paragraphs: HEADING_WITH_RUBY });
    await stepped.setOptions({ fontSize: 16 });

    const expected = fromScratch.snapshot().paragraphs[0].breakPoints;
    // Guard against a vacuous comparison: the heading must actually wrap.
    expect(expected.length).toBeGreaterThan(0);
    expect(viaSetOptions.snapshot().paragraphs[0].breakPoints).toEqual(expected);
  });

  it('keeps the returned layout geometry consistent with a setPageSize during layoutChapter', async () => {
    const paragraphs: BookParagraph[] = [{ text: 'あ'.repeat(60) }];

    const control = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    control.setPageSize({ pageWidth: 400, lineWidth: 320 });
    const expected = (await control.layoutChapter({ paragraphs })).snapshot();

    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 320 });
    // Resize while the measurement promise is still pending.
    const pending = book.layoutChapter({ paragraphs });
    book.setPageSize({ pageWidth: 400, lineWidth: 96 });
    const layout = await pending;

    const snapshot = layout.snapshot();
    expect(snapshot.size.lineWidth).toBe(320);
    expect(snapshot.paragraphs[0].breakPoints).toEqual(expected.paragraphs[0].breakPoints);
  });

  it('converges on the last setOptions when two font changes overlap', async () => {
    const fonts = installFontsStub({ slowFamily: 'monospace' });
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 320 });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });

    const slow = book.setOptions({ fontFamily: 'monospace', fontSize: 20 });
    const fast = book.setOptions({ fontFamily: 'sans-serif', fontSize: 28 });
    await fast;
    fonts.release();
    await slow;

    expect(book.getOptions().fontFamily).toBe('sans-serif');
    expect(book.getOptions().fontSize).toBe(28);

    const snapshot = layout.snapshot();
    expect(snapshot.config.fontSize).toBe(28);
    // 28px at the sans-serif ratio — not 20px monospace, and not 16px serif.
    expect(snapshot.paragraphs[0].advances[0]).toBe(28 * FAMILY_WIDTH_RATIO['sans-serif']);
  });

  it('keeps the previous options when the font of a staged change fails to load', async () => {
    installFontsStub({ failingFamily: 'monospace' });
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 320 });
    const layout = await book.layoutChapter({ paragraphs: [{ text: 'あいうえお' }] });

    await expect(book.setOptions({ fontFamily: 'monospace', fontSize: 40 })).rejects.toThrow(
      'font fetch failed',
    );

    expect(book.getOptions().fontFamily).toBe('serif');
    expect(book.getOptions().fontSize).toBe(16);
    const snapshot = layout.snapshot();
    expect(snapshot.config.fontSize).toBe(16);
    expect(snapshot.paragraphs[0].advances[0]).toBe(16 * FAMILY_WIDTH_RATIO.serif);
  });
});
