/**
 * Manages font loading via the CSS Font Loading API.
 * Ensures fonts are fully loaded before measurement begins.
 */
export class FontLoader {
  private loaded = new Set<string>();

  /**
   * Ensures the specified font is loaded and available for rendering.
   * @param fontSpec - CSS font specification (e.g. '16px "Noto Serif JP"').
   * @throws If the font fails to load.
   */
  async ensureLoaded(fontSpec: string): Promise<void> {
    if (this.loaded.has(fontSpec)) return;

    if (document.fonts.check(fontSpec)) {
      this.loaded.add(fontSpec);
      return;
    }

    await document.fonts.load(fontSpec);
    await document.fonts.ready;

    if (!document.fonts.check(fontSpec)) {
      throw new Error(`Font load failed: ${fontSpec}`);
    }

    this.loaded.add(fontSpec);
  }

  /**
   * Returns whether the specified font has been successfully loaded.
   * @param fontSpec - CSS font specification to check.
   */
  isLoaded(fontSpec: string): boolean {
    return this.loaded.has(fontSpec);
  }
}
