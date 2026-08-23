/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { layoutText, MejiroBrowser } from '../../src/browser/integration.js';
import { tokenLengthsToBoundaries } from '../../src/tokenize.js';

describe('MejiroBrowser argument validation', () => {
  it('layout() rejects when fontFamily is missing', async () => {
    const browser = new MejiroBrowser();
    await expect(browser.layout({ text: 'a', lineWidth: 100, fontSize: 16 })).rejects.toThrow(
      'fontFamily must be specified',
    );
  });

  it('layout() rejects when fontSize is missing', async () => {
    const browser = new MejiroBrowser();
    await expect(
      browser.layout({ text: 'a', lineWidth: 100, fontFamily: 'serif' }),
    ).rejects.toThrow('fontSize must be specified');
  });

  it('preloadFont() rejects when font family or size is missing', async () => {
    const browser = new MejiroBrowser();
    await expect(browser.preloadFont(undefined, 16)).rejects.toThrow(
      'fontFamily must be specified',
    );
    await expect(browser.preloadFont('serif', undefined)).rejects.toThrow(
      'fontSize must be specified',
    );
  });

  it('layoutChapter() rejects when font family or size is missing', async () => {
    const browser = new MejiroBrowser();
    await expect(
      browser.layoutChapter({ paragraphs: [], lineWidth: 100, fontSize: 16 }),
    ).rejects.toThrow('fontFamily must be specified');
    await expect(
      browser.layoutChapter({ paragraphs: [], lineWidth: 100, fontFamily: 'serif' }),
    ).rejects.toThrow('fontSize must be specified');
  });

  it('verticalLineWidth() throws when no fontSize is configured', () => {
    const browser = new MejiroBrowser();
    expect(() => browser.verticalLineWidth(400)).toThrow('fontSize must be specified');
  });

  it('strictFontCheck=true rejects a layout whose family measures as the default font', async () => {
    // The shared canvas stub measures every family identically, which is the
    // signature strictFontCheck looks for.
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ strictFontCheck: true });

    await expect(
      browser.layout({ text: 'a', lineWidth: 100, fontFamily: 'serif', fontSize: 16 }),
    ).rejects.toThrow(/Font not available/);
  });

  it('strictFontCheck=false lays out the same input without complaint', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser();

    await expect(
      browser.layout({ text: 'a', lineWidth: 100, fontFamily: 'serif', fontSize: 16 }),
    ).resolves.toBeDefined();
  });

  it('breaks identically with and without render-only annotations', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    const text = '昭和五十六年に刊行された作品である';

    const plain = await browser.layout({ text, lineWidth: 100 });
    const annotated = await browser.layout({
      text,
      lineWidth: 100,
      inlineAnnotations: [
        { kind: 'emphasis', startIndex: 8, endIndex: 11 },
        { kind: 'em', startIndex: 12, endIndex: 14 },
        { kind: 'strong', startIndex: 14, endIndex: 16 },
        { kind: 'footnote', startIndex: 6, endIndex: 7, noteId: 'n1' },
        { kind: 'link', startIndex: 0, endIndex: 2, href: '#note' },
      ],
    });

    expect([...annotated.breakPoints]).toEqual([...plain.breakPoints]);
  });

  it('lets ruby annotations change break points', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    const text = '昭和五十六年に刊行された作品である';

    const plain = await browser.layout({ text, lineWidth: 100 });
    const rubied = await browser.layout({
      text,
      lineWidth: 100,
      inlineAnnotations: [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'しょうわ', type: 'group' },
      ],
    });

    expect([...rubied.breakPoints]).not.toEqual([...plain.breakPoints]);
  });

  it('reserves one em for a tcy span instead of the sum of its characters', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    // 昭和[五十六]年に… — the stub measurer gives every character 10px, so the
    // span measures 30px on its own and one em is 16px.
    const text = '昭和五十六年に刊行された作品である';

    const result = await browser.layout({
      text,
      lineWidth: 100,
      inlineAnnotations: [{ kind: 'tcy', startIndex: 2, endIndex: 5 }],
    });

    const advances = result.effectiveAdvances as Float32Array;
    expect(advances).toBeDefined();
    const combined = advances[2] + advances[3] + advances[4];
    expect(combined).toBeCloseTo(16, 4);
    // Characters outside the span keep their measured advance.
    expect(advances[1]).toBeCloseTo(10, 4);
    expect(advances[5]).toBeCloseTo(10, 4);
  });

  it('never breaks a line inside a tcy span', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    const text = '昭和五十六年に刊行された作品である';
    // A break after index 2 or 3 would cut the combined box in half.
    const insideSpan = (breakPoints: Uint32Array) =>
      [...breakPoints].some((bp) => bp >= 2 && bp <= 3);

    const combined = await browser.layout({
      text,
      lineWidth: 45,
      inlineAnnotations: [{ kind: 'tcy', startIndex: 2, endIndex: 5 }],
    });
    const plain = await browser.layout({ text, lineWidth: 45 });

    expect(insideSpan(combined.breakPoints)).toBe(false);
    // Same width without the annotation does break there, so the assertion
    // above is testing the cluster and not the geometry.
    expect(insideSpan(plain.breakPoints)).toBe(true);
  });

  it('moves caller-supplied annotations onto the NFC text it lays out', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    // Decomposed source: KA + dakuten, KI + dakuten, KU — five characters,
    // three after NFC.
    const text = '\u304b\u3099\u304d\u3099\u304f';

    const result = await browser.layout({
      text,
      lineWidth: 200,
      inlineAnnotations: [
        // Indices address the decomposed text the caller passed in: [2, 4)
        // is KI + dakuten, which composes to the second NFC character.
        { kind: 'ruby', startIndex: 2, endIndex: 4, rubyText: 'ながいよみ', type: 'group' },
      ],
    });

    const advances = result.effectiveAdvances as Float32Array;
    expect(advances).toHaveLength(3);
    // The ruby reading measures 50px over a 10px base, so the widened
    // character is the one the annotation was authored for.
    expect(advances[1]).toBeCloseTo(50, 4);
    expect(advances[0]).toBeCloseTo(10, 4);
    expect(advances[2]).toBeCloseTo(10, 4);
  });

  it('moves a caller-supplied tcy span onto the NFC text it lays out', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    const text = '\u304b\u3099\u304d\u3099\u304f';

    const result = await browser.layout({
      text,
      lineWidth: 200,
      // [0, 4) in the decomposed text covers both dakuten pairs, which is
      // the first two NFC characters.
      inlineAnnotations: [{ kind: 'tcy', startIndex: 0, endIndex: 4 }],
    });

    const advances = result.effectiveAdvances as Float32Array;
    expect(advances).toHaveLength(3);
    expect(advances[0] + advances[1]).toBeCloseTo(16, 4);
    expect(advances[2]).toBeCloseTo(10, 4);
  });

  it('honours fixedFontFamily / fixedFontSize defaults', async () => {
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    expect(browser.verticalLineWidth(400)).toBeGreaterThan(0);
    await expect(browser.preloadFont()).resolves.toBeUndefined();
  });

  it('returns NFC-normalized chars from layoutChapter', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });

    const result = await browser.layoutChapter({
      paragraphs: [{ text: 'か\u3099く' }],
      lineWidth: 100,
    });

    expect(result.paragraphs[0].chars).toEqual(['が', 'く']);
    expect(result.paragraphs[0].breakResult.breakPoints).toHaveLength(0);
  });

  it('lets layoutText break at token boundaries', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    // "新しい"(3) + "プログラミング"(7) + "言語"(2), 10px per character.
    const text = '新しいプログラミング言語';
    const options = { text, fontFamily: 'serif', fontSize: 16, lineWidth: 50 };

    const plain = await layoutText(options);
    const tokenized = await layoutText({
      ...options,
      tokenBoundaries: tokenLengthsToBoundaries([3, 7, 2]),
    });

    expect([...plain.breakPoints]).not.toContain(2);
    expect([...tokenized.breakPoints]).toContain(2);
  });

  it('breaks identically in layoutText and MejiroBrowser.layout for every shared option', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const options = {
      text: '新しいプログラミング言語を学ぶ',
      fontFamily: 'serif',
      fontSize: 16,
      lineWidth: 50,
      mode: 'loose' as const,
      enableHanging: false,
      inlineAnnotations: [
        {
          kind: 'ruby' as const,
          startIndex: 10,
          endIndex: 12,
          rubyText: 'げんご',
          type: 'group' as const,
        },
        { kind: 'tcy' as const, startIndex: 0, endIndex: 1 },
      ],
      tokenBoundaries: tokenLengthsToBoundaries([3, 7, 2, 3]),
    };

    const oneShot = await layoutText(options);
    const instance = await new MejiroBrowser().layout(options);

    expect([...oneShot.breakPoints]).toEqual([...instance.breakPoints]);
  });

  it('clears measured width cache when document fonts finish loading', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    let loadingDone: (() => void) | undefined;
    const originalAddEventListener = (
      document.fonts as FontFaceSet & Partial<Pick<EventTarget, 'addEventListener'>>
    ).addEventListener;
    Object.defineProperty(document.fonts, 'addEventListener', {
      configurable: true,
      value: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'loadingdone') {
          loadingDone =
            typeof listener === 'function'
              ? () => listener(new Event('loadingdone'))
              : () => listener.handleEvent(new Event('loadingdone'));
        }
      },
    });
    try {
      const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });

      await browser.layout({ text: 'abc', lineWidth: 100 });
      expect(browser.cacheStats().codepoints).toBeGreaterThan(0);

      loadingDone?.();
      expect(browser.cacheStats()).toEqual({ fonts: 0, codepoints: 0 });
    } finally {
      if (originalAddEventListener) {
        Object.defineProperty(document.fonts, 'addEventListener', {
          configurable: true,
          value: originalAddEventListener,
        });
      } else {
        delete (document.fonts as FontFaceSet & Partial<Pick<EventTarget, 'addEventListener'>>)
          .addEventListener;
      }
    }
  });
});
