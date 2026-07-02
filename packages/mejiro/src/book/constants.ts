import type { HeadingStyle } from '../render/measures.js';
import type { BookOptions } from './types.js';

/** Default page padding values in pixels for the reading surface. */
export const DEFAULT_PAGE_PADDING = {
  /** Horizontal padding on each side of a page. */
  x: 52,
  /** Top padding of a page. */
  y: 56,
  /** Bottom padding of a page. */
  bottom: 40,
} as const;

/**
 * Default page geometry used by {@link MejiroBook.computePageSize}.
 *
 * `headerOffset` and `gutterOffset` are space reserved on the container
 * (header chrome height + spread gutter), measured outside of a page's
 * own padding.
 */
export const DEFAULT_PAGE_GEOMETRY = {
  /** Page aspect ratio (height / width). */
  aspect: 1.45,
  /** Minimum page width in pixels. */
  minWidth: 280,
  /** Minimum page height in pixels. */
  minHeight: 400,
  /** Maximum page height in pixels. */
  maxHeight: 780,
  /** Header chrome height reserved at the top of the container in pixels. */
  headerOffset: 56,
  /** Horizontal gutter reserved between/around the two pages in pixels. */
  gutterOffset: 48,
} as const;

/**
 * Default heading style overrides for levels 1–6.
 *
 * @example
 * ```ts
 * const book = new MejiroBook({
 *   fontFamily: 'serif',
 *   fontSize: 16,
 *   headingStyles: DEFAULT_HEADING_STYLES,
 * });
 * ```
 */
export const DEFAULT_HEADING_STYLES: Readonly<Record<number, HeadingStyle>> = {
  1: { scale: 1.6, gapAfterEm: 1.4 },
  2: { scale: 1.4, gapAfterEm: 1.2 },
  3: { scale: 1.2, gapAfterEm: 1.0 },
  4: { scale: 1.1, gapAfterEm: 0.8 },
  5: { scale: 1.0, gapAfterEm: 0.6 },
  6: { scale: 1.0, gapAfterEm: 0.6 },
};

/**
 * Sensible defaults for {@link BookOptions}. Used by framework components
 * when no `options` prop is supplied so `<MejiroReader />` works out of the
 * box. Override individual fields by spreading:
 *
 * ```ts
 * { ...DEFAULT_BOOK_OPTIONS, fontFamily: '"Noto Serif JP"', fontSize: 18 }
 * ```
 */
export const DEFAULT_BOOK_OPTIONS: Readonly<BookOptions> = {
  fontFamily: 'serif',
  fontSize: 16,
  lineSpacing: 1.8,
  mode: 'strict',
  enableHanging: true,
  headingStyles: DEFAULT_HEADING_STYLES,
};
