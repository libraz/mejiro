import type { HeadingLevel, InlineAnnotation, ParagraphKind } from '../types.js';

/**
 * A segment of a rendered line: plain text or one inline annotation.
 *
 * `text` is the span's content flattened to a string; `children` covers the same
 * range with the annotations nested inside it. Draw only one of the two, never
 * both, or the characters appear twice. {@link segmentToInlineNode} resolves
 * that choice (and the markup policy for links and footnotes) for you. For a
 * `ruby` segment `text` is the base text and `rubyText` its reading.
 */
export type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; text: string; rubyText: string; children?: readonly RenderSegment[] }
  | {
      type: 'emphasis';
      text: string;
      style: 'sesame' | 'dot' | 'circle';
      children?: readonly RenderSegment[];
    }
  | { type: 'tcy'; text: string; children?: readonly RenderSegment[] }
  | { type: 'em'; text: string; children?: readonly RenderSegment[] }
  | { type: 'strong'; text: string; children?: readonly RenderSegment[] }
  | {
      type: 'link';
      text: string;
      href: string;
      title?: string;
      children?: readonly RenderSegment[];
    }
  | { type: 'footnote-ref'; text: string; noteId: string; children?: readonly RenderSegment[] };

/** A single rendered line containing text and ruby segments. */
export interface RenderLine {
  /** Segments that make up this line. */
  readonly segments: readonly RenderSegment[];
}

/** A rendered paragraph containing multiple lines. */
export interface RenderParagraph {
  /** Lines in this paragraph. */
  readonly lines: readonly RenderLine[];
  /** Heading level (1–6), or undefined for body text. */
  readonly headingLevel?: HeadingLevel;
  /**
   * Structural classification carried over from the source paragraph, mapped to
   * the `mejiro-paragraph--*` class the bundled stylesheets expect.
   */
  readonly kind?: ParagraphKind;
  /**
   * Font scale a layout measured this heading at. Page components set
   * `--mejiro-paragraph-scale` from it, so the drawn size is the measured one.
   * Absent on body paragraphs and on pages no layout built, where the
   * stylesheet's per-level scale applies.
   */
  readonly scale?: number;
}

/** A full rendered page containing paragraphs. */
export interface RenderPage {
  /** Paragraphs on this page. */
  readonly paragraphs: readonly RenderParagraph[];
}

/** Per-line layout metric for exclusion-mode column positioning. */
export interface LineMetric {
  /** Horizontal pitch this line occupies (heading lines are wider than body). */
  pitch: number;
  /** Gap before this line in pixels (paragraph or heading gap; 0 for mid-paragraph lines). */
  gapBefore: number;
  /** Heading level if this line belongs to a heading paragraph. */
  headingLevel?: HeadingLevel;
}

/** Result of {@link buildLineMetrics}. */
export interface LineMetricsResult {
  /** One LineMetric per flattened line across all paragraphs. */
  metrics: readonly LineMetric[];
  /** Cumulative x-offset at each line index, accounting for heading pitch excess and paragraph gaps. */
  offsets: Float32Array;
  /** Base body line pitch (fontSize × lineSpacing). */
  linePitch: number;
}

/** Input entry for render functions, combining layout results with annotations. */
export interface RenderEntry {
  /** Character array of the paragraph text, indexed by Unicode code point. */
  chars: readonly string[];
  /** Break points from the line breaking algorithm. */
  breakPoints: Uint32Array;
  /** Inline annotations for this paragraph (ruby, emphasis, tcy, etc.). */
  inlineAnnotations: readonly InlineAnnotation[];
  /**
   * Heading level (1–6), or undefined for body text. A paragraph is a heading
   * when it has a level or `kind` is `'heading'`.
   */
  headingLevel?: HeadingLevel;
  /** Structural classification of the source paragraph. @defaultValue 'body' */
  kind?: ParagraphKind;
}
