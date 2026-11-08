import { MejiroError } from '../errors.js';
import type { HeadingStyle } from '../render/measures.js';
import type { RubyType } from '../ruby.js';
import type { TcyAnnotation } from '../tcy.js';
import { normalizeText } from '../text.js';
import type {
  AnalyzerIdentity,
  BreakCostOptions,
  HeadingLevel,
  InlineAnnotation,
  KinsokuMode,
  ParagraphKind,
} from '../types.js';
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
 * **Owns its data:** a snapshot shares no object with the layout it was taken
 * from, so it can be transferred or serialized freely without the live layout
 * observing anything.
 *
 * **Authoritative config:** the snapshot bakes in the `fontSize` / `lineSpacing`
 * / `pageWidth` / `lineWidth` / etc. that were active when it was taken. The
 * first `updateOptions` after `layoutFromSnapshot` re-measures the layout when its
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
   * Snapshot format version. {@link ChapterLayout.snapshot} writes `3`.
   *
   * {@link MejiroBook.layoutFromSnapshot} also reads the version 2 format
   * written before it, translating its key names; any other version is
   * rejected the same way a malformed snapshot is, because replaying a shape
   * it does not know would put wrong break points on screen.
   */
  version: 3;
  /** Layout configuration at snapshot time. */
  config: ChapterLayoutSnapshotConfig;
  /** Page geometry at snapshot time. */
  size: Required<PageSize>;
  /** Per-paragraph data. */
  paragraphs: readonly ParagraphSnapshot[];
  /** Image exclusions keyed by spread index. Omitted for snapshots without images. */
  images?: readonly SpreadImagesSnapshot[];
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
  kinsoku: KinsokuMode;
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
  analyzer?: AnalyzerIdentity;
}

/** Per-paragraph snapshot entry. */
export interface ParagraphSnapshot {
  /** Original paragraph text (JS string). `text` and `chars` are rebuilt from this. */
  text: string;
  /** Per-codepoint advance widths (px). */
  advances: readonly number[];
  /**
   * Break points in the `BreakResult` convention: the inclusive codepoint index
   * of the last character before each break. A paragraph therefore has
   * `breakPoints.length + 1` lines, and line `i` spans
   * `[breakPoints[i - 1] + 1, breakPoints[i] + 1)` — the ranges `getLineRanges`
   * produces from the same array.
   */
  breakPoints: readonly number[];
  /**
   * Inline annotations (kept as the original type-tagged objects). Copies, not
   * references into the live layout.
   */
  inlineAnnotations: readonly InlineAnnotation[];
  /** Heading level (1–6), if any. */
  headingLevel?: HeadingLevel;
  /**
   * Structural classification of the paragraph. Omitted for `'body'`. A
   * paragraph is a heading when it has a `headingLevel` or is `'heading'`.
   */
  kind?: ParagraphKind;
  /** Pre-resolved ruby layout (after width measurement). */
  layoutRubyAnnotations?: readonly LayoutRubySnapshot[];
  /**
   * Pre-resolved tate-chu-yoko layout: the spans the line breaker collapses to
   * one box, with the box width already resolved against the paragraph's font
   * size. {@link TcyAnnotation} holds only numbers, so it needs no serializable
   * counterpart the way {@link LayoutRubySnapshot} does for its typed arrays.
   */
  layoutTcyAnnotations?: readonly TcyAnnotation[];
  /**
   * Cluster IDs the typography hints contributed, one per codepoint. Kept
   * because they are an input to the break points stored above: a restore that
   * dropped them would re-break this paragraph differently on the first resize.
   */
  hintClusterIds?: readonly number[];
  /**
   * Per-position break penalties the typography hints contributed, one per
   * codepoint. Present only for a layout broken at the `'full'` stage.
   */
  hintBreakPenalties?: readonly number[];
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
  rubyText: readonly number[];
  /** Per-codepoint advances for the ruby text. */
  rubyAdvances: readonly number[];
  /** Ruby distribution rule per JLReq. @defaultValue 'mono' */
  rubyType?: RubyType;
  /**
   * For jukugo ruby: base-text-relative indices where line breaks are
   * permitted. E.g. 東京都 (indices 0,1,2) with `[1, 2]` allows breaks after
   * 東 and 京.
   */
  jukugoSplitPoints?: readonly number[];
}

