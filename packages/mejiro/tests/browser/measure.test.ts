/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { CharMeasurer } from '../../src/browser/measure.js';
import { normalizeFontFamily, toFontSpec } from '../../src/browser/types.js';

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
});
