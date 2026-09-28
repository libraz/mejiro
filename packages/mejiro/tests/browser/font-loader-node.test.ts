/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { FontLoader } from '../../src/browser/font-loader.js';
import { MejiroBrowser } from '../../src/browser/integration.js';

describe('font loading without a document', () => {
  it('resolves readiness checks instead of touching document.fonts', async () => {
    expect(typeof document).toBe('undefined');
    const loader = new FontLoader();

    await expect(loader.ensureLoaded('16px "Noto Serif JP"', 'あいう')).resolves.toBeUndefined();
    await expect(loader.ensureLoaded('16px "Noto Serif JP"')).resolves.toBeUndefined();
    expect(() => loader.dispose()).not.toThrow();
  });

  it('preloads a font through MejiroBrowser without rejecting', async () => {
    const browser = new MejiroBrowser();
    await expect(browser.preloadFont('"Noto Serif JP"', 16)).resolves.toBeUndefined();
  });
});