/** Serializable image exclusions for one spread. */
export interface SpreadImagesSnapshot {
  /** Zero-based index of the spread the images belong to. */
  spreadIndex: number;
  /** Image rectangles excluded on that spread, in right-page coordinates. */
  images: readonly BookImage[];
}

/** Throws the boundary error for a snapshot that fails validation. */
function malformed(detail: string): never {
  throw new MejiroError('snapshot-invalid', `Malformed ChapterLayoutSnapshot: ${detail}`);
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

const PARAGRAPH_KINDS: readonly unknown[] = [
  'body',
  'heading',
  'blockquote',
  'sceneBreak',
  'pre',
  'figure',
];

/** Checks an optional field holds a finite number accepted by `valid`. */
function checkOptionalNumber(value: unknown, valid: (n: number) => boolean, where: string): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !valid(value)) malformed(`${where} is not a valid number`);
}

function checkHeadingStyles(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) malformed('config.headingStyles is not an object');
  for (const [level, style] of Object.entries(value)) {
    const where = `config.headingStyles[${level}]`;
    if (!isRecord(style)) malformed(`${where} is not an object`);
    checkOptionalNumber(style.scale, isFinitePositive, `${where}.scale`);
    checkOptionalNumber(style.gapAfterEm, isFiniteNonNegative, `${where}.gapAfterEm`);
  }
}

function checkBreakCost(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) malformed('config.breakCost is not an object');
  for (const key of ['penaltyWeight', 'shortfallWeight', 'maxBacktrackChars', 'emSize'] as const) {
    checkOptionalNumber(value[key], isFiniteNonNegative, `config.breakCost.${key}`);
  }
}

function checkAnalyzer(value: unknown): void {
  if (value === undefined) return;
  if (!(isRecord(value) && typeof value.name === 'string' && typeof value.version === 'string')) {
    malformed('config.analyzer is not a {name, version} pair');
  }
}

