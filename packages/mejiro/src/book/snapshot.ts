import type { InlineAnnotation } from '../browser/types.js';
import type { HeadingStyle } from '../render/measures.js';
import type { BookImage, PageSize } from './types.js';

/**
 * Serializable snapshot of a {@link ChapterLayout}.
 *
 * Captures measurement output (advances, ruby layout) and break decisions so
 * a layout can be reconstructed without invoking the browser-side measurer.
 * Designed for SSR / build-time pre-computation: the server runs
 * `layout.snapshot()`, ships the JSON to the client, and the client calls
 * `MejiroBook.layoutFromSnapshot(snapshot)` to skip the measurement round-trip.
 *
 * **Authoritative config:** the snapshot bakes in the `fontSize` / `lineSpacing`
 * / `pageWidth` / `lineWidth` / etc. that were active when it was taken. Calling
 * `layoutFromSnapshot` then `setOptions` re-measures from scratch — see the
 * {@link MejiroBook.layoutFromSnapshot} docs.
 */
export interface ChapterLayoutSnapshot {
  /** Snapshot format version. Bump when the shape changes. */
  version: 1;
  /** Layout configuration at snapshot time. */
  config: ChapterLayoutSnapshotConfig;
  /** Page geometry at snapshot time. */
  size: Required<PageSize>;
  /** Per-paragraph data. */
  paragraphs: ParagraphSnapshot[];
  /** Image exclusions keyed by spread index. Omitted for snapshots without images. */
  images?: SpreadImagesSnapshot[];
}

/** Serializable subset of `LayoutConfig`. */
export interface ChapterLayoutSnapshotConfig {
  fontSize: number;
  lineSpacing: number;
  headingScale: number;
  mode: 'strict' | 'loose';
  enableHanging: boolean;
  headingStyles?: Record<number, HeadingStyle>;
}

/** Per-paragraph snapshot entry. */
export interface ParagraphSnapshot {
  /** Original paragraph text (JS string). `text` and `chars` are rebuilt from this. */
  text: string;
  /** Per-codepoint advance widths (px). */
  advances: number[];
  /** Codepoint indices marking the start of lines 1..N. */
  breakPoints: number[];
  /** Inline annotations (kept as the original kind-tagged objects). */
  inlineAnnotations: readonly InlineAnnotation[];
  /** Legacy/generic heading marker when no heading level is available. */
  isHeading?: boolean;
  /** Heading level (1–6), if any. */
  headingLevel?: number;
  /** Pre-resolved ruby layout (after width measurement). */
  layoutRubyAnnotations?: LayoutRubySnapshot[];
}

/** Serializable form of {@link RubyAnnotation}. */
export interface LayoutRubySnapshot {
  startIndex: number;
  endIndex: number;
  /** Ruby text codepoints. */
  rubyText: number[];
  /** Per-codepoint advances for the ruby text. */
  rubyAdvances: number[];
  type?: 'mono' | 'group' | 'jukugo';
  jukugoSplitPoints?: number[];
}

/** Serializable image exclusions for one spread. */
export interface SpreadImagesSnapshot {
  spreadIndex: number;
  images: BookImage[];
}
