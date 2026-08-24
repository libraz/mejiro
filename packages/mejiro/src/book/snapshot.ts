import type { InlineAnnotation } from '../browser/types.js';
import type { HeadingStyle } from '../render/measures.js';
import type { TcyAnnotation } from '../tcy.js';
import type { BreakCostOptions } from '../types.js';
import type { BookImage, PageSize, ParagraphKind } from './types.js';

/**
 * Serializable snapshot of a {@link ChapterLayout}.
 *
 * Captures measurement output (advances, ruby layout) and break decisions so
 * a layout can be reconstructed without invoking the browser-side measurer.
 * Designed for SSR / build-time pre-computation: the server runs
 * `layout.snapshot()`, ships the JSON to the client, and the client calls
 * `MejiroBook.layoutFromSnapshot(snapshot)` to skip the measurement round-trip.
 *
 * **Owns its data:** a snapshot shares no object with the layout it was taken
 * from, so it can be mutated, transferred or serialized freely without the live
 * layout observing the change.
 *
 * **Authoritative config:** the snapshot bakes in the `fontSize` / `lineSpacing`
 * / `pageWidth` / `lineWidth` / etc. that were active when it was taken. Calling
 * `layoutFromSnapshot` then `setOptions` re-measures from scratch — see the
 * {@link MejiroBook.layoutFromSnapshot} docs.
 *
 * **Typography hints travel with the breaks:** when the layout was produced with
 * a morphological analysis, each paragraph carries the hints it was broken under
 * and {@link ChapterLayoutSnapshotConfig.analyzer} records which analyzer
 * produced them, so a restored layout re-breaks the way the original would have.
 */
export interface ChapterLayoutSnapshot {
  /**
   * Snapshot format version. Bump when the shape changes.
   *
   * There is no migration path: {@link MejiroBook.layoutFromSnapshot} rejects
   * any other value, the same way it rejects a malformed snapshot. A snapshot
   * is a cache of work that can always be redone by laying the chapter out
   * again, so refusing a stale one costs a re-layout, while replaying one whose
   * shape has drifted would put wrong break points on screen.
   */
  version: 2;
  /** Layout configuration at snapshot time. */
  config: ChapterLayoutSnapshotConfig;
  /** Page geometry at snapshot time. */
  size: Required<PageSize>;
  /** Per-paragraph data. */
  paragraphs: ParagraphSnapshot[];
  /** Image exclusions keyed by spread index. Omitted for snapshots without images. */
  images?: SpreadImagesSnapshot[];
}

/**
 * Serializable subset of `LayoutConfig`.
 *
 * Every field holds the value that was actually in effect when the snapshot was
 * taken, with {@link BookOptions} defaults already applied — hence no optional
 * fields apart from `headingStyles`, which has no default. The font family is
 * deliberately absent: advances are already baked into the snapshot, so
 * restoring it needs no font.
 */
export interface ChapterLayoutSnapshotConfig {
  /** Body font size in pixels the advances were measured at. */
  fontSize: number;
  /** Line spacing multiplier used for column pitch. */
  lineSpacing: number;
  /** Scale applied to heading font sizes with no per-level `headingStyles` entry. */
  headingScale: number;
  /** Kinsoku mode the break points were produced under. */
  mode: 'strict' | 'loose';
  /** Whether hanging punctuation was enabled when breaking. */
  enableHanging: boolean;
  /** Per-level heading overrides (levels 1–6). Omitted when none were set. */
  headingStyles?: Record<number, HeadingStyle>;
  /**
   * Weights the penalty search ran under. Omitted when none were configured,
   * and inert unless a paragraph carries {@link ParagraphSnapshot.hintBreakPenalties}.
   */
  breakCost?: BreakCostOptions;
  /**
   * Identity of the analyzer the paragraph hints were derived from. Omitted
   * when no analyzer was consulted — including a layout whose hints were all
   * supplied per paragraph by the caller.
   *
   * On restore, {@link MejiroBook.layoutFromSnapshot} compares this against the
   * identity of the analyzer configured on the restoring book and **drops the
   * hints when the two differ**, rather than re-analysing. Restoring is meant
   * to be the cheap path — it is synchronous and the restoring book may have no
   * analyzer at all — and hints from a different analyzer would describe units
   * this one does not recognise. Dropping them costs a future re-break the
   * benefit of the analysis, which is a quality loss, not a wrong layout; the
   * break points the snapshot restores with are unaffected either way. The
   * comparison treats absence as an identity of its own, so a caller-supplied
   * set of hints survives a restore into a book that likewise has no analyzer.
   */
  analyzer?: { name: string; version: string };
}

