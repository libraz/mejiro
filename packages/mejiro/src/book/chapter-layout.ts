import type { FontFamily } from '../browser/types.js';
import { MejiroError } from '../errors.js';
import type { ColumnSlot, SpreadImageRect, SpreadPageImages } from '../exclusion.js';
import { splitSpreadImages } from '../exclusion.js';
import { computeBreaks } from '../layout.js';
import type { PageSlice } from '../paginate.js';
import { paginate } from '../paginate.js';
import type { HeadingFields, HeadingStyle, MeasureOptions } from '../render/measures.js';
import {
  buildColumnSlots,
  buildLineMetrics,
  buildParagraphMeasures,
  isHeadingParagraph,
  paragraphHeading,
  paragraphMetrics,
  resolveHeadingScale,
} from '../render/measures.js';
import { buildRenderPage } from '../render/page.js';
import type { LineMetric, RenderEntry, RenderLine, RenderParagraph } from '../render/types.js';
import { preprocessRuby, type RubyAnnotation } from '../ruby.js';
import { preprocessTcy, type TcyAnnotation } from '../tcy.js';
import { normalizeText } from '../text.js';
import type {
  AnalyzerIdentity,
  BreakCostOptions,
  HeadingLevel,
  InlineAnnotation,
  KinsokuMode,
} from '../types.js';
import type { AnchorLocation, AnchorRange, AnchorRect, InChapterAnchor } from './anchor.js';
import { ColumnFlow, type SpreadLayoutInfo } from './column-flow.js';
import type { FindTextOptions, SearchMatch } from './search.js';
import type {
  ChapterLayoutSnapshot,
  LayoutRubySnapshot,
  ParagraphSnapshot,
  SpreadImagesSnapshot,
} from './snapshot.js';
import type {
  AnchorAtOptions,
  BookImage,
  BookOptionsPatch,
  ChapterTypography,
  PageGeometry,
  PageLine,
  PageResult,
  PageSize,
  ParagraphKind,
  SpreadPoint,
  SpreadResult,
} from './types.js';

/** @internal Cached per-paragraph data for fast re-layout. */
export interface CachedParagraph {
  text: Uint32Array;
  advances: Float32Array;
  chars: readonly string[];
  inlineAnnotations: readonly InlineAnnotation[];
  layoutRubyAnnotations?: RubyAnnotation[];
  /**
   * Tate-chu-yoko spans with their box width already resolved against this
   * paragraph's font size. Kept alongside the advances so every re-break
   * (resize, re-measure, image exclusion) reserves the same one em per span
   * and refuses to split it, exactly as the initial layout did.
   */
  layoutTcyAnnotations?: TcyAnnotation[];
  headingLevel?: HeadingLevel;
  /**
   * Structural classification of the source paragraph, kept here so a re-break
   * (resize, re-measure, image exclusion) can put it back on the render entry.
   */
  kind?: ParagraphKind;
  /**
   * Indivisible units the typography hints identified, as base cluster IDs.
   *
   * Cached rather than recomputed because morphological analysis is the most
   * expensive step in the pipeline and its result cannot change while the
   * paragraph's text does not — a re-break (resize, re-measure, image exclusion
   * reflow) is on the interactive path and must never re-analyse.
   */
  hintClusterIds?: Uint32Array;
  /**
   * Per-position break penalties from the same analysis, cached for the same
   * reason as {@link CachedParagraph.hintClusterIds}. Absent unless the book
   * asked for the `'full'` stage, in which case break positions depend on it,
   * so a re-break that dropped it would move text on screen.
   */
  hintBreakPenalties?: Uint8Array;
}

/** @internal Layout configuration snapshot. */
export interface LayoutConfig {
  /** Family the cached advances were measured in. */
  fontFamily: FontFamily;
  fontSize: number;
  lineSpacing: number;
  headingStyles?: Record<number, HeadingStyle>;
  headingScale: number;
  kinsoku: KinsokuMode;
  enableHanging: boolean;
  /** Weights for the penalty search. Inert unless a paragraph carries penalties. */
  breakCost?: BreakCostOptions;
  /**
   * Identity of the analyzer the cached paragraphs' hints came from, carried so
   * a snapshot can record which analysis its break points depend on.
   */
  analyzer?: AnalyzerIdentity;
}

/** @internal Fields of a {@link LayoutConfig} that cached advances are measured against. */
type MeasurementConfig = Pick<
  LayoutConfig,
  'fontFamily' | 'fontSize' | 'headingScale' | 'headingStyles'
>;

/** @internal Fields that size a paragraph's font. */
type ParagraphSizeConfig = Pick<LayoutConfig, 'fontSize' | 'headingScale' | 'headingStyles'>;

/**
 * @internal The font size a paragraph is measured and drawn at: the body size,
 * or the heading scale applied and rounded to whole pixels.
 */
export function paragraphFontSize(p: HeadingFields, config: ParagraphSizeConfig): number {
  if (!isHeadingParagraph(p)) return config.fontSize;
  return Math.round(config.fontSize * resolveHeadingScale(p, config));
}

/** True when both configs measure in the same family and resolve every heading level to the same scale. */
function sameMeasurement(a: MeasurementConfig, b: MeasurementConfig): boolean {
  if (a.fontFamily !== b.fontFamily) return false;
  if (a.fontSize !== b.fontSize || a.headingScale !== b.headingScale) return false;
  if (a.headingStyles === b.headingStyles) return true;
  const levels = new Set([
    ...Object.keys(a.headingStyles ?? {}),
    ...Object.keys(b.headingStyles ?? {}),
  ]);
  for (const level of levels) {
    const n = Number(level);
    if (a.headingStyles?.[n]?.scale !== b.headingStyles?.[n]?.scale) return false;
  }
  return true;
}

// ── Internal cache types ──

/** Whether two break cost settings carry the same weights, absence included. */
function sameBreakCost(a: BreakCostOptions | undefined, b: BreakCostOptions | undefined): boolean {
  if (a === b) return true;
  return (
    a?.penaltyWeight === b?.penaltyWeight &&
    a?.shortfallWeight === b?.shortfallWeight &&
    a?.maxBacktrackChars === b?.maxBacktrackChars &&
    a?.emSize === b?.emSize
  );
}

interface NormalCache {
  pages: PageSlice[][];
  /** Global line span `[start, end)` of every page, in page order. */
  pageRanges: { start: number; end: number }[];
  paraLineStarts: number[];
  metrics: readonly LineMetric[];
}

interface ExclusionCache {
  lines: PageLine[];
  lineParaIndex: number[];
  entries: RenderEntry[];
  /** Global index of each paragraph's first line, parallel to `entries`. */
  paraLineStarts: number[];
  metrics: readonly LineMetric[];
  spreadLayouts: SpreadLayoutInfo[];
  totalPages: number;
}

/** A contiguous run of selected characters inside one line of one paragraph. */
interface SelectionRun {
  paragraph: number;
  /** Line index within the paragraph. */
  inParaLine: number;
  /** First character index of the line the run sits on. */
  lineStart: number;
  charStart: number;
  charEnd: number;
}

/** Line breaks and the advances they were produced from, before committing. */
interface BrokenChapter {
  entries: RenderEntry[];
  /** Per paragraph: the advance array {@link BrokenChapter.entries} came from. */
  layoutAdvances: Float32Array[];
}

const MAX_REGEX_SEARCH_PATTERN_LENGTH = 256;
const MAX_REGEX_SEARCH_TEXT_LENGTH = 1_000_000;

interface RegexGroupState {
  hasAlternation: boolean;
  /** Whether any term anywhere inside this group carries a quantifier. */
  hasQuantifiedTerm: boolean;
  /** The alternative being scanned ends with a quantifier nothing separates. */
  quantifierOpen: boolean;
  /** The alternative being scanned has a quantifier before any consuming term. */
  startsQuantified: boolean;
  /** The alternative being scanned has a term that always consumes input. */
  consumes: boolean;
  /** {@link RegexGroupState.quantifierOpen} for any finished alternative. */
  anyQuantifierOpen: boolean;
  /** {@link RegexGroupState.startsQuantified} for any finished alternative. */
  anyStartsQuantified: boolean;
  /** {@link RegexGroupState.consumes} for every finished alternative. */
  allConsume: boolean;
}

/**
 * A scanned regex term, described only by how it can interact with the terms
 * next to it. Character classes, escapes, literals and groups all reduce to
 * these three properties.
 */
interface RegexTerm {
  /** The term can begin with a quantifier that nothing on its left separates. */
  startsQuantified: boolean;
  /** The term can end with a quantifier that nothing on its right separates. */
  endsQuantified: boolean;
  /** The term always consumes at least one character, so it separates neighbours. */
  consumes: boolean;
  /** The group this term stands for, when the term is parenthesised. */
  group?: RegexGroupState;
}

function newRegexGroupState(): RegexGroupState {
  return {
    hasAlternation: false,
    hasQuantifiedTerm: false,
    quantifierOpen: false,
    startsQuantified: false,
    consumes: false,
    anyQuantifierOpen: false,
    anyStartsQuantified: false,
    allConsume: true,
  };
}

