import { DEFAULT_LINE_SPACING } from '../types.js';
import type { BookOptions, FitPageSizeOptions } from './types.js';

export { DEFAULT_HEADING_STYLES } from '../render/measures.js';
export { DEFAULT_LINE_SPACING } from '../types.js';

/**
 * Default page padding values in pixels for the reading surface, under the
 * {@link FitPageSizeOptions} keys they default.
 */
export const DEFAULT_PAGE_PADDING: Readonly<
  Required<Pick<FitPageSizeOptions, 'paddingX' | 'paddingY' | 'paddingBottom'>>
> = {
  /** Horizontal padding on each side of a page. */
  paddingX: 52,
  /** Top padding of a page. */
  paddingY: 56,
  /** Bottom padding of a page. */
  paddingBottom: 40,
};

/**
 * Default page geometry used by {@link MejiroBook.fitPageSize}.
 *
 * `headerOffset` and `gutterOffset` are space reserved on the container
 * (header chrome height + spread gutter), measured outside of a page's
 * own padding.
 */
export const DEFAULT_PAGE_GEOMETRY: Readonly<
  Required<
    Pick<
      FitPageSizeOptions,
      'aspect' | 'minWidth' | 'minHeight' | 'maxHeight' | 'headerOffset' | 'gutterOffset'
    >
  >
> = {
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
  lineSpacing: DEFAULT_LINE_SPACING,
  kinsoku: 'strict',
  enableHanging: true,
};
