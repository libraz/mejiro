/** Options for {@link WidthCache}. */
export interface WidthCacheOptions {
  /**
   * Maximum number of distinct font specs to retain. When a new font is
   * inserted past the limit, the least-recently-used font is evicted (all
   * of its cached codepoints go with it).
   *
   * `Infinity` (default) disables font-level eviction, which is fine for
   * typical reader sessions with a handful of fonts. Set a finite value
   * when long-running hosts switch fonts frequently.
   * @defaultValue Infinity
   */
  maxFonts?: number;
  /**
   * Maximum number of cached codepoints per font. When a font's cache
   * crosses this limit the least-recently-used codepoint is dropped. Use
   * this to bound memory on multilingual corpora.
   * @defaultValue Infinity
   */
  maxCodepointsPerFont?: number;
}

/** Aggregate size of a {@link WidthCache}. */
export interface WidthCacheStats {
  /** Number of distinct font specs with cached entries. */
  fonts: number;
  /** Total number of cached codepoint widths across all font specs. */
  codepoints: number;
}

/**
 * Caches measured character widths keyed by font specification and codepoint.
 *
 * Optional LRU bounds are available through {@link WidthCacheOptions} so
 * long-running hosts can cap memory use without sacrificing the per-font
 * codepoint map. Internally we rely on Map's insertion-order iteration to
 * implement the LRU policy.
 */
export class WidthCache {
  private store = new Map<string, Map<number, number>>();
  private readonly maxFonts: number;
  private readonly maxCodepointsPerFont: number;

  /**
   * Creates an empty cache. Both bounds default to `Infinity`, which turns the
   * LRU bookkeeping off entirely — reads skip the reinsertion that maintains
   * recency order — so leave them unset unless memory actually needs capping.
   *
   * @param options - Optional per-font and per-codepoint LRU limits.
   */
  constructor(options: WidthCacheOptions = {}) {
    this.maxFonts = options.maxFonts ?? Number.POSITIVE_INFINITY;
    this.maxCodepointsPerFont = options.maxCodepointsPerFont ?? Number.POSITIVE_INFINITY;
  }

  /** Retrieves a cached width, or undefined if not cached. */
  get(fontSpec: string, codepoint: number): number | undefined {
    const fontMap = this.store.get(fontSpec);
    if (!fontMap) return undefined;
    const value = fontMap.get(codepoint);
    if (value == null) return undefined;
    // Touch both layers so the LRU order tracks actual usage.
    if (Number.isFinite(this.maxFonts)) {
      this.store.delete(fontSpec);
      this.store.set(fontSpec, fontMap);
    }
    if (Number.isFinite(this.maxCodepointsPerFont)) {
      fontMap.delete(codepoint);
      fontMap.set(codepoint, value);
    }
    return value;
  }

  /** Stores a measured width in the cache. */
  set(fontSpec: string, codepoint: number, width: number): void {
    let fontMap = this.store.get(fontSpec);
    if (!fontMap) {
      fontMap = new Map();
      this.store.set(fontSpec, fontMap);
      while (this.store.size > this.maxFonts) {
        const oldest = this.store.keys().next().value;
        if (oldest === undefined || oldest === fontSpec) break;
        this.store.delete(oldest);
      }
    } else {
      // Promote to MRU on every set when font-eviction is enabled.
      if (Number.isFinite(this.maxFonts)) {
        this.store.delete(fontSpec);
        this.store.set(fontSpec, fontMap);
      }
    }
    fontMap.set(codepoint, width);
    while (fontMap.size > this.maxCodepointsPerFont) {
      const oldestKey = fontMap.keys().next().value;
      if (oldestKey === undefined || oldestKey === codepoint) break;
      fontMap.delete(oldestKey);
    }
  }

  /**
   * Clears cached entries.
   * @param fontSpec - If provided, clears only entries for this font spec. Otherwise clears all.
   */
  clear(fontSpec?: string): void {
    if (fontSpec) {
      this.store.delete(fontSpec);
    } else {
      this.store.clear();
    }
  }

  /**
   * Returns the number of cached entries.
   * @param fontSpec - If provided, returns count for this font only. Otherwise returns total.
   */
  size(fontSpec?: string): number {
    if (fontSpec) {
      return this.store.get(fontSpec)?.size ?? 0;
    }
    let total = 0;
    for (const map of this.store.values()) {
      total += map.size;
    }
    return total;
  }

  /** Returns the number of distinct font specs with cached entries. */
  fontCount(): number {
    return this.store.size;
  }

  /** Returns aggregate cache statistics. */
  stats(): WidthCacheStats {
    return { fonts: this.fontCount(), codepoints: this.size() };
  }
}
