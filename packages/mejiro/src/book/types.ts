import type { ColumnSlot } from '../exclusion.js';
import type { HeadingStyle } from '../render/measures.js';
import type { RenderPage, RenderSegment } from '../render/types.js';

export type { RubyInputAnnotation } from '../browser/types.js';
export type { HeadingStyle } from '../render/measures.js';

/** Configuration for {@link MejiroBook}. */
export interface BookOptions {
  /** CSS font family (e.g. `'"Noto Serif JP"'`). */
  fontFamily: string;
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

/** A paragraph to lay out, compatible with EPUB chapter paragraphs. */
export interface BookParagraph {
  /** Text string to lay out. */
  text: string;
  /** Ruby annotations for furigana support. */
  rubyAnnotations?: import('../browser/types.js').RubyInputAnnotation[];
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
  right: PageResult;
  /** Left page (second page in the spread). */
  left: PageResult;
  /** Total number of pages in the layout. */
  totalPages: number;
}

/** Result for a single page. */
export interface PageResult {
  /** Paragraph-structured page data (for CSS `writing-mode: vertical-rl` rendering). */
  page: RenderPage;
  /** Flat line list with per-line positioning (for slot-based absolute rendering). */
  lines: PageLine[];
  /** Per-line column slots with position and dimensions. */
  slots: ColumnSlot[];
  /** Whether this page has image exclusions affecting line widths. */
  hasImages: boolean;
}

/** A single line for slot-based rendering. */
export interface PageLine {
  /** Segments (text and ruby) that make up this line. */
  segments: RenderSegment[];
  /** Heading level if this line belongs to a heading paragraph. */
  headingLevel?: number;
  /** Computed font size in pixels for this line (accounts for heading scale). */
  fontSize: number;
}