/** A plain term that always consumes exactly one position of the input. */
function consumingRegexTerm(): RegexTerm {
  return { startsQuantified: false, endsQuantified: false, consumes: true };
}

/**
 * Appends `term` to the alternative being scanned.
 *
 * Rejects the pattern when the term opens with a quantifier while the previous
 * quantifier is still unseparated: only then can the input be split between the
 * two quantifiers in exponentially many ways. A term that always consumes input
 * closes the previous quantifier, because it anchors where the next attempt can
 * start.
 */
function commitRegexTerm(group: RegexGroupState, term: RegexTerm | undefined): void {
  if (!term) return;
  if (term.startsQuantified && group.quantifierOpen) {
    throw new MejiroError('regex-unsafe', 'Unsafe regex search pattern: adjacent quantifiers');
  }
  group.startsQuantified ||= term.startsQuantified && !group.consumes;
  group.quantifierOpen = term.endsQuantified || (group.quantifierOpen && !term.consumes);
  group.consumes ||= term.consumes;
}

/** Folds the alternative being scanned into the group's cross-alternative state. */
function endRegexAlternative(group: RegexGroupState): void {
  group.anyQuantifierOpen ||= group.quantifierOpen;
  group.anyStartsQuantified ||= group.startsQuantified;
  group.allConsume &&= group.consumes;
  group.quantifierOpen = false;
  group.startsQuantified = false;
  group.consumes = false;
}

/**
 * Returns the length of the marker that follows `(` for a non-capturing group,
 * a lookaround or a named group, so the scanner can skip it.
 */
function regexGroupPrefixLength(source: string, index: number): number {
  const marker = source.slice(index + 1).match(/^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/u);
  return marker ? marker[0].length : 0;
}

/**
 * Rejects a page dimension that cannot produce a consistent layout.
 * `undefined` means "absent", which only an optional dimension may be.
 */
function assertDimension(
  where: string,
  name: string,
  value: number | undefined,
  kind: 'positive' | 'non-negative' | 'optional-positive',
): void {
  if (value === undefined && kind !== 'positive') return;
  const positive = kind !== 'non-negative';
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    const requirement = positive ? 'positive' : 'non-negative';
    throw new RangeError(`${where}: ${name} must be a ${requirement} finite number`);
  }
}

/**
 * @internal Validates a complete page size the way {@link MejiroBook.setPageSize}
 * and {@link ChapterLayout.resize} both require: positive finite page and line
 * widths, non-negative finite paddings, side padding below half the page width,
 * and positive finite heights when a {@link PageGeometry} supplies them.
 *
 * @throws RangeError naming the first dimension that fails.
 */
export function assertPageSize(size: PageSize & Partial<PageGeometry>, where: string): void {
  assertDimension(where, 'pageWidth', size.pageWidth, 'positive');
  assertDimension(where, 'lineWidth', size.lineWidth, 'positive');
  assertDimension(where, 'paddingX', size.paddingX, 'non-negative');
  assertDimension(where, 'paddingY', size.paddingY, 'non-negative');
  assertDimension(where, 'pageHeight', size.pageHeight, 'optional-positive');
  assertDimension(where, 'contentHeight', size.contentHeight, 'optional-positive');
  if ((size.paddingX ?? 0) * 2 >= size.pageWidth) {
    throw new RangeError(`${where}: paddingX must be less than half of pageWidth`);
  }
}

/**
 * Returns the flags {@link ChapterLayout.findText} compiles a query with.
 *
 * Matching is always global. A `RegExp` query keeps every flag of its own but
 * `g` and `y`, which would make the search depend on its `lastIndex`. A string
 * query is Unicode-aware and case-insensitive unless `caseSensitive` is `true`.
 */
function searchFlags(query: string | RegExp, caseSensitive: boolean): string {
  if (query instanceof RegExp) return `${query.flags.replace(/[gy]/g, '')}g`;
  return caseSensitive ? 'gu' : 'giu';
}

function emptyPageResult(): PageResult {
  return { page: { paragraphs: [] }, lines: [], slots: [], hasImages: false };
}

/** Returns whether `value` can address a paragraph or a character position. */
function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Returns a {@link AnchorRange} with `start` ≤ `end` in document order,
 * or `null` if the range is empty (zero-width caret).
 */
function normalizeAnchorRange(range: AnchorRange): AnchorRange | null {
  const cmp =
    range.start.paragraphIndex - range.end.paragraphIndex ||
    range.start.charIndex - range.end.charIndex;
  if (cmp === 0) return null;
  return cmp < 0 ? range : { start: range.end, end: range.start };
}

/**
 * Builds a lookup table mapping JS UTF-16 string positions to codepoint
 * indices for a paragraph segmented into per-codepoint `chars`.
 *
 * For each JS position `j` in `[0, jsLength]`, the table holds the codepoint
 * index of the codepoint that contains `j`. The sentinel at `jsLength` stores
 * `chars.length` (the past-end codepoint index).
 *
 * `chars[i].length` is `1` for BMP codepoints and `2` for supplementary-plane
 * codepoints (surrogate pairs). Both halves of a surrogate pair map to the
 * same codepoint index.
 */
function buildJsToCpOffsetMap(chars: readonly string[], jsLength: number): Uint32Array {
  const map = new Uint32Array(jsLength + 1);
  let pos = 0;
  for (let i = 0; i < chars.length; i++) {
    map[pos] = i;
    const len = chars[i].length;
    if (len === 2) map[pos + 1] = i;
    pos += len;
  }
  map[pos] = chars.length;
  return map;
}

/**
 * Returns the line index within a paragraph that contains the given
 * NFC Unicode codepoint offset.
 *
 * `breakPoints[i]` is the final char-index of line `i` (inclusive); line 0
 * spans `[0, breakPoints[0] + 1)`. When `c` lies past the last break point,
 * the last line is returned.
 */