function checkParagraph(value: unknown, where: string): void {
  if (!isRecord(value)) malformed(`${where} is not an object`);
  if (typeof value.text !== 'string') malformed(`${where}.text is not a string`);
  // Restore rebuilds codepoints through NFC next to the raw characters, so text
  // that is not already NFC would leave the two out of step.
  if (normalizeText(value.text) !== value.text) malformed(`${where}.text is not NFC-normalized`);
  if (
    value.headingLevel !== undefined &&
    !(
      Number.isInteger(value.headingLevel) &&
      (value.headingLevel as number) >= 1 &&
      (value.headingLevel as number) <= 6
    )
  ) {
    malformed(`${where}.headingLevel is not an integer from 1 to 6`);
  }
  if (value.kind !== undefined && !PARAGRAPH_KINDS.includes(value.kind)) {
    malformed(`${where}.kind is not a paragraph kind`);
  }
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

/** Version 2 inline annotation discriminants that version 3 spells differently. */
const V2_ANNOTATION_TYPES: Readonly<Record<string, string>> = { footnote: 'footnote-ref' };

/** Renames `from` to `to` on a copy of `value`, dropping `from` when it is absent. */
function renamed(
  value: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  if (!(from in value)) return value;
  const { [from]: moved, ...rest } = value;
  return moved === undefined ? rest : { ...rest, [to]: moved };
}

function mapRecords(
  value: unknown,
  map: (record: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  return Array.isArray(value) ? value.map((v) => (isRecord(v) ? map(v) : v)) : value;
}

function v2InlineAnnotation(annotation: Record<string, unknown>): Record<string, unknown> {
  const { kind, ...rest } = annotation;
  const type = typeof kind === 'string' ? (V2_ANNOTATION_TYPES[kind] ?? kind) : kind;
  // A version 2 ruby carried its distribution rule under `type`.
  return { type, ...(type === 'ruby' ? renamed(rest, 'type', 'rubyType') : rest) };
}

/** Reads a version 2 ruby entry, whose `type` key is the `rubyType` of version 3. */
function v2LayoutRuby(ruby: Record<string, unknown>): Record<string, unknown> {
  return renamed(ruby, 'type', 'rubyType');
}

function v2Paragraph(paragraph: Record<string, unknown>): Record<string, unknown> {
  const { isHeading, ...rest } = paragraph;
  const out: Record<string, unknown> = {
    ...rest,
    inlineAnnotations: mapRecords(rest.inlineAnnotations, (a) =>
      'kind' in a ? v2InlineAnnotation(a) : a,
    ),
  };
  if (rest.layoutRubyAnnotations !== undefined) {
    out.layoutRubyAnnotations = mapRecords(rest.layoutRubyAnnotations, v2LayoutRuby);
  }
  // A generic heading marker without a kind is the heading kind.
  if (isHeading === true && rest.kind === undefined) out.kind = 'heading';
  return out;
}

/** Translates the key names of a version 2 snapshot to version 3, leaving validation to the caller. */
function fromV2(value: Record<string, unknown>): Record<string, unknown> {
  const { config, size, paragraphs, images } = value;
  return {
    ...value,
    version: 3,
    config: isRecord(config) ? renamed(config, 'mode', 'kinsoku') : config,
    size: isRecord(size)
      ? renamed(renamed(size, 'pagePaddingX', 'paddingX'), 'pagePaddingY', 'paddingY')
      : size,
    paragraphs: mapRecords(paragraphs, v2Paragraph),
    ...(images === undefined
      ? {}
      : {
          images: mapRecords(images, (spread) => ({
            ...spread,
            images: mapRecords(spread.images, (image) =>
              renamed(renamed(image, 'w', 'width'), 'h', 'height'),
            ),
          })),
        }),
  };
}

/**
 * @internal The boundary check {@link MejiroBook.layoutFromSnapshot} runs
 * before adopting a snapshot, which may arrive as untrusted JSON. A version 2
 * snapshot is translated to the version 3 shape first. Every array the layout
 * indexes is checked against the paragraph it belongs to, so a truncated or
 * tampered snapshot fails here instead of producing NaN advances or
 * out-of-range breaks later.
 *
 * @returns The snapshot in the version 3 shape.
 * @throws MejiroError `snapshot-invalid` naming the first malformed field, or
 *   the unsupported version.
 */
export function readChapterLayoutSnapshot(value: unknown): ChapterLayoutSnapshot {
  if (!isRecord(value)) malformed('not an object');
  if (value.version === 2) return readChapterLayoutSnapshot(fromV2(value));
  if (value.version !== 3) {
    throw new MejiroError(
      'snapshot-invalid',
      `Unsupported ChapterLayoutSnapshot version: ${String(value.version)}`,
    );
  }
  const { config, size, paragraphs, images } = value;
  if (!isRecord(config)) malformed('config is not an object');
  for (const key of ['fontSize', 'lineSpacing', 'headingScale'] as const) {
    if (!isFinitePositive(config[key])) malformed(`config.${key} is not a positive number`);
  }
  if (config.kinsoku !== 'strict' && config.kinsoku !== 'loose') {
    malformed('config.kinsoku is invalid');
  }
  if (typeof config.enableHanging !== 'boolean') malformed('config.enableHanging is invalid');
  checkHeadingStyles(config.headingStyles);
  checkBreakCost(config.breakCost);
  checkAnalyzer(config.analyzer);
  if (!isRecord(size)) malformed('size is not an object');
  for (const key of ['pageWidth', 'lineWidth'] as const) {
    if (!isFinitePositive(size[key])) malformed(`size.${key} is not a positive number`);
  }
  for (const key of ['paddingX', 'paddingY'] as const) {
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
          (['x', 'y', 'width', 'height'] as const).every((k) => Number.isFinite(image[k])) &&
          (image.margin === undefined || isFiniteNonNegative(image.margin));
        if (!ok) malformed(`images[${i}].images[${j}] is not a valid image rectangle`);
      });
    });
  }
  return value as unknown as ChapterLayoutSnapshot;
}
