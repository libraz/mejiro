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

  it('does not wait for unrelated document.fonts.ready work after the target font loads', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const originalReady = Object.getOwnPropertyDescriptor(document.fonts, 'ready');
    Object.defineProperty(document.fonts, 'ready', {
      configurable: true,
      value: new Promise<FontFaceSet>(() => {}),
    });

    try {
      const loader = new FontLoader();
      await expect(loader.ensureLoaded('16px serif')).resolves.toBeUndefined();
      expect(loader.isLoaded('16px serif')).toBe(true);
    } finally {
      if (originalReady) {
        Object.defineProperty(document.fonts, 'ready', originalReady);
      } else {
        delete (document.fonts as FontFaceSet & { ready?: Promise<FontFaceSet> }).ready;
      }
    }
  });

  it('does not trust check() for a concrete family that has no FontFace', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const originalIterator = (
      document.fonts as FontFaceSet & Partial<Iterable<{ family: string }>>
    )[Symbol.iterator];
    Object.defineProperty(document.fonts, Symbol.iterator, {
      configurable: true,
      value: function* () {
        yield { family: 'Other Font' };
      },
    });

    try {
      const loader = new FontLoader();
      await expect(loader.ensureLoaded('16px "NoSuchFont"')).rejects.toThrow(
        'Font load failed: 16px "NoSuchFont"',
      );
      expect(loader.isLoaded('16px "NoSuchFont"')).toBe(false);
    } finally {
      if (originalIterator) {
        Object.defineProperty(document.fonts, Symbol.iterator, {
          configurable: true,
          value: originalIterator,
        });
      } else {
        delete (document.fonts as FontFaceSet & Partial<Iterable<{ family: string }>>)[
          Symbol.iterator
        ];
      }
    }
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