/** Per-paragraph snapshot entry. */
export interface ParagraphSnapshot {
  /** Original paragraph text (JS string). `text` and `chars` are rebuilt from this. */
  text: string;
  /** Per-codepoint advance widths (px). */
  advances: number[];
  /**
   * Break points in the `BreakResult` convention: the inclusive codepoint index
   * of the last character before each break. A paragraph therefore has
   * `breakPoints.length + 1` lines, and line `i` spans
   * `[breakPoints[i - 1] + 1, breakPoints[i] + 1)` — the ranges `getLineRanges`
   * produces from the same array.
   */
  breakPoints: number[];
  /**
   * Inline annotations (kept as the original kind-tagged objects). Copies, not
   * references into the live layout.
   */
  inlineAnnotations: readonly InlineAnnotation[];
  /** Legacy/generic heading marker when no heading level is available. */
  isHeading?: boolean;
  /** Heading level (1–6), if any. */
  headingLevel?: number;
  /** Structural classification of the paragraph. Omitted for `'body'`. */
  kind?: ParagraphKind;
  /** Pre-resolved ruby layout (after width measurement). */
  layoutRubyAnnotations?: LayoutRubySnapshot[];
  /**
   * Pre-resolved tate-chu-yoko layout: the spans the line breaker collapses to
   * one box, with the box width already resolved against the paragraph's font
   * size. {@link TcyAnnotation} holds only numbers, so it needs no serializable
   * counterpart the way {@link LayoutRubySnapshot} does for its typed arrays.
   */
  layoutTcyAnnotations?: TcyAnnotation[];
  /**
   * Cluster IDs the typography hints contributed, one per codepoint. Kept
   * because they are an input to the break points stored above: a restore that
   * dropped them would re-break this paragraph differently on the first resize.
   */
  hintClusterIds?: number[];
  /**
   * Per-position break penalties the typography hints contributed, one per
   * codepoint. Present only for a layout broken at the `'full'` stage.
   */
  hintBreakPenalties?: number[];
}

/**
 * Serializable form of {@link RubyAnnotation}, with the typed arrays widened to
 * plain number arrays so the snapshot survives `JSON.stringify`.
 */
export interface LayoutRubySnapshot {
  /** Start index in the base text's codepoint array (inclusive). */
  startIndex: number;
  /** End index in the base text's codepoint array (exclusive). */
  endIndex: number;
  /** Ruby text codepoints. */
  rubyText: number[];
  /** Per-codepoint advances for the ruby text. */
  rubyAdvances: number[];
  /** Ruby distribution rule per JLReq. @defaultValue 'mono' */
  type?: 'mono' | 'group' | 'jukugo';
  /**
   * For jukugo ruby: base-text-relative indices where line breaks are
   * permitted. E.g. 東京都 (indices 0,1,2) with `[1, 2]` allows breaks after
   * 東 and 京.
   */
  jukugoSplitPoints?: number[];
}

/** Serializable image exclusions for one spread. */
export interface SpreadImagesSnapshot {
  /** Zero-based index of the spread the images belong to. */
  spreadIndex: number;
  /** Image rectangles excluded on that spread, in right-page coordinates. */
  images: BookImage[];
}
