import type { AnchorLocation } from './anchor.js';

/**
 * Options for {@link ChapterLayout.findText}.
 */
export interface FindTextOptions {
  /**
   * Match a string query case sensitively. A `RegExp` query keeps its own
   * flags and ignores this option.
   * @defaultValue false
   */
  caseSensitive?: boolean;
  /**
   * Cap on the number of matches returned, rounded down; it must be at least
   * `1`. Useful for incremental UIs that only render the first N hits.
   * Unlimited when omitted.
   */
  maxResults?: number;
}

/**
 * A single match returned by {@link ChapterLayout.findText}.
 *
 * Combines the in-chapter codepoint range with the resolved layout location
 * (spread / page / line / side) so callers can both highlight the match and
 * navigate to it.
 */
export interface SearchMatch extends AnchorLocation {
  /** Zero-based paragraph index containing the match. */
  paragraphIndex: number;
  /** Inclusive codepoint offset of the match start (anchor-compatible). */
  startIndex: number;
  /** Exclusive codepoint offset of the match end. */
  endIndex: number;
  /** The matched substring. */
  match: string;
}