function findInParaLine(breakPoints: Uint32Array, c: number): number {
  // Smallest i such that breakPoints[i] >= c → line index containing c.
  let lo = 0;
  let hi = breakPoints.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (breakPoints[mid] >= c) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function lineStartChar(breakPoints: Uint32Array, inParaLine: number): number {
  return inParaLine === 0 ? 0 : breakPoints[inParaLine - 1] + 1;
}

function lineEndChar(breakPoints: Uint32Array, inParaLine: number, charCount: number): number {
  return inParaLine < breakPoints.length ? breakPoints[inParaLine] + 1 : charCount;
}

/**
 * Copies an inline annotation deeply enough that nothing inside it is shared
 * with the source. Only the ruby variant carries a nested array.
 */
function cloneInlineAnnotation(annotation: InlineAnnotation): InlineAnnotation {
  if (annotation.type === 'ruby' && annotation.jukugoSplitPoints) {
    return { ...annotation, jukugoSplitPoints: [...annotation.jukugoSplitPoints] };
  }
  return { ...annotation };
}

/** Copies a heading-style table and each style object it holds. */
function cloneHeadingStyles(styles: Record<number, HeadingStyle>): Record<number, HeadingStyle> {
  const out: Record<number, HeadingStyle> = {};
  for (const [level, style] of Object.entries(styles)) {
    out[Number(level)] = { ...style };
  }
  return out;
}

/**
 * @internal What {@link MejiroBook} needs from a layout beyond its public
 * surface, reached through {@link chapterLayoutChannel}.
 */
export interface ChapterLayoutChannel {
  /** Whether the cached advances were measured for the family, size and heading scales of `config`. */
  measuredAt(config: MeasurementConfig): boolean;
  /**
   * Applies a layout config that changes no measured field, marking the line
   * breaks stale when `kinsoku` / `enableHanging` / `breakCost` change.
   *
   * @throws Error if `config` changes a measured field; that change goes
   *   through {@link ChapterLayoutChannel.recomputeAfterMeasurement}.
   */
  applyConfig(config: LayoutConfig): void;
  /** The config the layout currently holds, for a re-measure that must not change it. */
  getConfig(): LayoutConfig;
  /** The cached paragraphs, for re-measuring their advances in place. */
  cachedParagraphs(): CachedParagraph[];
  /**
   * Adopts `config` after the cached paragraphs' advances / ruby / tate-chu-yoko
   * were re-measured against it, and marks the line breaks stale.
   */
  recomputeAfterMeasurement(config: LayoutConfig): void;
  /** Adopts the image exclusions of a snapshot, deferring the reflow to the next read. */
  restoreImages(spreads: readonly SpreadImagesSnapshot[]): void;
}

/** The book-side operations of every layout, kept off the instances' public surface. */
const channels = new WeakMap<ChapterLayout, ChapterLayoutChannel>();

/** @internal The geometry a layout was given: a page size, and its heights when they are known. */
type LayoutSize = Required<PageSize> & Partial<Pick<PageGeometry, 'pageHeight' | 'contentHeight'>>;

/**
 * @internal Creates a {@link ChapterLayout}. The only way one is made: by
 * {@link MejiroBook}, and by tests that need a layout over hand-built paragraphs.
 *
 * @param size - Page size; `pageHeight` and `contentHeight` are kept when given.
 */
export function createChapterLayout(
  cached: CachedParagraph[],
  entries: RenderEntry[],
  config: LayoutConfig,
  size: LayoutSize,
): ChapterLayout {
  return new ChapterLayout(cached, entries, config, size);
}

/** @internal The book-side operations of `layout`. */
export function chapterLayoutChannel(layout: ChapterLayout): ChapterLayoutChannel {
  const channel = channels.get(layout);
  if (!channel) throw new TypeError('chapterLayoutChannel: not a ChapterLayout');
  return channel;
}

/**
 * Manages the layout of a single chapter with pagination, heading support,
 * and image exclusion. Created by {@link MejiroBook.layoutChapter},
 * {@link MejiroBook.layoutManuscript} and {@link MejiroBook.layoutFromSnapshot}.
 *
 * Supports lazy computation: layout is only computed when data is first requested
 * via {@link getSpread} or {@link getPage}, and is cached until invalidated by
 * {@link resize}, {@link setImages}, or {@link clearImages}.
 */
export class ChapterLayout {
  private cached: CachedParagraph[];
  private entries: RenderEntry[];
  /**
   * Per paragraph: the advances `entries[i].breakPoints` were computed from.
   * Filled on re-break and lazily for externally supplied entries; see
   * {@link ChapterLayout.layoutAdvancesOf}.
   */
  private layoutAdvances: (Float32Array | undefined)[] = [];
  // Set by an option or font change; the re-break runs on the next read, so a
  // layout replaced before anyone reads it never pays for one.
  private breaksStale = false;
  private config: LayoutConfig;
  private size: LayoutSize;
  private images = new Map<number, BookImage[]>();

  private normal: NormalCache | null = null;
  private excl: ExclusionCache | null = null;

  /** @internal Use {@link createChapterLayout}. */
  constructor(
    cached: CachedParagraph[],
    entries: RenderEntry[],
    config: LayoutConfig,
    size: LayoutSize,
  ) {
    this.cached = cached;
    this.entries = entries;
    // `entries` and `cached` describe the same paragraphs; adopt the structural
    // kind so re-breaking from `cached` alone still carries it to the renderer.
    for (let i = 0; i < cached.length; i++) {
      if (cached[i].kind == null && entries[i]?.kind != null) cached[i].kind = entries[i].kind;
    }
    this.config = { ...config };
    this.size = { ...size };
    channels.set(this, {
      measuredAt: (c) => sameMeasurement(this.config, c),
      applyConfig: (c) => this.applyConfig(c),
      getConfig: () => ({ ...this.config }),
      cachedParagraphs: () => this.cached,
      recomputeAfterMeasurement: (c) => this.recomputeAfterMeasurement(c),
      restoreImages: (spreads) => {
        for (const { spreadIndex, images } of spreads) {
          if (images.length > 0) this.images.set(spreadIndex, [...images]);
        }
        this.invalidate(true);
      },
    });
  }

  /** Number of pages in the current layout. */
  get pageCount(): number {
    if (this.images.size > 0) {
      this.ensureExclusion();
      return this.exclusionTotalPages(this.excl?.spreadLayouts ?? []);
    }
    this.ensureNormal();
    return Math.max(1, this.normal?.pages.length ?? 0);
  }

  private exclusionTotalPages(layouts: readonly SpreadLayoutInfo[]): number {
    const last = layouts.at(-1);
    const emptyTrailingLeft = last ? last.slotCount <= last.rightSlotCount : false;
    return Math.max(1, layouts.length * 2 - (emptyTrailingLeft ? 1 : 0));
  }

  /** Whether any spread has image exclusions set. */
  get hasImages(): boolean {
    return this.images.size > 0;
  }

  /**
   * Page geometry the layout breaks and paginates for: the page size it was
   * last laid out or resized to. When that size carried no heights, the content
   * box is taken to be `lineWidth` tall and the page pads it by `paddingY` at
   * both ends.
   */
  get geometry(): PageGeometry {
    const { pageWidth, lineWidth, paddingX, paddingY } = this.size;
    const contentHeight = this.size.contentHeight ?? lineWidth;
    const pageHeight = this.size.pageHeight ?? contentHeight + paddingY * 2;
    return { pageWidth, lineWidth, paddingX, paddingY, pageHeight, contentHeight };
  }

  /** Typography the layout's advances were last measured with. */
  get typography(): ChapterTypography {
    const { fontFamily, fontSize, lineSpacing } = this.config;
    return { fontFamily, fontSize, lineSpacing };
  }

  private applyConfig(config: LayoutConfig): void {
    if (!sameMeasurement(this.config, config)) {
      throw new Error('ChapterLayout.applyConfig: a measured field changed without re-measuring');
    }
    const breakSensitiveChanged =
      config.kinsoku !== this.config.kinsoku ||
      config.enableHanging !== this.config.enableHanging ||
      !sameBreakCost(config.breakCost, this.config.breakCost);
    this.config = this.adopt(config);
    if (breakSensitiveChanged) this.breaksStale = true;
    this.invalidate();
  }

  /** `config` as the layout's own, keeping the analyzer its hints were derived from. */
  private adopt(config: LayoutConfig): LayoutConfig {
    return { ...config, analyzer: this.config.analyzer };
  }

  private recomputeAfterMeasurement(config: LayoutConfig): void {
    this.config = this.adopt(config);
    this.breaksStale = true;
    this.invalidate();
  }

  /**
   * Updates page geometry and/or line spacing.
   * Re-computes line breaks if `lineWidth` changes.
   *
   * The update is applied as a unit: the resulting size is validated and the
   * new line breaks are computed before any visible state changes, so a
   * rejected size leaves the layout on its previous geometry, entries and
   * caches. A {@link PageGeometry} from {@link MejiroBook.fitPageSize} can be
   * passed as it is.
   *
   * @param size - Page size overrides plus optional `lineSpacing`.
   * @throws RangeError If the resulting size fails the checks of
   *   {@link MejiroBook.setPageSize}, or `lineSpacing` is not a positive finite number.
   */
  resize(size: Partial<PageGeometry> & Pick<BookOptionsPatch, 'lineSpacing'>): void {
    assertDimension('ChapterLayout.resize', 'lineSpacing', size.lineSpacing, 'optional-positive');
    const next: LayoutSize = { ...this.size };
    for (const key of ['pageWidth', 'lineWidth', 'paddingX', 'paddingY'] as const) {
      const value = size[key];
      if (value !== undefined) next[key] = value;
    }
    // Heights describe the page as a whole; a new width or top padding without
    // them leaves the previous ones describing another page.
    if (size.pageHeight !== undefined && size.contentHeight !== undefined) {
      next.pageHeight = size.pageHeight;
      next.contentHeight = size.contentHeight;
    } else if (next.lineWidth !== this.size.lineWidth || next.paddingY !== this.size.paddingY) {
      next.pageHeight = undefined;
      next.contentHeight = undefined;
    }
    assertPageSize(next, 'ChapterLayout.resize');

    // Break with the new width first: if it throws, nothing has been committed.
    const rebroken =
      next.lineWidth !== this.size.lineWidth ? this.breakEntries(next.lineWidth) : null;

    this.size = next;
    if (size.lineSpacing != null) this.config.lineSpacing = size.lineSpacing;
    if (rebroken) this.commitBreaks(rebroken);
    this.invalidate();
  }

  /**
   * Sets the image exclusions of a spread, reflows, and returns that spread.
   * An empty array removes the spread's images.
   *
   * @param spreadIndex - Zero-based spread index.
   * @param images - Image rectangles relative to the right page's top-left corner.
   * @returns The spread at `spreadIndex` after the reflow.
   */
  setImages(spreadIndex: number, images: readonly BookImage[]): SpreadResult {
    if (images.length === 0) {
      this.images.delete(spreadIndex);
    } else {
      this.images.set(spreadIndex, [...images]);
    }
    this.invalidate(true);
    return this.getSpread(spreadIndex);
  }

  /**
   * Removes image exclusions.
   *
   * @param spreadIndex - Spread whose images to remove; every spread's when omitted.
   */
  clearImages(spreadIndex?: number): void {
    if (spreadIndex === undefined) this.images.clear();
    else this.images.delete(spreadIndex);
    this.invalidate(true);
  }

  /**
   * Returns layout data for a two-page spread.
   *
   * @param spreadIndex - Zero-based spread index.
   * @returns Spread result containing right and left page data.
   */
  getSpread(spreadIndex: number): SpreadResult {
    const tp = this.pageCount;
    if (this.images.size > 0) {
      return this.getExclusionSpread(spreadIndex, tp);
    }
    return this.getNormalSpread(spreadIndex, tp);
  }

  /**
   * Returns layout data for a single page.
   *
   * @param pageIndex - Zero-based page index.
   * @returns Page result with paragraph data, flat lines, and column slots.
   */
  getPage(pageIndex: number): PageResult {
    const side = pageIndex % 2 === 0 ? 'right' : 'left';
    if (this.images.size > 0) {
      this.ensureExclusion();
      const sl = (this.excl as ExclusionCache).spreadLayouts[Math.floor(pageIndex / 2)];
      return sl ? this.buildExclusionSide(sl, side) : emptyPageResult();
    }
    this.ensureNormal();
    return this.buildNormalPage(pageIndex);
  }

  /**
   * Locates a reading position in the current layout.
   *
   * @param anchor - In-chapter anchor (paragraph + char index).
   * @returns The spread / page / line containing the anchor, or `null` if the
   *   anchor is out of range, either field is not a non-negative safe integer,
   *   or the chapter is empty.
   */
  locateAnchor(anchor: InChapterAnchor): AnchorLocation | null {
    const { paragraphIndex, charIndex } = anchor;
    if (!this.isAnchorInRange(paragraphIndex, charIndex)) return null;

    if (this.images.size > 0) {
      return this.locateAnchorInExclusion(paragraphIndex, charIndex);
    }
    return this.locateAnchorInNormal(paragraphIndex, charIndex);
  }

  /**
   * Returns the in-chapter anchor for the first character of a spread.
   *
   * Useful for converting a spread index back into a stable reading anchor
   * that survives reflow.
   *
   * @param spreadIndex - Zero-based spread index.
   * @param options - Which page of the spread to read.
   * @returns An in-chapter anchor pointing at the first character of the
   *   chosen page, or `null` if the spread / page does not exist.
   */
  anchorAt(spreadIndex: number, options: AnchorAtOptions = {}): InChapterAnchor | null {
    const side = options.side ?? 'right';
    if (this.images.size > 0) {
      return this.anchorAtInExclusion(spreadIndex, side);
    }
    return this.anchorAtInNormal(spreadIndex * 2 + (side === 'right' ? 0 : 1));
  }

  /**
   * Returns the anchor just past the chapter's last character: the last
   * paragraph, at its length in the NFC code points the layout counts in.
   *
   * @returns The end-of-chapter anchor, or `null` for a chapter with no paragraphs.
   */
  endAnchor(): InChapterAnchor | null {
    const last = this.cached.length - 1;
    if (last < 0) return null;
    return { paragraphIndex: last, charIndex: this.cached[last].text.length };
  }

  /**
   * Returns the pixel bounding rectangle of the character at the given
   * in-chapter anchor.
   *
   * Coordinates are spread-local relative to the right page's content
   * top-left (see {@link AnchorRect}). Pass `null` results through — they
   * indicate the anchor is out of range for the current layout.
   *
   * Sizes follow the advances the current line breaks were computed from, so
   * ruby-widened characters get the extent they actually occupy.
   *
   * @param anchor - In-chapter anchor (paragraph + char index).
   * @returns Character rectangle, or `null` when the anchor cannot be located.
   */
  coordOfAnchor(anchor: InChapterAnchor): AnchorRect | null {
    if (!this.isAnchorInRange(anchor.paragraphIndex, anchor.charIndex)) return null;
    if (this.images.size > 0) return this.coordOfAnchorInExclusion(anchor);
    return this.coordOfAnchorInNormal(anchor);
  }

  /**
   * Returns whether the anchor addresses a character position that exists.
   *
   * Both fields must be non-negative safe integers so that no lookup keyed on
   * them can be fractional or `NaN`; `charIndex` may equal the paragraph
   * length, which addresses the position past its last character.
   */
  private isAnchorInRange(paragraph: number, charIndex: number): boolean {
    if (!isNonNegativeSafeInteger(paragraph) || paragraph >= this.cached.length) return false;
    if (!isNonNegativeSafeInteger(charIndex)) return false;
    return charIndex <= this.cached[paragraph].text.length;
  }

  /**
   * Returns the in-chapter anchor at a pixel coordinate within a spread.
   *
   * Coordinates are spread-local relative to the right page's content
   * top-left (see {@link AnchorRect}). Right-page x is `[0, contentWidth]`;
   * left-page x is `[-contentWidth, 0]`. `y` covers the inline-direction
   * column height `[0, lineWidth]`.
   *
   * @param spreadIndex - Zero-based spread index.
   * @param point - Spread-local coordinate in pixels.
   * @returns Anchor at the coordinate, or `null` if outside any column.
   */
  anchorAtCoord(spreadIndex: number, point: SpreadPoint): InChapterAnchor | null {
    const { x, y } = point;
    if (this.images.size > 0) return this.anchorAtCoordInExclusion(spreadIndex, x, y);
    return this.anchorAtCoordInNormal(spreadIndex, x, y);
  }

  /**
   * Returns per-line rectangles covering the characters in `range`, suitable
   * for rendering a selection highlight overlay.
   *
   * Each returned rectangle covers a contiguous run of characters on a single
   * line. The range is normalized — `start` and `end` may be passed in either
   * order. An empty range (`start` equal to `end`) returns an empty array.
   *
   * Each page the range crosses is located and built once, so the cost follows
   * the number of pages spanned rather than the number of characters selected.
   *
   * @param range - The character range to highlight.
   * @returns Spread-local rectangles in document order.
   */
  selectionRects(range: AnchorRange): AnchorRect[] {
    const norm = normalizeAnchorRange(range);
    if (!norm) return [];
    return this.images.size > 0
      ? this.selectionRectsInExclusion(norm)
      : this.selectionRectsInNormal(norm);
  }

  /**
   * Returns a serializable snapshot of this layout, suitable for SSR /
   * build-time pre-computation. Pair with {@link MejiroBook.layoutFromSnapshot}
   * to skip the measurement round-trip on the client.
   *
   * The snapshot bakes in the current config (font size / line spacing / page
   * geometry); restoring with a different config requires either passing the
   * snapshot to a fresh `MejiroBook` whose options match, or calling
   * `updateOptions` afterwards (which re-measures from scratch).
   */
  snapshot(): ChapterLayoutSnapshot {
    this.ensureBreaks();
    const paragraphs: ParagraphSnapshot[] = this.cached.map((para, i) => {
      const entry = this.entries[i];
      const snap: ParagraphSnapshot = {
        text: para.chars.join(''),
        advances: Array.from(para.advances),
        breakPoints: Array.from(entry.breakPoints),
        inlineAnnotations: para.inlineAnnotations.map(cloneInlineAnnotation),
        ...(para.headingLevel != null ? { headingLevel: para.headingLevel } : {}),
        ...(para.kind != null && para.kind !== 'body' ? { kind: para.kind } : {}),
        ...(para.layoutRubyAnnotations
          ? {
              layoutRubyAnnotations: para.layoutRubyAnnotations.map(
                (r): LayoutRubySnapshot => ({
                  startIndex: r.startIndex,
                  endIndex: r.endIndex,
                  rubyText: Array.from(r.rubyText),
                  rubyAdvances: Array.from(r.rubyAdvances),
                  ...(r.rubyType ? { rubyType: r.rubyType } : {}),
                  ...(r.jukugoSplitPoints ? { jukugoSplitPoints: [...r.jukugoSplitPoints] } : {}),
                }),
              ),
            }
          : {}),
        ...(para.layoutTcyAnnotations
          ? { layoutTcyAnnotations: para.layoutTcyAnnotations.map((t) => ({ ...t })) }
          : {}),
        // Break points depend on the hints, so a snapshot that omitted them would
        // restore a layout whose first re-break moves text the reader is looking at.
        ...(para.hintClusterIds ? { hintClusterIds: Array.from(para.hintClusterIds) } : {}),
        ...(para.hintBreakPenalties
          ? { hintBreakPenalties: Array.from(para.hintBreakPenalties) }
          : {}),
      };
      return snap;
    });
    const images =
      this.images.size > 0
        ? [...this.images.entries()].map(([spreadIndex, spreadImages]) => ({
            spreadIndex,
            images: spreadImages.map((image) => ({ ...image })),
          }))
        : undefined;
    const { pageWidth, lineWidth, paddingX, paddingY } = this.size;

    return {
      version: 3,
      config: {
        fontSize: this.config.fontSize,
        lineSpacing: this.config.lineSpacing,
        headingScale: this.config.headingScale,
        kinsoku: this.config.kinsoku,
        enableHanging: this.config.enableHanging,
        ...(this.config.headingStyles
          ? { headingStyles: cloneHeadingStyles(this.config.headingStyles) }
          : {}),
        ...(this.config.breakCost ? { breakCost: { ...this.config.breakCost } } : {}),
        ...(this.config.analyzer ? { analyzer: { ...this.config.analyzer } } : {}),
      },
      size: { pageWidth, lineWidth, paddingX, paddingY },
      paragraphs,
      ...(images ? { images } : {}),
    };
  }

  /**
   * Searches the chapter text for matches of `query`, returning a list of
   * matches resolved to anchor + layout location.
   *
   * Search is paragraph-local — matches do not span paragraph boundaries.
   * Codepoint offsets (`startIndex` / `endIndex`) are compatible with
   * {@link InChapterAnchor.charIndex} and survive reflow.
   *
   * @param query - A string, matched literally after the same NFC
   *   normalization the layout text takes, so a decomposed `か\u3099` finds
   *   `が`; or a `RegExp`, matched with its own flags. Its `g` and `y` flags are
   *   ignored and its `lastIndex` is neither read nor written.
   * @param options - Search options; `caseSensitive` applies to a string query only.
   * @returns Matches in document order. Empty array when `query` is an empty
   *   string or no matches are found.
   * @throws RangeError If `maxResults` is given and is not a number of at least `1`.
   * @throws MejiroError `regex-unsafe` if a `RegExp` exceeds the safety limits
   *   or the chapter text is too long to search with one. To keep matching
   *   time bounded, the guard also refuses patterns that can backtrack
   *   catastrophically: a quantified group that itself contains a quantifier
   *   or an alternation, and two quantified terms in the same concatenation
   *   with nothing between them that always consumes input (`a*a*b`,
   *   `a*b?a*c`). A term that always consumes anchors the quantifiers on
   *   either side of it, so `\d+年\d+月` is accepted.
   */
  findText(query: string | RegExp, options: FindTextOptions = {}): SearchMatch[] {
    const { caseSensitive = false, maxResults } = options;
    if (maxResults !== undefined && !(maxResults >= 1)) {
      throw new RangeError('ChapterLayout.findText: maxResults must be at least 1');
    }
    const isRegExp = query instanceof RegExp;
    const limit = maxResults === undefined ? Number.POSITIVE_INFINITY : Math.floor(maxResults);
    if (!(isRegExp || query)) return [];

    if (isRegExp) assertSafeRegexSearch(query.source);
    const pattern = new RegExp(
      isRegExp ? query.source : normalizeText(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      searchFlags(query, caseSensitive),
    );

    const results: SearchMatch[] = [];
    let regexTextLength = 0;
    for (let pIdx = 0; pIdx < this.cached.length; pIdx++) {
      const chars = this.cached[pIdx].chars;
      if (chars.length === 0) continue;
      const joined = chars.join('');
      if (isRegExp) {
        regexTextLength += joined.length;
        if (regexTextLength > MAX_REGEX_SEARCH_TEXT_LENGTH) {
          throw new MejiroError(
            'regex-unsafe',
            `Regex search input exceeds ${MAX_REGEX_SEARCH_TEXT_LENGTH} UTF-16 code units`,
          );
        }
      }
      const jsToCp = buildJsToCpOffsetMap(chars, joined.length);

      for (const m of joined.matchAll(pattern)) {
        const matchText = m[0];
        if (matchText.length === 0) continue;
        const idx = m.index ?? 0;
        const startCp = jsToCp[idx];
        const endCp = jsToCp[idx + matchText.length];
        const loc = this.locateAnchor({ paragraphIndex: pIdx, charIndex: startCp });
        if (!loc) continue;
        results.push({
          paragraphIndex: pIdx,
          startIndex: startCp,
          endIndex: endCp,
          match: matchText,
          spreadIndex: loc.spreadIndex,
          pageIndex: loc.pageIndex,
          lineIndex: loc.lineIndex,
          side: loc.side,
        });
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  // ── Private helpers ──

  private contentWidth(): number {
    return this.size.pageWidth - this.size.paddingX * 2;
  }

  /**
   * Adds the heading scale this layout measured the paragraph at: the rounded
   * pixel size over the body size, so `scale × fontSize` is the measured size.
   */
  private scaledParagraph(paragraph: RenderParagraph): RenderParagraph {
    if (!isHeadingParagraph(paragraph)) return paragraph;
    const scale = paragraphFontSize(paragraph, this.config) / this.config.fontSize;
    return { ...paragraph, scale };
  }

  /** Flattens a render paragraph into slot-mode lines. */
  private pageLinesOf(paragraph: RenderParagraph): PageLine[] {
    const fontSize = paragraphFontSize(paragraph, this.config);
    const kind = paragraph.kind ?? (isHeadingParagraph(paragraph) ? 'heading' : undefined);
    return paragraph.lines.map((line) => ({
      segments: line.segments,
      headingLevel: paragraph.headingLevel,
      kind,
      fontSize,
    }));
  }

  private linePitch(): number {
    return this.config.fontSize * this.config.lineSpacing;
  }

  private measureOpts(): MeasureOptions {
    return {
      fontSize: this.config.fontSize,
      lineSpacing: this.config.lineSpacing,
      headingStyles: this.config.headingStyles,
      headingScale: this.config.headingScale,
    };
  }

  /**
   * The one reflow entry point. Drops derived layout so the next read rebuilds
   * it in a single pass, however many changes preceded it; cached paragraph
   * data (advances, hints) is never touched.
   *
   * @param imagesOnly - True for an image change: geometry is unchanged, so
   *   normal pagination stays valid.
   */
  private invalidate(imagesOnly = false): void {
    this.excl = null;
    if (!imagesOnly) this.normal = null;
  }

  private ensureBreaks(): void {
    if (this.breaksStale) this.commitBreaks(this.breakEntries(this.size.lineWidth));
  }

  /**
   * Breaks every paragraph at `lineWidth` without touching visible state, so
   * callers can validate the result before committing it.
   */
  private breakEntries(lineWidth: number): BrokenChapter {
    const entries: RenderEntry[] = [];
    const layoutAdvances: Float32Array[] = [];
    for (const para of this.cached) {
      const br = computeBreaks({
        text: para.text,
        advances: para.advances,
        lineWidth,
        kinsoku: this.config.kinsoku,
        enableHanging: this.config.enableHanging,
        rubyAnnotations: para.layoutRubyAnnotations,
        tcyAnnotations: para.layoutTcyAnnotations,
        // The hints are replayed, never re-derived: a re-break happens on the
        // interactive path and the analysis cannot have changed. Hint clusters
        // are the base IDs, which ruby and tate-chu-yoko overwrite inside their
        // own spans.
        clusterIds: para.hintClusterIds,
        breakPenalties: para.hintBreakPenalties,
        breakCost: this.config.breakCost,
      });
      entries.push({
        chars: para.chars,
        breakPoints: br.breakPoints,
        inlineAnnotations: para.inlineAnnotations,
        headingLevel: para.headingLevel,
        kind: para.kind,
      });
      layoutAdvances.push(br.effectiveAdvances ?? para.advances);
    }
    return { entries, layoutAdvances };
  }

  private commitBreaks(broken: BrokenChapter): void {
    this.entries = broken.entries;
    this.layoutAdvances = broken.layoutAdvances;
    this.breaksStale = false;
  }

  /**
   * Returns the advances the paragraph's current `breakPoints` were produced
   * from: the measured advances with tate-chu-yoko collapsing and ruby width
   * distribution applied, in the order {@link computeBreaks} applies them.
   * Anchor geometry reads these so rectangles and hit tests follow the same
   * metric the line breaker used.
   */
  private layoutAdvancesOf(paragraph: number): Float32Array {
    const known = this.layoutAdvances[paragraph];
    if (known) return known;
    const para = this.cached[paragraph];
    const tcy = para.layoutTcyAnnotations;
    const ruby = para.layoutRubyAnnotations;
    let advances = para.advances;
    if (tcy?.length) {
      advances = preprocessTcy(para.text, advances, tcy).effectiveAdvances;
    }
    if (ruby?.length) {
      advances = preprocessRuby(para.text, advances, ruby).effectiveAdvances;
    }
    this.layoutAdvances[paragraph] = advances;
    return advances;
  }

  // ── Normal (non-exclusion) mode ──

  private ensureNormal(): void {
    if (this.normal) return;
    this.ensureBreaks();
    const opts = this.measureOpts();
    const measures = buildParagraphMeasures(this.entries, opts);
    const pages = paginate(this.contentWidth(), measures);
    const { metrics } = buildLineMetrics(this.entries, opts);

    const paraLineStarts: number[] = [];
    let total = 0;
    for (const entry of this.entries) {
      paraLineStarts.push(total);
      total += entry.breakPoints.length + 1;
    }

    // Global line span of every page; an empty page keeps the running cursor.
    const pageRanges: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const slices of pages) {
      const head = slices[0];
      const start = head ? paraLineStarts[head.paragraphIndex] + head.lineStart : cursor;
      cursor = start + slices.reduce((sum, s) => sum + (s.lineEnd - s.lineStart), 0);
      pageRanges.push({ start, end: cursor });
    }

    this.normal = { pages, pageRanges, paraLineStarts, metrics };
  }

  private getNormalSpread(spreadIndex: number, totalPages: number): SpreadResult {
    this.ensureNormal();
    return {
      right: this.buildNormalPage(spreadIndex * 2),
      left: this.buildNormalPage(spreadIndex * 2 + 1),
      pageCount: totalPages,
    };
  }

  private buildNormalPage(pageIndex: number): PageResult {
    const { pages, paraLineStarts, metrics } = this.normal as NormalCache;
    if (pageIndex >= pages.length) return emptyPageResult();

    const slices = pages[pageIndex];
    if (!slices || slices.length === 0) return emptyPageResult();

    const page = {
      paragraphs: buildRenderPage(slices, this.entries).paragraphs.map((p) =>
        this.scaledParagraph(p),
      ),
    };
    const lines = page.paragraphs.flatMap((p) => this.pageLinesOf(p));

    const firstSlice = slices[0];
    const startLine = paraLineStarts[firstSlice.paragraphIndex] + firstSlice.lineStart;
    const slots = buildColumnSlots({
      metrics,
      startIndex: startLine,
      count: lines.length,
      columnHeight: this.size.lineWidth,
    });

    return { page, lines, slots, hasImages: false };
  }

  // ── Exclusion mode ──

  private ensureExclusion(): void {
    if (this.excl) return;
    this.ensureBreaks();
    this.computeExclusion();
  }

  private computeExclusion(): void {
    const { fontSize } = this.config;
    const opts = this.measureOpts();
    const pm = paragraphMetrics(opts);

    const pageImages = new Map<number, SpreadPageImages>();
    for (const [si, imgs] of this.images) {
      const rects: SpreadImageRect[] = imgs.map((img) => ({
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height,
        inlineMargin: img.margin ?? fontSize,
      }));
      pageImages.set(
        si,
        splitSpreadImages(rects, {
          pageWidth: this.size.pageWidth,
          paddingX: this.size.paddingX,
          paddingY: this.size.paddingY,
        }),
      );
    }
    const flow = new ColumnFlow(
      {
        contentWidth: this.contentWidth(),
        lineWidth: this.size.lineWidth,
        basePitch: pm.basePitch,
      },
      pageImages,
    );

    // A line's slot depends only on the lines before it, so each paragraph is
    // broken once against the widths a probe of the flow reports, then placed.
    const entries: RenderEntry[] = [];
    for (let pi = 0; pi < this.cached.length; pi++) {
      const para = this.cached[pi];
      const entry: RenderEntry = {
        chars: para.chars,
        breakPoints: new Uint32Array(0),
        inlineAnnotations: para.inlineAnnotations,
        headingLevel: para.headingLevel,
        kind: para.kind,
      };
      const pitch = pm.pitch(entry);
      const first: LineMetric = {
        pitch,
        gapBefore: pi > 0 ? pm.gapBefore(entry, entries[pi - 1]) : 0,
      };
      const rest: LineMetric = { pitch, gapBefore: 0 };

      entry.breakPoints = flow.pastImages
        ? this.breakWithLineWidths(para)
        : this.breakProbed(para, flow, first, rest);
      for (let li = 0; li <= entry.breakPoints.length; li++) flow.place(li === 0 ? first : rest);
      entries.push(entry);
    }

    // Flatten all lines for slot-based rendering
    const allSlices: PageSlice[] = entries.map((e, i) => ({
      paragraphIndex: i,
      lineStart: 0,
      lineEnd: e.breakPoints.length + 1,
    }));
    const fullPage = buildRenderPage(allSlices, entries);
    const { metrics: lm } = buildLineMetrics(entries, opts);

    const allLines: PageLine[] = [];
    const lineParaIdx: number[] = [];
    let pi = 0;
    for (const para of fullPage.paragraphs) {
      for (const line of this.pageLinesOf(para)) {
        allLines.push(line);
        lineParaIdx.push(pi);
      }
      pi++;
    }

    const layouts = flow.finish();

    const paraLineStarts: number[] = [];
    let paraLine = 0;
    for (const entry of entries) {
      paraLineStarts.push(paraLine);
      paraLine += entry.breakPoints.length + 1;
    }

    this.excl = {
      lines: allLines,
      lineParaIndex: lineParaIdx,
      entries,
      paraLineStarts,
      metrics: lm,
      spreadLayouts: layouts,
      totalPages: this.exclusionTotalPages(layouts),
    };
  }

  /**
   * Breaks a paragraph against the widths a probe of `flow` reports. The probe
   * starts at the line count the text needs on full-width lines and doubles
   * (up to one line per character) while the break runs past it.
   */
  private breakProbed(
    para: CachedParagraph,
    flow: ColumnFlow,
    first: LineMetric,
    rest: LineMetric,
  ): Uint32Array {
    const probe = flow.probe();
    const widths: number[] = [];
    let total = 0;
    for (const advance of para.advances) total += advance;
    const maxLines = para.text.length + 1;
    let target = Math.min(maxLines, Math.ceil(total / this.size.lineWidth) + 1);
    for (;;) {
      while (widths.length < target && !probe.pastImages) {
        widths.push(probe.place(widths.length === 0 ? first : rest));
      }
      const breakPoints = this.breakWithLineWidths(para, new Float32Array(widths));
      if (breakPoints.length < widths.length || probe.pastImages) return breakPoints;
      target = Math.min(maxLines, target * 2);
    }
  }

  private breakWithLineWidths(para: CachedParagraph, lineWidths?: Float32Array): Uint32Array {
    return computeBreaks({
      text: para.text,
      advances: para.advances,
      lineWidth: this.size.lineWidth,
      lineWidths,
      kinsoku: this.config.kinsoku,
      enableHanging: this.config.enableHanging,
      rubyAnnotations: para.layoutRubyAnnotations,
      tcyAnnotations: para.layoutTcyAnnotations,
      // Same replayed hints as the uniform-width break, so a column shortened
      // by an image breaks under the same constraints as an unobstructed one.
      clusterIds: para.hintClusterIds,
      breakPenalties: para.hintBreakPenalties,
      breakCost: this.config.breakCost,
    }).breakPoints;
  }

  private getExclusionSpread(spreadIndex: number, totalPages: number): SpreadResult {
    this.ensureExclusion();
    const { spreadLayouts } = this.excl as ExclusionCache;
    const sl = spreadLayouts[spreadIndex];

    if (!sl) {
      return { right: emptyPageResult(), left: emptyPageResult(), pageCount: totalPages };
    }

    return {
      right: this.buildExclusionSide(sl, 'right'),
      left: this.buildExclusionSide(sl, 'left'),
      pageCount: totalPages,
    };
  }

  /** Global line range `[start, end)` one side of a reflowed spread holds. */
  private exclusionSideRange(sl: SpreadLayoutInfo, side: 'right' | 'left'): [number, number] {
    const split = sl.lineStart + sl.rightSlotCount;
    return side === 'right' ? [sl.lineStart, split] : [split, sl.lineStart + sl.slotCount];
  }

  private buildExclusionSide(sl: SpreadLayoutInfo, side: 'right' | 'left'): PageResult {
    const [start, end] = this.exclusionSideRange(sl, side);
    return side === 'right'
      ? this.buildExclusionPage(start, end, sl.rightSlots, sl.hasRightImages)
      : this.buildExclusionPage(start, end, sl.leftSlots, sl.hasLeftImages);
  }

  /** Render paragraph for a run of exclusion-mode lines, resolved as in normal mode. */
  private exclusionParagraph(entry: RenderEntry, lines: RenderLine[]): RenderParagraph {
    return this.scaledParagraph({ lines, ...paragraphHeading(entry) });
  }

  private buildExclusionPage(
    start: number,
    end: number,
    slots: ColumnSlot[],
    hasImages: boolean,
  ): PageResult {
    const { lines, lineParaIndex, entries } = this.excl as ExclusionCache;
    const pageLines = lines.slice(start, end);

    // Group lines into paragraphs for RenderPage
    const paragraphs: RenderParagraph[] = [];
    let curPi = -1;
    let curLines: RenderLine[] = [];

    for (let i = start; i < end; i++) {
      const pi = lineParaIndex[i];
      if (pi !== curPi) {
        if (curLines.length > 0) {
          paragraphs.push(this.exclusionParagraph(entries[curPi], curLines));
        }
        curPi = pi;
        curLines = [];
      }
      curLines.push({ segments: lines[i].segments });
    }
    if (curLines.length > 0 && curPi >= 0) {
      paragraphs.push(this.exclusionParagraph(entries[curPi], curLines));
    }

    return { page: { paragraphs }, lines: pageLines, slots, hasImages };
  }

  // ── Anchor locator helpers ──

  private locateAnchorInNormal(paragraph: number, charIndex: number): AnchorLocation | null {
    this.ensureNormal();
    const { pageRanges, paraLineStarts } = this.normal as NormalCache;
    const inParaLine = findInParaLine(this.entries[paragraph].breakPoints, charIndex);
    const globalLine = paraLineStarts[paragraph] + inParaLine;

    // Ranges are contiguous and ordered: the page is the first one ending past the line.
    let lo = 0;
    let hi = pageRanges.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pageRanges[mid].end > globalLine) hi = mid;
      else lo = mid + 1;
    }
    const range = pageRanges[lo];
    if (!range || globalLine < range.start) return null;
    return {
      spreadIndex: Math.floor(lo / 2),
      pageIndex: lo,
      lineIndex: globalLine,
      side: lo % 2 === 0 ? 'right' : 'left',
    };
  }

  private locateAnchorInExclusion(paragraph: number, charIndex: number): AnchorLocation | null {
    this.ensureExclusion();
    const { entries, paraLineStarts, spreadLayouts } = this.excl as ExclusionCache;
    const inParaLine = findInParaLine(entries[paragraph].breakPoints, charIndex);
    const globalLine = paraLineStarts[paragraph] + inParaLine;

    // The spread holding the line is the last one starting at or before it.
    let lo = 0;
    let hi = spreadLayouts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (spreadLayouts[mid].lineStart > globalLine) hi = mid;
      else lo = mid + 1;
    }
    const s = lo - 1;
    const sl = spreadLayouts[s];
    if (!sl || globalLine >= sl.lineStart + sl.slotCount) return null;
    const isRight = globalLine < sl.lineStart + sl.rightSlotCount;
    return {
      spreadIndex: s,
      pageIndex: s * 2 + (isRight ? 0 : 1),
      lineIndex: globalLine,
      side: isRight ? 'right' : 'left',
    };
  }

  private anchorAtInNormal(pageIdx: number): InChapterAnchor | null {
    this.ensureNormal();
    const { pages } = this.normal as NormalCache;
    if (pageIdx < 0 || pageIdx >= pages.length) return null;
    const slices = pages[pageIdx];
    const first = slices?.[0];
    if (!first) return null;
    const inParaLine = first.lineStart;
    const bp = this.entries[first.paragraphIndex].breakPoints;
    const charIndex = lineStartChar(bp, inParaLine);
    return { paragraphIndex: first.paragraphIndex, charIndex };
  }

  private anchorAtInExclusion(spreadIndex: number, side: 'right' | 'left'): InChapterAnchor | null {
    this.ensureExclusion();
    const { entries, lineParaIndex, paraLineStarts, spreadLayouts } = this.excl as ExclusionCache;
    const sl = spreadLayouts[spreadIndex];
    if (!sl) return null;
    const [targetLine, end] = this.exclusionSideRange(sl, side);
    // A side an image blocks entirely owns no lines; its range start belongs to another page.
    if (targetLine >= end || targetLine >= lineParaIndex.length) return null;
    const paragraphIndex = lineParaIndex[targetLine];
    const inParaLine = targetLine - paraLineStarts[paragraphIndex];
    const bp = entries[paragraphIndex].breakPoints;
    const charIndex = lineStartChar(bp, inParaLine);
    return { paragraphIndex, charIndex };
  }

  // ── Coord ↔ anchor helpers ──

  private coordOfAnchorInNormal(anchor: InChapterAnchor): AnchorRect | null {
    const loc = this.locateAnchorInNormal(anchor.paragraphIndex, anchor.charIndex);
    if (!loc) return null;
    const { pages, paraLineStarts, metrics } = this.normal as NormalCache;
    const slices = pages[loc.pageIndex];
    const first = slices?.[0];
    if (!first) return null;
    const pageStart = paraLineStarts[first.paragraphIndex] + first.lineStart;
    const slotIdx = loc.lineIndex - pageStart;
    const page = this.buildNormalPage(loc.pageIndex);
    const slot = page.slots[slotIdx];
    if (!slot) return null;
    return this.makeAnchorRect(
      anchor,
      slot,
      metrics[loc.lineIndex]?.pitch ?? this.linePitch(),
      loc,
      this.entries[anchor.paragraphIndex].breakPoints,
    );
  }

  private coordOfAnchorInExclusion(anchor: InChapterAnchor): AnchorRect | null {
    const loc = this.locateAnchorInExclusion(anchor.paragraphIndex, anchor.charIndex);
    if (!loc) return null;
    const { entries, metrics, spreadLayouts } = this.excl as ExclusionCache;
    const sl = spreadLayouts[loc.spreadIndex];
    if (!sl) return null;
    const offset = loc.lineIndex - sl.lineStart;
    const onRight = offset < sl.rightSlotCount;
    const slot = onRight ? sl.rightSlots[offset] : sl.leftSlots[offset - sl.rightSlotCount];
    if (!slot) return null;
    return this.makeAnchorRect(
      anchor,
      slot,
      metrics[loc.lineIndex]?.pitch ?? this.linePitch(),
      loc,
      entries[anchor.paragraphIndex].breakPoints,
    );
  }

  private makeAnchorRect(
    anchor: InChapterAnchor,
    slot: ColumnSlot,
    colPitch: number,
    loc: AnchorLocation,
    breakPoints: Uint32Array,
  ): AnchorRect {
    const advances = this.layoutAdvancesOf(anchor.paragraphIndex);
    const inParaLine = findInParaLine(breakPoints, anchor.charIndex);
    const lineStart = lineStartChar(breakPoints, inParaLine);
    let yOffset = 0;
    for (let i = lineStart; i < anchor.charIndex; i++) yOffset += advances[i];
    const charAdvance =
      anchor.charIndex < advances.length ? advances[anchor.charIndex] : this.config.fontSize;
    const contentWidth = this.contentWidth();
    const rightEdge = loc.side === 'right' ? contentWidth - slot.xPos : -slot.xPos;
    return {
      spreadIndex: loc.spreadIndex,
      pageIndex: loc.pageIndex,
      side: loc.side,
      x: rightEdge - colPitch,
      y: slot.yStart + yOffset,
      width: colPitch,
      height: charAdvance,
    };
  }

  // ── Selection rectangles ──

  /**
   * Splits a normalized range into per-line runs, using the break points the
   * given entries carry. Runs are returned in document order.
   */
  private selectionRuns(range: AnchorRange, entries: readonly RenderEntry[]): SelectionRun[] {
    const runs: SelectionRun[] = [];
    const firstPara = Math.max(0, range.start.paragraphIndex);
    const lastPara = Math.min(range.end.paragraphIndex, this.cached.length - 1, entries.length - 1);
    for (let p = firstPara; p <= lastPara; p++) {
      const charCount = this.cached[p].chars.length;
      const lo = p === range.start.paragraphIndex ? Math.max(0, range.start.charIndex) : 0;
      const hi =
        p === range.end.paragraphIndex ? Math.min(range.end.charIndex, charCount) : charCount;
      const bp = entries[p].breakPoints;
      let c = lo;
      for (let line = findInParaLine(bp, lo); line <= bp.length && c < hi; line++) {
        const runEnd = Math.min(hi, lineEndChar(bp, line, charCount));
        if (runEnd <= c) continue;
        runs.push({
          paragraph: p,
          inParaLine: line,
          lineStart: lineStartChar(bp, line),
          charStart: c,
          charEnd: runEnd,
        });
        c = runEnd;
      }
    }
    return runs;
  }

  private selectionRectsInNormal(range: AnchorRange): AnchorRect[] {
    this.ensureNormal();
    const { pageRanges, paraLineStarts, metrics } = this.normal as NormalCache;

    const rects: AnchorRect[] = [];
    let pageIdx = 0;
    let page: PageResult | null = null;

    for (const run of this.selectionRuns(range, this.entries)) {
      const globalLine = paraLineStarts[run.paragraph] + run.inParaLine;
      while (pageIdx < pageRanges.length && globalLine >= pageRanges[pageIdx].end) {
        pageIdx++;
        page = null;
      }
      if (pageIdx >= pageRanges.length) break;
      const { start } = pageRanges[pageIdx];
      if (globalLine < start) continue;
      page ??= this.buildNormalPage(pageIdx);
      const slot = page.slots[globalLine - start];
      if (!slot) continue;
      rects.push(
        this.makeRunRect(run, slot, metrics[globalLine]?.pitch ?? this.linePitch(), {
          spreadIndex: Math.floor(pageIdx / 2),
          pageIndex: pageIdx,
          lineIndex: globalLine,
          side: pageIdx % 2 === 0 ? 'right' : 'left',
        }),
      );
    }
    return rects;
  }

  private selectionRectsInExclusion(range: AnchorRange): AnchorRect[] {
    this.ensureExclusion();
    const { entries, paraLineStarts, metrics, spreadLayouts } = this.excl as ExclusionCache;
    const rects: AnchorRect[] = [];
    let s = 0;

    for (const run of this.selectionRuns(range, entries)) {
      const globalLine = paraLineStarts[run.paragraph] + run.inParaLine;
      while (
        s < spreadLayouts.length &&
        globalLine >= spreadLayouts[s].lineStart + spreadLayouts[s].slotCount
      ) {
        s++;
      }
      if (s >= spreadLayouts.length) break;
      const sl = spreadLayouts[s];
      if (globalLine < sl.lineStart) continue;
      const offset = globalLine - sl.lineStart;
      const onRight = offset < sl.rightSlotCount;
      const slot = onRight ? sl.rightSlots[offset] : sl.leftSlots[offset - sl.rightSlotCount];
      if (!slot) continue;
      rects.push(
        this.makeRunRect(run, slot, metrics[globalLine]?.pitch ?? this.linePitch(), {
          spreadIndex: s,
          pageIndex: s * 2 + (onRight ? 0 : 1),
          lineIndex: globalLine,
          side: onRight ? 'right' : 'left',
        }),
      );
    }
    return rects;
  }

  /** Builds the rectangle covering one line-local run of selected characters. */
  private makeRunRect(
    run: SelectionRun,
    slot: ColumnSlot,
    colPitch: number,
    loc: AnchorLocation,
  ): AnchorRect {
    const advances = this.layoutAdvancesOf(run.paragraph);
    let yOffset = 0;
    for (let i = run.lineStart; i < run.charStart; i++) yOffset += advances[i];
    let height = 0;
    for (let i = run.charStart; i < run.charEnd; i++) height += advances[i];
    const rightEdge = loc.side === 'right' ? this.contentWidth() - slot.xPos : -slot.xPos;
    return {
      spreadIndex: loc.spreadIndex,
      pageIndex: loc.pageIndex,
      side: loc.side,
      x: rightEdge - colPitch,
      y: slot.yStart + yOffset,
      width: colPitch,
      height,
    };
  }

  private anchorAtCoordInNormal(spreadIdx: number, x: number, y: number): InChapterAnchor | null {
    this.ensureNormal();
    const side: 'right' | 'left' = x >= 0 ? 'right' : 'left';
    const pageIdx = spreadIdx * 2 + (side === 'right' ? 0 : 1);
    const { pages, paraLineStarts, metrics } = this.normal as NormalCache;
    if (pageIdx < 0 || pageIdx >= pages.length) return null;
    const slices = pages[pageIdx];
    const first = slices?.[0];
    if (!first) return null;
    const pageStart = paraLineStarts[first.paragraphIndex] + first.lineStart;
    const page = this.buildNormalPage(pageIdx);
    const slots = page.slots;
    const contentWidth = this.contentWidth();

    const slotIdx = this.findSlotAt(slots, side, x, y, contentWidth, (i) =>
      metrics[pageStart + i] ? metrics[pageStart + i].pitch : this.linePitch(),
    );
    if (slotIdx < 0) return null;

    let lineOnPage = 0;
    for (const slice of slices) {
      const linesInSlice = slice.lineEnd - slice.lineStart;
      if (slotIdx < lineOnPage + linesInSlice) {
        const paragraph = slice.paragraphIndex;
        const inParaLine = slice.lineStart + (slotIdx - lineOnPage);
        const bp = this.entries[paragraph].breakPoints;
        return this.charFromY(paragraph, inParaLine, bp, y - slots[slotIdx].yStart);
      }
      lineOnPage += linesInSlice;
    }
    return null;
  }

  private anchorAtCoordInExclusion(
    spreadIdx: number,
    x: number,
    y: number,
  ): InChapterAnchor | null {
    this.ensureExclusion();
    const { entries, lineParaIndex, paraLineStarts, metrics, spreadLayouts } = this
      .excl as ExclusionCache;
    const sl = spreadLayouts[spreadIdx];
    if (!sl) return null;
    const side: 'right' | 'left' = x >= 0 ? 'right' : 'left';
    const slots = side === 'right' ? sl.rightSlots : sl.leftSlots;
    const contentWidth = this.contentWidth();
    const slotIdx = this.findSlotAt(slots, side, x, y, contentWidth, (i) =>
      metrics[sl.lineStart + (side === 'right' ? i : sl.rightSlotCount + i)]
        ? metrics[sl.lineStart + (side === 'right' ? i : sl.rightSlotCount + i)].pitch
        : this.linePitch(),
    );
    if (slotIdx < 0) return null;

    const globalLine = sl.lineStart + (side === 'right' ? slotIdx : sl.rightSlotCount + slotIdx);
    if (globalLine < 0 || globalLine >= lineParaIndex.length) return null;
    const paragraph = lineParaIndex[globalLine];
    const inParaLine = globalLine - paraLineStarts[paragraph];
    const bp = entries[paragraph].breakPoints;
    return this.charFromY(paragraph, inParaLine, bp, y - slots[slotIdx].yStart);
  }

  private findSlotAt(
    slots: readonly ColumnSlot[],
    side: 'right' | 'left',
    x: number,
    y: number,
    contentWidth: number,
    pitchAt: (slotIdx: number) => number,
  ): number {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (y < slot.yStart || y >= slot.yStart + slot.height) continue;
      const colPitch = pitchAt(i);
      const right = side === 'right' ? contentWidth - slot.xPos : -slot.xPos;
      const left = right - colPitch;
      if (x >= left && x < right) return i;
    }
    return -1;
  }

  private charFromY(
    paragraph: number,
    inParaLine: number,
    breakPoints: Uint32Array,
    yInLine: number,
  ): InChapterAnchor {
    const advances = this.layoutAdvancesOf(paragraph);
    const lineStart = lineStartChar(breakPoints, inParaLine);
    const lineEnd = lineEndChar(breakPoints, inParaLine, advances.length);
    if (yInLine <= 0) return { paragraphIndex: paragraph, charIndex: lineStart };
    let acc = 0;
    for (let i = lineStart; i < lineEnd; i++) {
      const half = advances[i] / 2;
      if (acc + half >= yInLine) return { paragraphIndex: paragraph, charIndex: i };
      acc += advances[i];
    }
    return { paragraphIndex: paragraph, charIndex: lineEnd };
  }
}

