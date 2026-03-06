import { WidthCache } from './width-cache.js';

/**
 * Derives a ruby font spec from a base font family and size by scaling the size.
 *
 * @param fontFamily - CSS font family (e.g. '"Noto Serif JP"').
 * @param fontSize - Base font size in pixels.
 * @param ratio - Size ratio for ruby text. @defaultValue 0.5
 * @returns CSS font specification for ruby text.
 */
export function deriveRubyFont(fontFamily: string, fontSize: number, ratio = 0.5): string {
  return `${fontSize * ratio}px ${fontFamily}`;
}

/**
 * Measures character widths using the Canvas 2D API.
 * Maintains an internal cache to avoid redundant measurements.
 */
export class CharMeasurer {
  private ctx: CanvasRenderingContext2D;
  private cache: WidthCache;
  private currentFont = '';

  constructor(options?: { canvas?: HTMLCanvasElement; cache?: WidthCache }) {
    const canvas = options?.canvas ?? document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
    this.cache = options?.cache ?? new WidthCache();
  }

  /**
   * Measures the advance width of a single character.
   * @param fontSpec - CSS font specification.
   * @param codepoint - Unicode codepoint to measure.
   * @returns Width in pixels.
   */
  measure(fontSpec: string, codepoint: number): number {
    const cached = this.cache.get(fontSpec, codepoint);
    if (cached !== undefined) return cached;

    this.setFont(fontSpec);
    const char = String.fromCodePoint(codepoint);
    const width = this.ctx.measureText(char).width;
    this.cache.set(fontSpec, codepoint, width);
    return width;
  }

  /**
   * Measures advance widths for all characters in the text.
   * @param fontSpec - CSS font specification.
   * @param text - Array of Unicode codepoints.
   * @returns Float32Array of advance widths in pixels.
   */
  measureAll(fontSpec: string, text: Uint32Array): Float32Array {
    const advances = new Float32Array(text.length);
    this.setFont(fontSpec);
    for (let i = 0; i < text.length; i++) {
      const cached = this.cache.get(fontSpec, text[i]);
      if (cached !== undefined) {
        advances[i] = cached;
      } else {
        const char = String.fromCodePoint(text[i]);
        const width = this.ctx.measureText(char).width;
        this.cache.set(fontSpec, text[i], width);
        advances[i] = width;
      }
    }
    return advances;
  }

  /** Returns the underlying width cache instance. */
  getCache(): WidthCache {
    return this.cache;
  }

  private setFont(fontSpec: string): void {
    if (this.currentFont !== fontSpec) {
      this.ctx.font = fontSpec;
      this.currentFont = fontSpec;
    }
  }
}
