import type {
  BreakCostOptions,
  BreakResult,
  InlineAnnotation,
  KinsokuMode,
  TypographyHints,
} from '../types.js';

export type {
  InlineAnnotation,
  InlineEmAnnotation,
  InlineEmphasisAnnotation,
  InlineFootnoteAnnotation,
  InlineLinkAnnotation,
  InlineRubyAnnotation,
  InlineStrongAnnotation,
  InlineTcyAnnotation,
} from '../types.js';

/**
 * Configuration options for the MejiroBrowser instance.
 */
export interface MejiroBrowserOptions {
  /**
   * Default font family, used by every layout call that does not pass its own.
   * An empty value throws a `TypeError`.
   */
  fontFamily?: FontFamily;
  /**
   * Default font size in pixels, used by every layout call that does not pass
   * its own. Must be a positive finite number; anything else throws a `RangeError`.
   */
  fontSize?: number;
  /**
   * When true, `layout()`, `layoutParagraphs()` and `preloadFont()` throw if the
   * requested family measures exactly like the host's default font, which is
   * how a silent fallback presents itself. When false (the default), they
   * proceed with whatever the host resolved, even if the web font failed to load.
   */
  strictFontCheck?: boolean;
  /**
   * Called after the host reports newly loaded fonts (`loadingdone`) and the
   * width cache has been cleared. Results measured before that point may hold
   * fallback widths; re-lay them out here.
   */
  onFontsLoaded?: () => void;
}

/**
 * A paragraph to lay out, with text and optional inline annotations.
 */
export interface ParagraphInput {
  /** Text string to lay out. */
  text: string;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations?: readonly InlineAnnotation[];
  /** Font family override for this paragraph (e.g. for headings with a different typeface). */
  fontFamily?: FontFamily;
  /** Font size override in pixels for this paragraph (e.g. for headings). */
  fontSize?: number;
  /**
   * Token boundary indices for morphological-aware line breaking.
   * @see {@link LayoutInput.tokenBoundaries}
   */
  tokenBoundaries?: Uint32Array | readonly number[];
  /**
   * Line breaking hints derived from a morphological analysis of this
   * paragraph. Offsets address the NFC text, the same coordinate system the
   * returned `chars` and the inline annotations use.
   * @see {@link deriveTypographyHints}
   */
  hints?: TypographyHints;
}

/**
 * Options for laying out several paragraphs in one call.
 * @see {@link MejiroBrowser.layoutParagraphs}
 */
export interface ChapterLayoutOptions {
  /** Paragraphs to lay out. */
  paragraphs: readonly ParagraphInput[];
  /** CSS font family for body text. Falls back to {@link MejiroBrowserOptions.fontFamily}. */
  fontFamily?: FontFamily;
  /** Font size in pixels for body text. Falls back to {@link MejiroBrowserOptions.fontSize}. */
  fontSize?: number;
  /** Available line width in pixels (use `verticalLineWidth()` for vertical text). */
  lineWidth: number;
  /** Kinsoku mode. @defaultValue 'strict' */
  kinsoku?: KinsokuMode;
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /**
   * Weights for the penalty search, applied to every paragraph. Has no effect
   * unless a paragraph carries {@link ParagraphInput.hints} with break
   * penalties in them.
   */
  breakCost?: BreakCostOptions;
}

/**
 * Layout result for a single paragraph.
 */
export interface ParagraphLayoutResult {
  /** Break result from the line breaking algorithm. */
  breakResult: BreakResult;
  /** Character array of the paragraph text, indexed by NFC Unicode codepoint. */
  chars: readonly string[];
}

/**
 * Result of {@link MejiroBrowser.layoutParagraphs}.
 */
export interface ParagraphsLayoutResult {
  /** Per-paragraph layout results. */
  paragraphs: readonly ParagraphLayoutResult[];
}

/**
 * Options for a single layout operation.
 */
export interface LayoutOptions {
  /** Text string to lay out. */
  text: string;
  /** CSS font family. Overrides {@link MejiroBrowserOptions.fontFamily}. */
  fontFamily?: FontFamily;
  /** Font size in pixels. Overrides {@link MejiroBrowserOptions.fontSize}. */
  fontSize?: number;
  /** Available line width in pixels. */
  lineWidth: number;
  /** Kinsoku mode. @defaultValue 'strict' */
  kinsoku?: KinsokuMode;
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations?: readonly InlineAnnotation[];
  /**
   * Token boundary indices for morphological-aware line breaking.
   * @see {@link LayoutInput.tokenBoundaries}
   */
  tokenBoundaries?: Uint32Array | readonly number[];
  /**
   * Line breaking hints derived from a morphological analysis of `text`.
   * Offsets address the NFC form of `text`, which is what the layout runs on.
   * @see {@link deriveTypographyHints}
   */
  hints?: TypographyHints;
  /**
   * Weights for the penalty search. Has no effect unless `hints` carries break
   * penalties.
   */
  breakCost?: BreakCostOptions;
}

/**
 * Options for the standalone {@link layoutText}.
 *
 * The fields of {@link LayoutOptions}, except that `fontFamily` and `fontSize`
 * are required: there is no instance to inherit defaults from.
 */
export interface LayoutTextOptions extends LayoutOptions {
  /** CSS font family. */
  fontFamily: FontFamily;
  /** Font size in pixels. */
  fontSize: number;
}

/**
 * Font family specifier. Either a CSS-ready string (e.g. `'"Noto Serif JP", serif'`)
 * or an array of family names (e.g. `['Noto Serif JP', 'serif']`). Arrays are
 * escaped + joined per CSS rules by {@link normalizeFontFamily}.
 */
export type FontFamily = string | readonly string[];

const SAFE_FONT_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

/**
 * Normalizes a {@link FontFamily} value to a CSS font-family string.
 *
 * Strings pass through unchanged. Arrays have each entry quoted only when
 * required by CSS (names containing spaces or non-identifier characters),
 * then joined with `, `.
 */
export function normalizeFontFamily(family: FontFamily): string {
  if (typeof family === 'string') return family;
  return family.map(escapeFontName).join(', ');
}

function escapeFontName(name: string): string {
  if (SAFE_FONT_NAME.test(name)) return name;
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Composes a CSS font specification from font family and size.
 *
 * @param fontFamily - CSS font family (string or array).
 * @param fontSize - Font size in pixels.
 * @returns CSS font specification string (e.g. `'16px "Noto Serif JP", serif'`).
 */
export function toFontSpec(fontFamily: FontFamily, fontSize: number): string {
  return `${fontSize}px ${normalizeFontFamily(fontFamily)}`;
}
