/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontLoader } from '../../src/browser/font-loader.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FontLoader', () => {
  it('marks the font as loaded when document.fonts.check returns true upfront', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const loader = new FontLoader();
    await loader.ensureLoaded('16px serif');
    expect(loader.isLoaded('16px serif')).toBe(true);
  });

  it('throws "Font load failed" when document.fonts.check still returns false after load', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(false);
    vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const loader = new FontLoader();
    await expect(loader.ensureLoaded('16px "NoSuchFont"')).rejects.toThrow(
      'Font load failed: 16px "NoSuchFont"',
    );
    expect(loader.isLoaded('16px "NoSuchFont"')).toBe(false);
  });

  it('skips re-loading once a font is cached as loaded', async () => {
    const checkSpy = vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const loader = new FontLoader();
    await loader.ensureLoaded('16px serif');
    const callsAfterFirst = checkSpy.mock.calls.length;
    await loader.ensureLoaded('16px serif');
    expect(checkSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});
