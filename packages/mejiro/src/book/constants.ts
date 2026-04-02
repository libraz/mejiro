import type { HeadingStyle } from '../render/measures.js';

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
 * Default heading style overrides for levels 1–4.
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
};