/**
 * Rejects patterns with common catastrophic-backtracking structures.
 *
 * Two structures are refused:
 * - a quantifier applied to a group that itself contains a quantifier or an
 *   alternation (`(a+)+`, `(a|aa)+`);
 * - two quantified terms that backtracking can reach as neighbours, because
 *   the input can then be split between them in exponentially many ways. They
 *   are neighbours when nothing separates them (`a*a*b`, `(a*)(a*)b`) or when
 *   only optional terms do (`a*b?a*c`).
 *
 * A term that always consumes at least one character separates the quantifiers
 * around it into independent search spans, so `\d+年\d+月` is accepted. So is
 * any pattern with a single quantified term such as `第\d+章`, and alternatives
 * are scanned separately, so `あ*|い*` is accepted as well.
 */
function assertSafeRegexSearch(source: string): void {
  if (source.length > MAX_REGEX_SEARCH_PATTERN_LENGTH) {
    throw new MejiroError(
      'regex-unsafe',
      `Regex search pattern exceeds ${MAX_REGEX_SEARCH_PATTERN_LENGTH} characters`,
    );
  }

  const groups: RegexGroupState[] = [newRegexGroupState()];
  let inCharacterClass = false;
  let escaped = false;
  // The term scanned most recently, held back until the next character shows
  // whether a quantifier applies to it.
  let term: RegexTerm | undefined;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const group = groups.at(-1) as RegexGroupState;

    // A character class is a single term; its contents never form terms.
    if (inCharacterClass) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === ']') inCharacterClass = false;
      continue;
    }
    if (escaped) {
      escaped = false;
      // `\b` / `\B` are zero-width word boundaries, so they separate nothing.
      if (term && (char === 'b' || char === 'B')) term.consumes = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      commitRegexTerm(group, term);
      term = consumingRegexTerm();
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      commitRegexTerm(group, term);
      term = consumingRegexTerm();
      continue;
    }
    if (char === '(') {
      commitRegexTerm(group, term);
      term = undefined;
      groups.push(newRegexGroupState());
      i += regexGroupPrefixLength(source, i);
      continue;
    }
    if (char === ')') {
      // A stray `)` is left for the RegExp constructor to reject.
      if (groups.length === 1) continue;
      commitRegexTerm(group, term);
      endRegexAlternative(group);
      groups.pop();
      const parent = groups.at(-1) as RegexGroupState;
      parent.hasAlternation ||= group.hasAlternation;
      parent.hasQuantifiedTerm ||= group.hasQuantifiedTerm;
      // An unquantified group is spliced into the enclosing concatenation, so
      // it carries its own edges outwards: `(a*)(a*)b` behaves like `a*a*b`.
      term = {
        startsQuantified: group.anyStartsQuantified,
        endsQuantified: group.anyQuantifierOpen,
        consumes: group.allConsume,
        group,
      };
      continue;
    }
    if (char === '|') {
      commitRegexTerm(group, term);
      term = undefined;
      group.hasAlternation = true;
      endRegexAlternative(group);
      continue;
    }
    const quantifier = regexQuantifierEnd(source, i);
    if (quantifier > i) {
      if (term) {
        if (term.group?.hasQuantifiedTerm || term.group?.hasAlternation) {
          throw new MejiroError(
            'regex-unsafe',
            'Unsafe regex search pattern: quantified complex group',
          );
        }
        group.hasQuantifiedTerm = true;
        // A quantified term may match nothing, so it never separates.
        term = { startsQuantified: true, endsQuantified: true, consumes: false };
      }
      i = quantifier - 1;
      continue;
    }
    commitRegexTerm(group, term);
    // `^` and `$` are zero-width anchors, so they separate nothing.
    term = { ...consumingRegexTerm(), consumes: char !== '^' && char !== '$' };
  }

  commitRegexTerm(groups.at(-1) as RegexGroupState, term);
}

function regexQuantifierEnd(source: string, index: number): number {
  const char = source[index];
  if (char === '*' || char === '+' || char === '?') return lazyQuantifierEnd(source, index + 1);
  if (char !== '{') return index;
  const match = /^\{\d+(?:,\d*)?\}/u.exec(source.slice(index));
  return match ? lazyQuantifierEnd(source, index + match[0].length) : index;
}

/**
 * Skips a `?` directly following a quantifier: it only makes the quantifier
 * lazy, so `a*?` stays a single quantified term.
 */
function lazyQuantifierEnd(source: string, end: number): number {
  return source[end] === '?' ? end + 1 : end;
}
