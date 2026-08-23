/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { CharMeasurer, deriveRubyFont } from '../../src/browser/measure.js';
import { normalizeFontFamily, toFontSpec } from '../../src/browser/types.js';
import { WidthCache } from '../../src/browser/width-cache.js';

describe('normalizeFontFamily', () => {
  it('passes strings through unchanged', () => {
    expect(normalizeFontFamily('serif')).toBe('serif');
    expect(normalizeFontFamily('"Noto Serif JP", serif')).toBe('"Noto Serif JP", serif');
  });

  it('joins arrays with commas', () => {
    expect(normalizeFontFamily(['serif'])).toBe('serif');
    expect(normalizeFontFamily(['serif', 'sans-serif'])).toBe('serif, sans-serif');
  });

  it('quotes names that contain spaces or non-identifier characters', () => {
    expect(normalizeFontFamily(['Noto Serif JP', 'serif'])).toBe('"Noto Serif JP", serif');
    expect(normalizeFontFamily(['ヒラギノ明朝 ProN'])).toBe('"ヒラギノ明朝 ProN"');
  });

  it('escapes embedded quotes and backslashes', () => {
    expect(normalizeFontFamily(['He said "hi"'])).toBe('"He said \\"hi\\""');
    expect(normalizeFontFamily(['back\\slash'])).toBe('"back\\\\slash"');
  });

  it('toFontSpec composes a CSS font spec for either form', () => {
    expect(toFontSpec('serif', 16)).toBe('16px serif');
    expect(toFontSpec(['Noto Serif JP', 'serif'], 16)).toBe('16px "Noto Serif JP", serif');
  });
});

describe('deriveRubyFont', () => {
  it('halves the base size by default', () => {
    expect(deriveRubyFont('serif', 16)).toBe('8px serif');
    expect(deriveRubyFont('serif', 24)).toBe('12px serif');
    expect(deriveRubyFont('serif', 15)).toBe('7.5px serif');
  });

  it('applies an explicit ratio instead of the default', () => {
    expect(deriveRubyFont('serif', 16, 0.75)).toBe('12px serif');
    expect(deriveRubyFont('serif', 16, 1)).toBe('16px serif');
  });

  it('normalizes an array family the same way toFontSpec does', () => {
    expect(deriveRubyFont(['Noto Serif JP', 'serif'], 16)).toBe('8px "Noto Serif JP", serif');
    expect(deriveRubyFont(['Noto Serif JP', 'serif'], 16)).toBe(
      toFontSpec(['Noto Serif JP', 'serif'], 8),
    );
  });
});

describe('CharMeasurer', () => {
  it('throws a clear error when the canvas has no 2d context', () => {
    const broken = {
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(() => new CharMeasurer({ canvas: broken })).toThrow('Failed to get 2d context');
  });

  it('caches widths after the first measurement', () => {
    const m = new CharMeasurer();
    const fontSpec = '16px serif';
    const w1 = m.measure(fontSpec, 0x3042); // あ
    const cache = m.getCache();
    expect(cache.get(fontSpec, 0x3042)).toBe(w1);
    // Repeat measure must come from the cache (same value)
    expect(m.measure(fontSpec, 0x3042)).toBe(w1);
  });

  it('creates no canvas until the first uncached measurement', () => {
    const createElement = vi.spyOn(document, 'createElement');
    try {
      const m = new CharMeasurer();
      expect(createElement).not.toHaveBeenCalledWith('canvas');

      m.measureAll('16px serif', new Uint32Array([0x3042]));
      expect(createElement).toHaveBeenCalledWith('canvas');
    } finally {
      createElement.mockRestore();
    }
  });

  it('agrees with measure() character by character', () => {
    const text = new Uint32Array([0x3042, 0x6f22, 0x41, 0x20bb7]);
    const fontSpec = '16px serif';

    const perChar = new CharMeasurer();
    const expected = Float32Array.from(text, (cp) => perChar.measure(fontSpec, cp));

    expect([...new CharMeasurer().measureAll(fontSpec, text)]).toEqual([...expected]);
  });

  it('keeps measurements per font spec rather than per character alone', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 16);
    const m = new CharMeasurer({ cache });

    expect(m.measure('16px serif', 0x3042)).toBe(16);
    // A different spec must not be answered from the 16px entry.
    expect(cache.get('32px serif', 0x3042)).toBeUndefined();
  });

  it('populates the shared cache from measureAll so later reads hit it', () => {
    const cache = new WidthCache();
    const text = new Uint32Array([0x3042, 0x3044]);
    const advances = new CharMeasurer({ cache }).measureAll('16px serif', text);

    expect(cache.get('16px serif', 0x3042)).toBe(advances[0]);
    expect(cache.get('16px serif', 0x3044)).toBe(advances[1]);

    // A second measurer sharing the cache needs no canvas at all.
    const createElement = vi.spyOn(document, 'createElement');
    try {
      expect([...new CharMeasurer({ cache }).measureAll('16px serif', text)]).toEqual([
        ...advances,
      ]);
      expect(createElement).not.toHaveBeenCalledWith('canvas');
    } finally {
      createElement.mockRestore();
    }
  });

  it('measures only the characters that are still uncached', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 99);
    const m = new CharMeasurer({ cache });

    const advances = m.measureAll('16px serif', new Uint32Array([0x3042, 0x3044]));

    expect(advances[0]).toBe(99);
    expect(advances[1]).toBe(cache.get('16px serif', 0x3044));
  });

  it('serves a fully cached measureAll without touching a canvas', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 16);
    const createElement = vi.spyOn(document, 'createElement');
    try {
      const m = new CharMeasurer({ cache });
      expect([...m.measureAll('16px serif', new Uint32Array([0x3042]))]).toEqual([16]);
      expect(createElement).not.toHaveBeenCalledWith('canvas');
    } finally {
      createElement.mockRestore();
    }
  });
});
