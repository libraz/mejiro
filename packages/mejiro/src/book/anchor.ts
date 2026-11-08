import type { InChapterAnchor } from '../types.js';

export type { InChapterAnchor, ReadingAnchor } from '../types.js';

/**
 * Layout location for an in-chapter anchor, identified by spread + page + line.
 */
export interface AnchorLocation {
  /** Zero-based spread index. */
  spreadIndex: number;
  /** Zero-based page index (= spreadIndex*2 + 0 for right, +1 for left). */
  pageIndex: number;
  /**
   * Zero-based line index across the chapter's flattened line list (i.e. the
   * same index used by {@link LineMetricsResult.metrics}): the lines of every
   * earlier paragraph plus the line within this one.
   */
  lineIndex: number;
  /** Side of the spread the anchor falls on. */
  side: 'right' | 'left';
}

/**
 * A pair of in-chapter anchors that delimits a contiguous range of text.
 *
 * The range is half-open: `start` is included, `end` is the position *after*
 * the last included character. If `start` and `end` are equal the range is
 * empty (a caret position). The order of `start` / `end` is not enforced —
 * callers may pass them in either direction; consuming methods normalize.
 */
export interface AnchorRange {
  /** Start anchor (inclusive). */
  start: InChapterAnchor;
  /** End anchor (exclusive). */
  end: InChapterAnchor;
}

/**
 * Pixel rectangle of a single character in spread-local coordinates.
 *
 * Origin is the top-left of the **right page's content area** (matching
 * {@link BookImage} convention). The right page's content area spans
 * `x in [0, contentWidth]`; the left page's content area spans
 * `x in [-contentWidth, 0]`. `y` runs top-to-bottom along the inline
 * direction (text flow in vertical-rl) and covers `[0, lineWidth]`.
 *
 * `width` is the column block-direction pitch and `height` is the character's
 * inline-direction advance. The character bounding box is
 * `(x, y) ‒ (x + width, y + height)`.
 */
export interface AnchorRect {
  /** Zero-based spread index. */
  spreadIndex: number;
  /** Zero-based page index. */
  pageIndex: number;
  /** Side of the spread the character falls on. */
  side: 'right' | 'left';
  /** Top-left x of the character bounding box (spread-local, content frame). */
  x: number;
  /** Top-left y of the character bounding box (spread-local, content frame). */
  y: number;
  /** Block-direction width (column pitch) in pixels. */
  width: number;
  /** Inline-direction length (character advance) in pixels. */
  height: number;
}
