/**
 * Configuration options for the MejiroBrowser instance.
 */
export interface MejiroBrowserOptions {
  /** Fixed font family. When set, all layouts use this font family. */
  fixedFontFamily?: string;
  /** Fixed font size in pixels. When set, all layouts use this font size. */
  fixedFontSize?: number;
  /** When true, throws an error if font fallback is detected. */
  strictFontCheck?: boolean;
}

/** String-based ruby annotation for browser layer (codepoint conversion handled internally). */
export interface RubyInputAnnotation {
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

/**
 * A paragraph to lay out, with text and optional ruby annotations.
 */
export interface ParagraphInput {
  /** Text string to lay out. */
  text: string;
  /** Ruby annotations for furigana support. */
  rubyAnnotations?: RubyInputAnnotation[];
  /** Font family override for this paragraph (e.g. for headings with a different typeface). */
  fontFamily?: string;
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
  paragraphs: ParagraphInput[];
  /** CSS font family for body text. Falls back to MejiroBrowser's fixedFontFamily. */
  fontFamily?: string;
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
  /** Character array (grapheme clusters) of the paragraph text. */
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
  /** CSS font family (e.g. '"Noto Serif JP"'). Overrides fixedFontFamily. */
  fontFamily?: string;
  /** Font size in pixels. Overrides fixedFontSize. */
  fontSize?: number;
  /** Available line width in pixels. */
  lineWidth: number;
  /** Kinsoku mode. @defaultValue 'strict' */
  mode?: 'strict' | 'loose';
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /** Ruby annotations for furigana support. */
  rubyAnnotations?: RubyInputAnnotation[];
  /**
   * Token boundary indices for morphological-aware line breaking.
   * @see {@link LayoutInput.tokenBoundaries}
   */
  tokenBoundaries?: Uint32Array | readonly number[];
}

/**
 * Composes a CSS font specification from font family and size.
 *
 * @param fontFamily - CSS font family (e.g. '"Noto Serif JP"').
 * @param fontSize - Font size in pixels.
 * @returns CSS font specification string (e.g. '16px "Noto Serif JP"').
 */
export function toFontSpec(fontFamily: string, fontSize: number): string {
  return `${fontSize}px ${fontFamily}`;
}
