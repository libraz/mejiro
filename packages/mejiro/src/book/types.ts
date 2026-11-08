import type { MejiroError } from '../errors.js';
import type { ColumnSlot } from '../exclusion.js';
import type { HeadingStyle } from '../render/measures.js';
import type { RenderPage, RenderSegment } from '../render/types.js';
import type {
  BreakCostOptions,
  HeadingLevel,
  KinsokuMode,
  ParagraphKind,
  TextAnalyzer,
} from '../types.js';

export type { HeadingStyle } from '../render/measures.js';
export type { BookParagraph, ChapterSource, HeadingLevel, ParagraphKind } from '../types.js';

/**
 * Configuration for {@link MejiroBook}.
 *
 * The typography keys collected in {@link BookOptionsPatch} can be changed later
 * with {@link MejiroBook.updateOptions}. The rest — `analyzer`,
 * `wordAwareBreaking`, `keepWholePos`, `keepWholePenalty`, `breakCost`,
 * `strictFontCheck`, `pageSize` and `onError` — are read once, at construction.
 */
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
   * @defaultValue {@link DEFAULT_LINE_SPACING} (1.8)
   */
  lineSpacing?: number;
  /** Kinsoku processing mode. @defaultValue 'strict' */
  kinsoku?: KinsokuMode;
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /**
   * Per-level heading style overrides. Keys are heading levels (1–6).
   * Each level can override `scale` and `gapAfterEm`; a level left out keeps
   * its `DEFAULT_HEADING_STYLES` style, scaled by `headingScale`.
   */
  headingStyles?: Record<number, HeadingStyle>;
  /**
   * Heading font scale. Levels 1–6 scale their `DEFAULT_HEADING_STYLES`
   * size in proportion to it unless `headingStyles` sets the level's `scale`;
   * a heading without a level takes it as is.
   * @defaultValue 1.4
   */
  headingScale?: number;
  /**
   * Morphological analyzer used to derive line breaking hints.
   *
   * Consulted only when {@link BookOptions.wordAwareBreaking} asks for hints,
   * and once per paragraph at layout time: a re-break (resize, font change,
   * image exclusion reflow) reuses what the first pass produced, because the
   * analysis of a paragraph cannot change while its text does not.
   *
   * Read at construction; a book never re-analyses the chapters it has
   * already laid out.
   */
  analyzer?: TextAnalyzer;
  /**
   * How far the {@link BookOptions.analyzer}'s findings are allowed to reach
   * into line breaking.
   *
   * - `'off'` — no analysis is run at all. Break positions are decided by the
   *   character-class rules alone.
   * - `'clusters'` — hard clusters only. Break positions stay exactly what the
   *   character-class rules would choose, except where splitting would have
   *   been an outright typesetting error (`第1章` cut after `1`, a Latin word
   *   cut mid-word). This is the safe stage: it can only remove wrong breaks.
   * - `'full'` — clusters plus per-position break penalties, which do move
   *   break positions. Suitable for headings, captions and short measures;
   *   whether it suits body text is a house-style call, because Japanese body
   *   text is not set by breaking at word edges — doing so leaves loose lines.
   *
   * `'off'` is the default so that adding an analyzer to a book never silently
   * reflows an existing layout, and so that a book pays for analysis only when
   * it asked for it.
   *
   * @defaultValue 'off'
   */
  wordAwareBreaking?: 'off' | 'clusters' | 'full';
  /**
   * Parts of speech a break should avoid landing inside, forwarded to
   * {@link deriveTypographyHints} as
   * {@link TypographyHintOptions.keepWholePos}. Read only under `'full'`, the
   * only stage that emits penalties.
   *
   * @defaultValue {@link DEFAULT_KEEP_WHOLE_POS}
   */
  keepWholePos?: readonly string[];
  /**
   * Price of a break inside one of {@link BookOptions.keepWholePos}, forwarded
   * to {@link deriveTypographyHints} as
   * {@link TypographyHintOptions.keepWholePenalty}.
   *
   * @defaultValue 4
   */
  keepWholePenalty?: number;
  /**
   * Weights trading a penalised break position against the line it leaves
   * behind. Forwarded to the line breaker, which ignores it unless break
   * penalties are in play — that is, under `'full'`, or for a paragraph
   * supplying its own {@link BookParagraph.hints} with penalties in them.
   */
  breakCost?: BreakCostOptions;
  /**
   * When true, layout and font changes reject with a `font-unavailable`
   * {@link MejiroError} if the requested font family measures exactly like the
   * host's default font, which is how a silent fallback presents itself.
   * @defaultValue false
   */
  strictFontCheck?: boolean;
  /**
   * Page geometry to lay out for, so a book needs no separate
   * {@link MejiroBook.setPageSize} call. Validated like `setPageSize`.
   */
  pageSize?: PageSize;
  /**
   * Receives the failures a book recovers from instead of throwing: an
   * analyzer that throws while a chapter is laid out arrives here as an
   * `analyzer-failed` {@link MejiroError} whose `cause` is the analyzer's error,
   * and the paragraph is laid out on the character-class rules alone. Reported
   * once per book. Without it the failure is written to `console.warn`.
   */
  onError?: (error: MejiroError) => void;
}

