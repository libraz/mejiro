import type { AnchorLocation } from './anchor.js';

/**
 * Options for {@link ChapterLayout.findText}.
 */
export interface FindTextOptions {
  /**
   * Treat `query` as a regular expression source string instead of a literal
   * substring. The pattern is compiled with the `g` flag plus `i` when
   * {@link FindTextOptions.caseSensitive} is `false`.
   * @defaultValue false
   */
  regex?: boolean;
  /**
   * Match case sensitively. When `false`, both literal and regex matches use
   * the `i` flag.
   * @defaultValue false
   */
  caseSensitive?: boolean;
  /**
   * Cap on the number of matches returned. Useful for incremental UIs that
   * only render the first N hits.
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
  paragraph: number;
  /** Inclusive codepoint offset of the match start (anchor-compatible). */
  charStart: number;
  /** Exclusive codepoint offset of the match end. */
  charEnd: number;
  /** The matched substring. */
  match: string;
}
