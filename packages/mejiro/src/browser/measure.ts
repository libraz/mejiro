import { type FontFamily, normalizeFontFamily } from './types.js';
import { WidthCache } from './width-cache.js';

/**
 * Derives a ruby font spec from a base font family and size by scaling the size.
 *
 * @param fontFamily - CSS font family (string or array).
 * @param fontSize - Base font size in pixels.
 * @param ratio - Size ratio for ruby text. @defaultValue 0.5
 * @returns CSS font specification for ruby text.
 */
export function deriveRubyFont(fontFamily: FontFamily, fontSize: number, ratio = 0.5): string {
  return `${fontSize * ratio}px ${normalizeFontFamily(fontFamily)}`;
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context');
  return ctx;
}

/**
 * Measures character widths using the Canvas 2D API.
 * Maintains an internal cache to avoid redundant measurements.
 *
 * Constructing a measurer touches no DOM API: when no canvas is supplied, one
 * is created on the first uncached measurement. That keeps the whole
 * construction path — including `MejiroBrowser` and `MejiroBook` — usable on a
 * server, where snapshots are replayed and nothing is measured.
 */
export class CharMeasurer {
  private ctx: CanvasRenderingContext2D | null = null;
  private cache: WidthCache;
  private currentFont = '';

  /**
   * @param options - Optional collaborators.
   * @param options.canvas - Canvas to measure against. Validated eagerly, so a
   *   canvas that yields no 2D context throws here rather than at first
   *   measurement. When omitted, a canvas is created lazily on the first
   *   uncached measurement, which keeps construction DOM-free.
   * @param options.cache - Width cache to read and populate. Pass a shared cache
   *   to reuse measurements across measurers, and note that the cache is then
   *   shared state: a caller that swaps fonts at runtime must invalidate it.
   *   @defaultValue a private unbounded {@link WidthCache}
   * @throws When `options.canvas` is supplied but has no 2D rendering context.
   */
  constructor(options?: { canvas?: HTMLCanvasElement; cache?: WidthCache }) {
    // An injected canvas is validated eagerly: the caller already owns it, so
    // there is nothing to defer and a broken one is worth reporting up front.
    if (options?.canvas) this.ctx = contextOf(options.canvas);
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

    const ctx = this.context();
    this.setFont(ctx, fontSpec);
    const char = String.fromCodePoint(codepoint);
    const width = ctx.measureText(char).width;
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
    let ctx: CanvasRenderingContext2D | null = null;
    for (let i = 0; i < text.length; i++) {
      const cached = this.cache.get(fontSpec, text[i]);
      if (cached !== undefined) {
        advances[i] = cached;
        continue;
      }
      if (!ctx) {
        ctx = this.context();
        this.setFont(ctx, fontSpec);
      }
      const char = String.fromCodePoint(text[i]);
      const width = ctx.measureText(char).width;
      this.cache.set(fontSpec, text[i], width);
      advances[i] = width;
    }
    return advances;
  }

  /** Returns the underlying width cache instance. */
  getCache(): WidthCache {
    return this.cache;
  }

  private context(): CanvasRenderingContext2D {
    this.ctx ??= contextOf(document.createElement('canvas'));
    return this.ctx;
  }

  private setFont(ctx: CanvasRenderingContext2D, fontSpec: string): void {
    if (this.currentFont !== fontSpec) {
      ctx.font = fontSpec;
      this.currentFont = fontSpec;
    }
  }
}