/** The {@link BookOptions} keys {@link MejiroBook.updateOptions} can change after construction. */
export type BookOptionsPatch = Partial<
  Pick<
    BookOptions,
    | 'fontFamily'
    | 'fontSize'
    | 'lineSpacing'
    | 'kinsoku'
    | 'enableHanging'
    | 'headingStyles'
    | 'headingScale'
  >
>;

/**
 * The options a book is using, as {@link MejiroBook.getOptions} reports them:
 * every defaulted key resolved to its value, construction-time keys included.
 */
export type ResolvedBookOptions = Readonly<
  Required<
    Pick<
      BookOptions,
      | 'fontFamily'
      | 'fontSize'
      | 'lineSpacing'
      | 'kinsoku'
      | 'enableHanging'
      | 'headingScale'
      | 'wordAwareBreaking'
    >
  > &
    Pick<
      BookOptions,
      'headingStyles' | 'analyzer' | 'keepWholePos' | 'keepWholePenalty' | 'breakCost'
    >
>;

/** Page geometry configuration. */
export interface PageSize {
  /** Page width in pixels (block direction extent of one page). */
  pageWidth: number;
  /** Line width in pixels (inline direction extent — vertical height of text columns). */
  lineWidth: number;
  /** Horizontal padding on each side of a page in pixels. @defaultValue 0 */
  paddingX?: number;
  /** Vertical padding at the top of a page in pixels. @defaultValue 0 */
  paddingY?: number;
}

/**
 * A {@link PageSize} with every padding resolved and the page's vertical
 * extent: what {@link MejiroBook.fitPageSize} returns and
 * {@link ChapterLayout.geometry} reports. It can be passed back to
 * {@link MejiroBook.setPageSize} or {@link ChapterLayout.resize} as it is.
 */
export interface PageGeometry extends PageSize {
  /** Horizontal padding on each side of a page in pixels. */
  paddingX: number;
  /** Vertical padding at the top of a page in pixels. */
  paddingY: number;
  /** Page height in pixels, padding included. */
  pageHeight: number;
  /** Height of the page's content box in pixels: the page height less its vertical padding. */
  contentHeight: number;
}

/**
 * Typography a {@link ChapterLayout} was last measured with, as
 * {@link ChapterLayout.typography} reports it.
 */
export interface ChapterTypography {
  /** Font family the advances were measured in. */
  readonly fontFamily: import('../browser/types.js').FontFamily;
  /** Body font size in pixels. */
  readonly fontSize: number;
  /** Line spacing multiplier. */
  readonly lineSpacing: number;
}

/** Overrides for {@link MejiroBook.fitPageSize}. */
export interface FitPageSizeOptions {
  /**
   * Horizontal padding on each side of a page in pixels. Defaults to the
   * `--mejiro-page-pad-x` custom property the container inherits from the
   * reader stylesheet, then {@link DEFAULT_PAGE_PADDING}.
   */
  paddingX?: number;
  /**
   * Padding at the top of a page in pixels. Defaults to
   * `--mejiro-page-pad-y`, then {@link DEFAULT_PAGE_PADDING}.
   */
  paddingY?: number;
  /**
   * Padding at the bottom of a page in pixels. Defaults to
   * `--mejiro-page-pad-bottom`, then {@link DEFAULT_PAGE_PADDING}.
   */
  paddingBottom?: number;
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
  /**
   * Number of page columns the spread occupies horizontally. Use `1` for a
   * single-page reader so the page width is derived from the full container
   * width instead of being halved for a two-page spread. `2` is the
   * two-page-spread default.
   * @defaultValue 2
   */
  columns?: 1 | 2;
}

/** Options for {@link ChapterLayout.anchorAt}. */
export interface AnchorAtOptions {
  /**
   * Page of the spread to read: `'right'` is the first page in vertical-rl
   * reading order, `'left'` the second.
   * @defaultValue 'right'
   */
  side?: 'right' | 'left';
}

/**
 * A point in spread-local coordinates, relative to the right page's content
 * top-left as {@link AnchorRect} describes.
 */
export interface SpreadPoint {
  /** Spread-local x in pixels; negative on the left page. */
  x: number;
  /** Spread-local y in pixels. */
  y: number;
}

/** An image rectangle for exclusion layout. Coordinates are relative to the right page's top-left corner. */
export interface BookImage {
  /** Horizontal offset from the left edge of the right page (px). */
  x: number;
  /** Vertical offset from the top of the right page (px). */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Margin around the image in pixels (applied on both inline sides). Defaults to base `fontSize`. */
  margin?: number;
}

/** Result for a two-page spread. */
export interface SpreadResult {
  /** Right page (first page in vertical-rl reading order). */
  readonly right: PageResult;
  /** Left page (second page in the spread). */
  readonly left: PageResult;
  /** Number of pages in the layout. */
  readonly pageCount: number;
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
  readonly headingLevel?: HeadingLevel;
  /**
   * Structural classification of the line's paragraph, `'heading'` for a
   * heading that carries no kind of its own. Slot-mode page components pass it
   * to `paragraphClassName` so a line keeps its paragraph's styling.
   */
  readonly kind?: ParagraphKind;
  /** Computed font size in pixels for this line (accounts for heading scale). */
  readonly fontSize: number;
}
