import type { RubyInputAnnotation } from '../browser/types.js';

/** A text segment within a rendered line. */
export type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; rubyText: string };

/** A single rendered line containing text and ruby segments. */
export interface RenderLine {
  /** Segments that make up this line. */
  segments: RenderSegment[];
}

/** A rendered paragraph containing multiple lines. */
export interface RenderParagraph {
  /** Lines in this paragraph. */
  lines: RenderLine[];
  /** Whether this paragraph is a heading. */
  isHeading: boolean;
}

/** A full rendered page containing paragraphs. */
export interface RenderPage {
  /** Paragraphs on this page. */
  paragraphs: RenderParagraph[];
}

/** Input entry for render functions, combining layout results with annotations. */
export interface RenderEntry {
  /** Character array (grapheme clusters) of the paragraph text. */
  chars: string[];
  /** Break points from the line breaking algorithm. */
  breakPoints: Uint32Array;
  /** Ruby annotations for this paragraph. */
  rubyAnnotations: RubyInputAnnotation[];
  /** Whether this paragraph is a heading. */
  isHeading: boolean;
}
