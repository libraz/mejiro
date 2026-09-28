import type { BookOptions } from './types.js';

export { DEFAULT_HEADING_STYLES } from '../render/measures.js';

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
};
