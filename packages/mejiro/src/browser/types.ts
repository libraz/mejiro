/**
 * Configuration options for the MejiroBrowser instance.
 */
export interface MejiroBrowserOptions {
  /** Fixed font family. When set, all layouts use this font family. */
  fixedFontFamily?: FontFamily;
  /** Fixed font size in pixels. When set, all layouts use this font size. */
  fixedFontSize?: number;
  /**
   * When true, `layout()` throws if the requested family measures exactly like
   * the host's default font, which is how a silent fallback presents itself.
   * When false (the default), layout proceeds with whatever the host resolved.
   */
  strictFontCheck?: boolean;
}

/** Ruby variant of {@link InlineAnnotation}. */
export interface InlineRubyAnnotation {
  /**
   * Discriminant of the {@link InlineAnnotation} union. `'ruby'` and `'tcy'` are
   * the two variants the line breaker consumes; the rest are render-only.
   */
  kind: 'ruby';
  /** Start index in the base text string (character index, not byte). */
  startIndex: number;
  /** End index in the base text string (exclusive). */
  endIndex: number;
  /** Ruby text string. */
  rubyText: string;
  /** @defaultValue 'mono' */
  type?: 'mono' | 'group' | 'jukugo';
  /** For jukugo ruby: base-text-relative indices where line breaks are permitted. */
  jukugoSplitPoints?: number[];
}

/** Emphasis-dot (傍点) annotation. */
export interface InlineEmphasisAnnotation {
  /** Discriminant of the {@link InlineAnnotation} union. */
  kind: 'emphasis';
  /** Start index in the base text string (character index, not byte). */
  startIndex: number;
  /** End index in the base text string (exclusive). */
  endIndex: number;
  /** Dot glyph style. @defaultValue 'sesame' */
  style?: 'sesame' | 'dot' | 'circle';
}

/**
 * Tate-chu-yoko (縦中横) annotation — display the span horizontally inside a
 * vertical column.
 *
 * Reaches the line breaker: the span is given a fresh cluster ID of its own, so
 * it cannot be split across a column boundary, and its effective advances sum to
 * exactly one em — the width `text-combine-upright: all` draws — distributed
 * over the span's characters in proportion to their measured advances.
 *
 * Preprocessing runs before ruby, so a ruby span covering a combined box
 * distributes its excess over the collapsed width rather than over the measured
 * widths the box has already replaced. Unlike ruby, a malformed span (empty,
 * reversed, out of range, non-integral, non-finite advance, or overlapping an
 * already-applied span) is skipped instead of throwing, because these spans come
 * from arbitrary EPUB markup and one broken span must not fail a whole chapter.
 */
export interface InlineTcyAnnotation {
  /** Discriminant of the {@link InlineAnnotation} union. */
  kind: 'tcy';
  /** Start index in the base text string (character index, not byte). */
  startIndex: number;
  /** End index in the base text string (exclusive). */
  endIndex: number;
}

/** Italic emphasis (`<em>`). */
export interface InlineEmAnnotation {
  /** Discriminant of the {@link InlineAnnotation} union. */
  kind: 'em';
  /** Start index in the base text string (character index, not byte). */
  startIndex: number;
  /** End index in the base text string (exclusive). */
  endIndex: number;
}

/** Strong emphasis (`<strong>`). */
export interface InlineStrongAnnotation {
  /** Discriminant of the {@link InlineAnnotation} union. */
  kind: 'strong';
  /** Start index in the base text string (character index, not byte). */
  startIndex: number;
  /** End index in the base text string (exclusive). */
  endIndex: number;
}

/** Hyperlink annotation. */
export interface InlineLinkAnnotation {
  /** Discriminant of the {@link InlineAnnotation} union. */
  kind: 'link';
  /** Start index in the base text string (character index, not byte). */
  startIndex: number;
  /** End index in the base text string (exclusive). */
  endIndex: number;
  /**
   * Destination URL, stored as authored. Renderers sanitize it on the way out:
   * a scheme other than `http`, `https` or `mailto` degrades to plain text
   * instead of producing a link.
   */
  href: string;
  /** Advisory text for the link's `title` attribute. */
  title?: string;
}

/** Footnote reference annotation. */
export interface InlineFootnoteAnnotation {
  /** Discriminant of the {@link InlineAnnotation} union. */
  kind: 'footnote';
  /** Start index in the base text string (character index, not byte). */
  startIndex: number;
  /** End index in the base text string (exclusive). */
  endIndex: number;
  /** Identifier of the corresponding footnote entry. */
  noteId: string;
}

/**
 * Inline annotation that applies to a contiguous span of base text.
 *
 * Replaces the v0.4-only `RubyInputAnnotation` with a discriminated union so
 * the same model can carry ruby, emphasis dots, tate-chu-yoko, simple emphasis,
 * hyperlinks, and footnote references through the layout / render pipeline.
 *
 * The `ruby` and `tcy` variants reach the line breaker — both are resolved to
 * effective advances and cluster IDs before breaking (tate-chu-yoko first, so
 * ruby distributes over the already-collapsed width). Every other variant is
 * render-only: it contributes no cluster ID and no advance correction, so the
 * breaker may split such a span across a column boundary.
 */
export type InlineAnnotation =
  | InlineRubyAnnotation
  | InlineEmphasisAnnotation
  | InlineTcyAnnotation
  | InlineEmAnnotation
  | InlineStrongAnnotation
  | InlineLinkAnnotation
  | InlineFootnoteAnnotation;

/**
 * @deprecated Renamed to {@link InlineRubyAnnotation}; use {@link InlineAnnotation}
 * for new code. Removal of this alias is deferred to a future major release; no
 * removal version is scheduled.
 */
export type RubyInputAnnotation = InlineRubyAnnotation;

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
}

/**
 * Options for laying out an entire chapter (multiple paragraphs).
 */
export interface ChapterLayoutOptions {
  /** Paragraphs to lay out. */
  paragraphs: readonly ParagraphInput[];
  /** CSS font family for body text. Falls back to MejiroBrowser's fixedFontFamily. */
  fontFamily?: FontFamily;
  /** Font size in pixels for body text. Falls back to MejiroBrowser's fixedFontSize. */
  fontSize?: number;
  /** Available line width in pixels (use `verticalLineWidth()` for vertical text). */
  lineWidth: number;
  /** Kinsoku mode. @defaultValue 'strict' */
  mode?: 'strict' | 'loose';
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
}

/**
 * Layout result for a single paragraph within a chapter.
 */
export interface ParagraphLayoutResult {
  /** Break result from the line breaking algorithm. */
  breakResult: import('../types.js').BreakResult;
  /** Character array of the paragraph text, indexed by NFC Unicode codepoint. */
  chars: string[];
}

/**
 * Result of laying out an entire chapter.
 */
export interface ChapterLayoutResult {
  /** Per-paragraph layout results. */
  paragraphs: ParagraphLayoutResult[];
}

/**
 * Options for a single layout operation.
 */
export interface LayoutOptions {
  /** Text string to lay out. */
  text: string;
  /** CSS font family. Overrides fixedFontFamily. */
  fontFamily?: FontFamily;
  /** Font size in pixels. Overrides fixedFontSize. */
  fontSize?: number;
  /** Available line width in pixels. */
  lineWidth: number;
  /** Kinsoku mode. @defaultValue 'strict' */
  mode?: 'strict' | 'loose';
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations?: readonly InlineAnnotation[];
  /**
   * Token boundary indices for morphological-aware line breaking.
   * @see {@link LayoutInput.tokenBoundaries}
   */
  tokenBoundaries?: Uint32Array | readonly number[];
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
