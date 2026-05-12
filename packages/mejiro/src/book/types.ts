import type { ColumnSlot } from '../exclusion.js';
import type { HeadingStyle } from '../render/measures.js';
import type { RenderPage, RenderSegment } from '../render/types.js';

export type { RubyInputAnnotation } from '../browser/types.js';
export type { HeadingStyle } from '../render/measures.js';

/** Configuration for {@link MejiroBook}. */
export interface BookOptions {
  /**
   * CSS font family. Either a CSS-ready string (e.g. `'"Noto Serif JP", serif'`)
   * or an array of family names (e.g. `['Noto Serif JP', 'serif']`). Arrays are
   * escaped + joined per CSS rules.
   */
  fontFamily: import('../browser/types.js').FontFamily;
  /** Base font size in pixels. */
  fontSize: number;
  /**
   * Line spacing multiplier. Controls the pitch between adjacent columns
   * in vertical writing mode (equivalent to CSS `line-height`).
   * @defaultValue 1.8
   */
  lineSpacing?: number;
  /** Kinsoku processing mode. @defaultValue 'strict' */
  mode?: 'strict' | 'loose';
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /**
   * Per-level heading style overrides. Keys are heading levels (1–6).
   * Each level can override `scale` and `gapAfterEm`.
   */
  headingStyles?: Record<number, HeadingStyle>;
  /**
   * Default scale factor for heading font sizes when no per-level
   * style is defined in `headingStyles`.
   * @defaultValue 1.4
   */
  headingScale?: number;
}

/** Page geometry configuration. */
export interface PageSize {
  /** Page width in pixels (block direction extent of one page). */
  pageWidth: number;
  /** Line width in pixels (inline direction extent — vertical height of text columns). */
  lineWidth: number;
  /** Horizontal padding on each side of a page in pixels. @defaultValue 0 */
  pagePaddingX?: number;
  /** Vertical padding at the top of a page in pixels. @defaultValue 0 */
  pagePaddingY?: number;
}

/** Overrides for {@link MejiroBook.computePageSize}. */
export interface ComputePageSizeOptions {
  /**
   * Per-page padding overrides applied via {@link MejiroBook.setPageSize}.
   * Defaults to {@link DEFAULT_PAGE_PADDING}.
   */
  padding?: { x?: number; y?: number; bottom?: number };
  /** Page aspect ratio (height / width). @defaultValue 1.45 */
  aspect?: number;
  /** Minimum page width in pixels. @defaultValue 280 */
  minWidth?: number;
  /** Minimum page height in pixels. @defaultValue 400 */
  minHeight?: number;
  /** Maximum page height in pixels. @defaultValue 780 */
  maxHeight?: number;
  /**
   * Pixels reserved at the top of the container for header chrome.
   * @defaultValue 56
   */
  headerOffset?: number;
  /**
   * Horizontal pixels reserved across the container (gutter between/around the two pages).
   * @defaultValue 48
   */
  gutterOffset?: number;
}

/**
 * Structural classification of a {@link BookParagraph}.
 *
 * - `'body'` — ordinary body text (the default when `kind` is omitted).
 * - `'heading'` — heading paragraph; pair with {@link BookParagraph.headingLevel}.
 * - `'blockquote'` — quoted block.
 * - `'sceneBreak'` — visible scene divider (e.g. `* * *`); typically rendered
 *   without body text.
 * - `'pre'` — preformatted text (no automatic line breaks). Reserved.
 * - `'figure'` — figure container (image + optional caption). Reserved.
 */
export type ParagraphKind = 'body' | 'heading' | 'blockquote' | 'sceneBreak' | 'pre' | 'figure';

/** A paragraph to lay out, compatible with EPUB chapter paragraphs. */
export interface BookParagraph {
  /** Text string to lay out. */
  text: string;
  /**
   * Structural kind of the paragraph. Defaults to `'heading'` if
   * {@link BookParagraph.headingLevel} is set, otherwise `'body'`.
   */
  kind?: ParagraphKind;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations?: readonly import('../browser/types.js').InlineAnnotation[];
  /** Heading level (1–6), or undefined for body text. */
  headingLevel?: number;
}

/** An image rectangle for exclusion layout. Coordinates are relative to the right page's top-left corner. */
export interface BookImage {
  /** Horizontal offset from the left edge of the right page (px). */
  x: number;
  /** Vertical offset from the top of the right page (px). */
  y: number;
  /** Width in pixels. */
  w: number;
  /** Height in pixels. */
  h: number;
  /** Margin around the image in pixels (applied on both inline sides). Defaults to base `fontSize`. */
  margin?: number;
}

/** Result for a two-page spread. */
export interface SpreadResult {
  /** Right page (first page in vertical-rl reading order). */
  readonly right: PageResult;
  /** Left page (second page in the spread). */
  readonly left: PageResult;
  /** Total number of pages in the layout. */
  readonly totalPages: number;
}

/** Result for a single page. */
export interface PageResult {
  /** Paragraph-structured page data (for CSS `writing-mode: vertical-rl` rendering). */
  readonly page: RenderPage;
  /** Flat line list with per-line positioning (for slot-based absolute rendering). */
  readonly lines: readonly PageLine[];
  /** Per-line column slots with position and dimensions. */
  readonly slots: readonly ColumnSlot[];
  /** Whether this page has image exclusions affecting line widths. */
  readonly hasImages: boolean;
}

/** A single line for slot-based rendering. */
export interface PageLine {
  /** Segments (text and ruby) that make up this line. */
  readonly segments: readonly RenderSegment[];
  /** Heading level if this line belongs to a heading paragraph. */
  readonly headingLevel?: number;
  /** Computed font size in pixels for this line (accounts for heading scale). */
  readonly fontSize: number;
}
