/**
 * Caches measured character widths keyed by font specification and codepoint.
 * Structure: Map<fontKey, Map<codepoint, width>>
 */
export class WidthCache {
  private store = new Map<string, Map<number, number>>();

  /** Retrieves a cached width, or undefined if not cached. */
  get(fontKey: string, codepoint: number): number | undefined {
    return this.store.get(fontKey)?.get(codepoint);
  }

  /** Stores a measured width in the cache. */
  set(fontKey: string, codepoint: number, width: number): void {
    let fontMap = this.store.get(fontKey);
    if (!fontMap) {
      fontMap = new Map();
      this.store.set(fontKey, fontMap);
    }
    fontMap.set(codepoint, width);
  }

  /**
   * Clears cached entries.
   * @param fontKey - If provided, clears only entries for this font. Otherwise clears all.
   */
  clear(fontKey?: string): void {
    if (fontKey) {
      this.store.delete(fontKey);
    } else {
      this.store.clear();
    }
  }

  /**
   * Returns the number of cached entries.
   * @param fontKey - If provided, returns count for this font only. Otherwise returns total.
   */
  size(fontKey?: string): number {
    if (fontKey) {
      return this.store.get(fontKey)?.size ?? 0;
    }
    let total = 0;
    for (const map of this.store.values()) {
      total += map.size;
    }
    return total;
  }
}
