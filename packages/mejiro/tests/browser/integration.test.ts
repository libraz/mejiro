/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { MejiroBrowser } from '../../src/browser/integration.js';

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

  it("strictFontCheck=true rejects layouts when document.fonts can't confirm the font", async () => {
    const browser = new MejiroBrowser({ strictFontCheck: true });
    // Force the strict-check path: stub document.fonts.check to return false
    // after the loader marks the font as loaded.
    const originalCheck = document.fonts.check;
    let calls = 0;
    vi.spyOn(document.fonts, 'check').mockImplementation(() => {
      calls += 1;
      // First call (inside FontLoader.ensureLoaded) returns true → skip load;
      // second call (in MejiroBrowser.layout strictFontCheck) returns false.
      return calls === 1;
    });
    try {
      await expect(
        browser.layout({ text: 'a', lineWidth: 100, fontFamily: 'serif', fontSize: 16 }),
      ).rejects.toThrow(/Font not available/);
    } finally {
      document.fonts.check = originalCheck;
    }
  });

  it('honours fixedFontFamily / fixedFontSize defaults', async () => {
    const browser = new MejiroBrowser({ fixedFontFamily: 'serif', fixedFontSize: 16 });
    expect(browser.verticalLineWidth(400)).toBeGreaterThan(0);
    await expect(browser.preloadFont()).resolves.toBeUndefined();
  });
});
