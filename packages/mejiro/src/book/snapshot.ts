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
 * / `pageWidth` / `lineWidth` / etc. that were active when it was taken. The
 * first `setOptions` after `layoutFromSnapshot` re-measures the layout when its
 * font size or heading scales differ from the book's — see the
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
   * any other value, the same way it rejects a malformed snapshot — one whose
   * arrays do not fit the paragraph they belong to. A snapshot
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

/** Throws the boundary error for a snapshot that fails validation. */
function malformed(detail: string): never {
  throw new Error(`Malformed ChapterLayoutSnapshot: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFinitePositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isIndex(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

/** Checks `value` is an array of `length` numbers each accepted by `valid`. */
function checkNumbers(
  value: unknown,
  length: number | null,
  valid: (n: number) => boolean,
  where: string,
): void {
  if (!Array.isArray(value)) malformed(`${where} is not an array`);
  if (length !== null && value.length !== length) {
    malformed(`${where} has ${value.length} entries, expected ${length}`);
  }
  for (const n of value) {
    if (typeof n !== 'number' || !valid(n)) malformed(`${where} holds an invalid value`);
  }
}

/** Checks a `[startIndex, endIndex)` span lies within a paragraph of `count` codepoints. */
function checkSpan(value: unknown, count: number, where: string): Record<string, unknown> {
  if (!isRecord(value)) malformed(`${where} is not an object`);
  const { startIndex, endIndex } = value;
  if (!(isIndex(startIndex, count) && isIndex(endIndex, count)) || startIndex > endIndex) {
    malformed(`${where} span lies outside the paragraph`);
  }
  return value;
}

function checkParagraph(value: unknown, where: string): void {
  if (!isRecord(value)) malformed(`${where} is not an object`);
  if (typeof value.text !== 'string') malformed(`${where}.text is not a string`);
  const count = [...value.text].length;
  checkNumbers(value.advances, count, Number.isFinite, `${where}.advances`);
  checkNumbers(value.breakPoints, null, (n) => isIndex(n, count - 1), `${where}.breakPoints`);
  const breaks = value.breakPoints as number[];
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i] <= breaks[i - 1]) malformed(`${where}.breakPoints are not strictly increasing`);
  }
  if (!Array.isArray(value.inlineAnnotations)) {
    malformed(`${where}.inlineAnnotations is not an array`);
  }
  value.inlineAnnotations.forEach((a, i) => {
    checkSpan(a, count, `${where}.inlineAnnotations[${i}]`);
  });
  if (value.layoutRubyAnnotations !== undefined) {
    if (!Array.isArray(value.layoutRubyAnnotations)) {
      malformed(`${where}.layoutRubyAnnotations is not an array`);
    }
    value.layoutRubyAnnotations.forEach((r, i) => {
      const ruby = checkSpan(r, count, `${where}.layoutRubyAnnotations[${i}]`);
      const rubyWhere = `${where}.layoutRubyAnnotations[${i}]`;
      checkNumbers(ruby.rubyText, null, (n) => isIndex(n, 0x10ffff), `${rubyWhere}.rubyText`);
      const rubyLength = (ruby.rubyText as number[]).length;
      checkNumbers(ruby.rubyAdvances, rubyLength, Number.isFinite, `${rubyWhere}.rubyAdvances`);
      if (ruby.jukugoSplitPoints !== undefined) {
        checkNumbers(
          ruby.jukugoSplitPoints,
          null,
          Number.isSafeInteger,
          `${rubyWhere}.jukugoSplitPoints`,
        );
      }
    });
  }
  if (value.layoutTcyAnnotations !== undefined) {
    if (!Array.isArray(value.layoutTcyAnnotations)) {
      malformed(`${where}.layoutTcyAnnotations is not an array`);
    }
    value.layoutTcyAnnotations.forEach((t, i) => {
      const tcy = checkSpan(t, count, `${where}.layoutTcyAnnotations[${i}]`);
      if (!isFiniteNonNegative(tcy.advance)) {
        malformed(`${where}.layoutTcyAnnotations[${i}].advance is invalid`);
      }
    });
  }
  if (value.hintClusterIds !== undefined) {
    checkNumbers(
      value.hintClusterIds,
      count,
      (n) => isIndex(n, 0xffffffff),
      `${where}.hintClusterIds`,
    );
  }
  if (value.hintBreakPenalties !== undefined) {
    checkNumbers(
      value.hintBreakPenalties,
      count,
      (n) => isIndex(n, 0xff),
      `${where}.hintBreakPenalties`,
    );
  }
}

/**
 * @internal The boundary check {@link MejiroBook.layoutFromSnapshot} runs
 * before adopting a snapshot, which may arrive as untrusted JSON. Every array
 * the layout indexes is checked against the paragraph it belongs to, so a
 * truncated or tampered snapshot fails here instead of producing NaN advances
 * or out-of-range breaks later.
 *
 * @throws Error naming the first malformed field, or the unsupported version.
 */
export function assertChapterLayoutSnapshot(
  value: unknown,
): asserts value is ChapterLayoutSnapshot {
  if (!isRecord(value)) malformed('not an object');
  if (value.version !== 2) {
    throw new Error(`Unsupported ChapterLayoutSnapshot version: ${String(value.version)}`);
  }
  const { config, size, paragraphs, images } = value;
  if (!isRecord(config)) malformed('config is not an object');
  for (const key of ['fontSize', 'lineSpacing', 'headingScale'] as const) {
    if (!isFinitePositive(config[key])) malformed(`config.${key} is not a positive number`);
  }
  if (config.mode !== 'strict' && config.mode !== 'loose') malformed('config.mode is invalid');
  if (typeof config.enableHanging !== 'boolean') malformed('config.enableHanging is invalid');
  if (config.headingStyles !== undefined && !isRecord(config.headingStyles)) {
    malformed('config.headingStyles is not an object');
  }
  if (!isRecord(size)) malformed('size is not an object');
  for (const key of ['pageWidth', 'lineWidth'] as const) {
    if (!isFinitePositive(size[key])) malformed(`size.${key} is not a positive number`);
  }
  for (const key of ['pagePaddingX', 'pagePaddingY'] as const) {
    if (!isFiniteNonNegative(size[key])) malformed(`size.${key} is not a non-negative number`);
  }
  if (!Array.isArray(paragraphs)) malformed('paragraphs is not an array');
  paragraphs.forEach((p, i) => {
    checkParagraph(p, `paragraphs[${i}]`);
  });
  if (images !== undefined) {
    if (!Array.isArray(images)) malformed('images is not an array');
    images.forEach((spread, i) => {
      if (!(isRecord(spread) && isIndex(spread.spreadIndex, Number.MAX_SAFE_INTEGER))) {
        malformed(`images[${i}].spreadIndex is invalid`);
      }
      if (!Array.isArray(spread.images)) malformed(`images[${i}].images is not an array`);
      spread.images.forEach((image, j) => {
        const ok =
          isRecord(image) &&
          (['x', 'y', 'w', 'h'] as const).every((k) => Number.isFinite(image[k])) &&
          (image.margin === undefined || isFiniteNonNegative(image.margin));
        if (!ok) malformed(`images[${i}].images[${j}] is not a valid image rectangle`);
      });
    });
  }
}
