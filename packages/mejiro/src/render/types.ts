import type { InlineAnnotation } from '../browser/types.js';

/** A text segment within a rendered line. */
export type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; rubyText: string; children?: readonly RenderSegment[] }
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
  /** Whether this paragraph is a heading (true if headingLevel is set). */
  readonly isHeading: boolean;
  /** Heading level (1–6), or undefined for body text. */
  readonly headingLevel?: number;
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
  headingLevel?: number;
}

/** Result of {@link buildLineMetrics}. */
export interface LineMetricsResult {
  /** One LineMetric per flattened line across all paragraphs. */
  metrics: LineMetric[];
  /** Cumulative x-offset at each line index, accounting for heading pitch excess and paragraph gaps. */
  offsets: Float32Array;
  /** Base body line pitch (fontSize × lineSpacing). */
  linePitch: number;
}

/** Input entry for render functions, combining layout results with annotations. */
export interface RenderEntry {
  /** Character array of the paragraph text, indexed by Unicode code point. */
  chars: string[];
  /** Break points from the line breaking algorithm. */
  breakPoints: Uint32Array;
  /** Inline annotations for this paragraph (ruby, emphasis, tcy, etc.). */
  inlineAnnotations: readonly InlineAnnotation[];
  /**
   * Whether this paragraph is a heading.
   * @deprecated Use `headingLevel` instead. When `headingLevel` is set, this field is ignored.
   */
  isHeading?: boolean;
  /** Heading level (1–6), or undefined for body text. */
  headingLevel?: number;
}
