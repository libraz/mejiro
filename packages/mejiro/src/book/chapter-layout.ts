import type { InlineAnnotation } from '../browser/types.js';
import type { ColumnSlot, SpreadExclusionResult } from '../exclusion.js';
import { SpreadExclusionEngine } from '../exclusion.js';
import { computeBreaks } from '../layout.js';
import type { PageSlice } from '../paginate.js';
import { paginate } from '../paginate.js';
import type { HeadingStyle, MeasureOptions } from '../render/measures.js';
import {
  adjustExclusionSlots,
  buildColumnSlots,
  buildLineMetrics,
  buildParagraphMeasures,
  findPhysicalColumn,
  getImageXOffset,
  packPageLines,
} from '../render/measures.js';
import { buildRenderPage } from '../render/page.js';
import type { LineMetric, RenderEntry, RenderLine, RenderParagraph } from '../render/types.js';
import { preprocessRuby, type RubyAnnotation } from '../ruby.js';
import { preprocessTcy, type TcyAnnotation } from '../tcy.js';
import type { AnchorLocation, AnchorRange, AnchorRect, InChapterAnchor } from './anchor.js';
import type { FindTextOptions, SearchMatch } from './search.js';
import type { ChapterLayoutSnapshot, LayoutRubySnapshot, ParagraphSnapshot } from './snapshot.js';
import type {
  BookImage,
  PageLine,
  PageResult,
  PageSize,
  ParagraphKind,
  SpreadResult,
} from './types.js';

/** @internal Cached per-paragraph data for fast re-layout. */
export interface CachedParagraph {
  text: Uint32Array;
  advances: Float32Array;
  chars: string[];
  inlineAnnotations: readonly InlineAnnotation[];
  layoutRubyAnnotations?: RubyAnnotation[];
  /**
   * Tate-chu-yoko spans with their box width already resolved against this
   * paragraph's font size. Kept alongside the advances so every re-break
   * (resize, re-measure, image exclusion) reserves the same one em per span
   * and refuses to split it, exactly as the initial layout did.
   */
  layoutTcyAnnotations?: TcyAnnotation[];
  isHeading?: boolean;
  headingLevel?: number;
  /**
   * Structural classification of the source paragraph, kept here so a re-break
   * (resize, re-measure, image exclusion) can put it back on the render entry.
   */
  kind?: ParagraphKind;
}

/** @internal Layout configuration snapshot. */
export interface LayoutConfig {
  fontSize: number;
  lineSpacing: number;
  headingStyles?: Record<number, HeadingStyle>;
  headingScale: number;
  mode: 'strict' | 'loose';
  enableHanging: boolean;
}

// ── Internal cache types ──

interface NormalCache {
  pages: PageSlice[][];
  paraLineStarts: number[];
  metrics: LineMetric[];
}

interface ExclusionCache {
  lines: PageLine[];
  lineParaIndex: number[];
  entries: RenderEntry[];
  /** Global index of each paragraph's first line, parallel to `entries`. */
  paraLineStarts: number[];
  metrics: LineMetric[];
  spreadLayouts: SpreadLayoutInfo[];
  totalPages: number;
}

interface SpreadLayoutInfo {
  lineStart: number;
  slotCount: number;
  rightSlotCount: number;
  rightSlots: ColumnSlot[];
  leftSlots: ColumnSlot[];
  hasRightImages: boolean;
  hasLeftImages: boolean;
}

interface SpreadLayoutBuildResult {
  layouts: SpreadLayoutInfo[];
  lineWidths: Float32Array;
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

/**
 * Spreads of line widths computed past the end of the chapter, so text pushed
 * out of image-shortened columns still finds a width to reflow into.
 */
const SPREAD_REFLOW_MARGIN = 10;

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
    throw new Error('Unsafe regex search pattern: adjacent quantifiers');
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
 * Rejects a {@link ChapterLayout.resize} dimension that cannot produce a
 * consistent layout. `undefined` means "leave this dimension alone".
 */
function assertResizeDimension(name: string, value: number | undefined, positive: boolean): void {
  if (value == null) return;
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    const requirement = positive ? 'positive' : 'non-negative';
    throw new RangeError(`ChapterLayout.resize: ${name} must be a ${requirement} finite number`);
  }
}

/**
 * Returns the flags {@link ChapterLayout.findText} compiles a query with.
 *
 * Matching is always global and Unicode-aware. A `RegExp` query keeps its own
 * `i` / `m` / `s` flags, and its `v` mode instead of `u`; an explicit
 * `caseSensitive` option overrides the pattern's own `i` flag. A string query
 * is case-insensitive unless `caseSensitive` is `true`.
 */
function searchFlags(query: string | RegExp, caseSensitive?: boolean): string {
  const pattern = query instanceof RegExp ? query : undefined;
  const ignoreCase = caseSensitive != null ? !caseSensitive : (pattern?.ignoreCase ?? true);
  return [
    'g',
    ignoreCase ? 'i' : '',
    pattern?.multiline ? 'm' : '',
    pattern?.dotAll ? 's' : '',
    pattern?.flags.includes('v') ? 'v' : 'u',
  ].join('');
}

function emptyPageResult(): PageResult {
  return { page: { paragraphs: [] }, lines: [], slots: [], hasImages: false };
}

/**
 * Builds the render paragraph for a run of exclusion-mode lines, mirroring the
 * heading and kind resolution {@link buildRenderPage} applies in normal mode.
 */
function exclusionParagraph(entry: RenderEntry, lines: RenderLine[]): RenderParagraph {
  const headingLevel = entry.headingLevel;
  return {
    lines,
    isHeading: headingLevel != null || entry.isHeading === true,
    headingLevel,
    kind: entry.kind,
  };
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
    range.start.paragraph - range.end.paragraph || range.start.charIndex - range.end.charIndex;
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
function buildJsToCpOffsetMap(chars: string[], jsLength: number): Uint32Array {
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
  if (annotation.kind === 'ruby' && annotation.jukugoSplitPoints) {
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

function sameBreakPoints(a: readonly RenderEntry[], b: readonly RenderEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const abp = a[i].breakPoints;
    const bbp = b[i].breakPoints;
    if (abp.length !== bbp.length) return false;
    for (let j = 0; j < abp.length; j++) {
      if (abp[j] !== bbp[j]) return false;
    }
  }
  return true;
}

/**
 * Manages the layout of a single chapter with pagination, heading support,
 * and image exclusion. Created by {@link MejiroBook.layoutChapter}.
 *
 * Supports lazy computation: layout is only computed when data is first requested
 * via {@link getSpread} or {@link getPage}, and is cached until invalidated by
 * {@link resize}, {@link setImages}, or {@link clearImages}.
 */
export class ChapterLayout {
  private cached: CachedParagraph[];
  private entries: RenderEntry[];
  /**
   * @internal Per paragraph: the advances `entries[i].breakPoints` were
   * computed from. Filled on re-break and lazily for externally supplied
   * entries; see {@link ChapterLayout.layoutAdvancesOf}.
   */
  private layoutAdvances: (Float32Array | undefined)[] = [];
  private config: LayoutConfig;
  private size: Required<PageSize>;
  private images = new Map<number, BookImage[]>();

  private normal: NormalCache | null = null;
  private excl: ExclusionCache | null = null;

  /**
   * @internal Cached `SpreadExclusionEngine.compute()` results per spread.
   *
   * The spread-local exclusion compute is independent across spreads, so we
   * can keep results for unchanged spreads when `setImages` only modifies a
   * single spread. Invalidated wholesale on font / size / page-size changes.
   */
  private spreadExclusionCache = new Map<number, SpreadExclusionResult>();

  /** @internal Created by MejiroBook — do not construct directly. */
  constructor(
    cached: CachedParagraph[],
    entries: RenderEntry[],
    config: LayoutConfig,
    size: Required<PageSize>,
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
  }

  /** Total number of pages in the current layout. */
  get totalPages(): number {
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
   * @internal Applies a fresh layout config snapshot from {@link MejiroBook.setOptions}.
   *
   * Updates the fields in place, recomputes line breaks when `mode` /
   * `enableHanging` change, and invalidates the rendered caches so the next
   * `getSpread` / `getPage` call reflects the new options.
   */
  applyConfig(config: LayoutConfig, options: { rebreak?: boolean } = {}): void {
    const breakSensitiveChanged =
      config.mode !== this.config.mode ||
      config.enableHanging !== this.config.enableHanging ||
      config.fontSize !== this.config.fontSize;
    this.config = { ...config };
    if (breakSensitiveChanged && options.rebreak !== false) this.recomputeBreaks();
    this.invalidate();
  }

  /** @internal Exposes cached paragraphs so {@link MejiroBook} can re-measure on font change. */
  getCachedParagraphs(): CachedParagraph[] {
    return this.cached;
  }

  /**
   * @internal Recomputes line breaks after {@link MejiroBook} has refreshed
   * each cached paragraph's `advances` / `layoutRubyAnnotations`. Distinct
   * from {@link applyConfig} so a font change re-breaks once, not twice.
   */
  recomputeAfterMeasurement(): void {
    this.recomputeBreaks();
    this.invalidate();
  }

  /**
   * Updates page geometry and/or line spacing.
   * Re-computes line breaks if `lineWidth` changes.
   *
   * The update is applied as a unit: dimensions are validated and the new line
   * breaks are computed before any visible state changes, so a rejected size
   * leaves the layout on its previous geometry, entries and caches.
   *
   * @param size - Partial page size overrides plus optional `lineSpacing`.
   * @throws RangeError If `lineWidth` / `pageWidth` / `lineSpacing` is not a
   *   positive finite number, or a padding is not a non-negative finite number.
   */
  resize(size: Partial<PageSize> & { lineSpacing?: number }): void {
    assertResizeDimension('lineWidth', size.lineWidth, true);
    assertResizeDimension('pageWidth', size.pageWidth, true);
    assertResizeDimension('lineSpacing', size.lineSpacing, true);
    assertResizeDimension('pagePaddingX', size.pagePaddingX, false);
    assertResizeDimension('pagePaddingY', size.pagePaddingY, false);

    const nextLineWidth = size.lineWidth ?? this.size.lineWidth;
    // Break with the new width first: if it throws, nothing has been committed.
    const rebroken =
      nextLineWidth !== this.size.lineWidth ? this.breakEntries(nextLineWidth) : null;

    this.size.lineWidth = nextLineWidth;
    if (size.pageWidth != null) this.size.pageWidth = size.pageWidth;
    if (size.pagePaddingX != null) this.size.pagePaddingX = size.pagePaddingX;
    if (size.pagePaddingY != null) this.size.pagePaddingY = size.pagePaddingY;
    if (size.lineSpacing != null) this.config.lineSpacing = size.lineSpacing;
    if (rebroken) this.commitBreaks(rebroken);
    this.invalidate();
  }

  /**
   * Sets image exclusions for a spread. Passing an empty array removes images for that spread.
   *
   * @param spreadIndex - Zero-based spread index.
   * @param images - Image rectangles relative to the right page's top-left corner.
   */
  setImages(spreadIndex: number, images: BookImage[]): void {
    if (images.length === 0) {
      this.images.delete(spreadIndex);
    } else {
      this.images.set(spreadIndex, [...images]);
    }
    // Invalidate only the changed spread's cached exclusion result — other
    // spreads' engine output is reused on the next `computeExclusion` pass.
    this.spreadExclusionCache.delete(spreadIndex);
    this.excl = null;
  }

  /** Removes all image exclusions. */
  clearImages(): void {
    this.images.clear();
    this.spreadExclusionCache.clear();
    this.excl = null;
  }

  /**
   * Sets or clears images for a spread and returns the updated spread result.
   * Combines {@link setImages} / {@link clearImages} with {@link getSpread}.
   *
   * @param spreadIndex - Zero-based spread index.
   * @param images - Image rectangles, or `undefined` / empty array to clear this spread.
   * @returns Updated spread result for the given spread.
   */
  syncImages(spreadIndex: number, images?: BookImage[]): SpreadResult {
    if (images && images.length > 0) {
      this.setImages(spreadIndex, images);
    } else {
      this.setImages(spreadIndex, []);
    }
    return this.getSpread(spreadIndex);
  }

  /**
   * Returns layout data for a two-page spread.
   *
   * @param spreadIndex - Zero-based spread index.
   * @returns Spread result containing right and left page data.
   */
  getSpread(spreadIndex: number): SpreadResult {
    const tp = this.totalPages;
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
    const spread = this.getSpread(Math.floor(pageIndex / 2));
    return pageIndex % 2 === 0 ? spread.right : spread.left;
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
    const { paragraph, charIndex } = anchor;
    if (!this.isAnchorInRange(paragraph, charIndex)) return null;

    if (this.images.size > 0) {
      return this.locateAnchorInExclusion(paragraph, charIndex);
    }
    return this.locateAnchorInNormal(paragraph, charIndex);
  }

  /**
   * Returns the in-chapter anchor for the first character of a spread.
   *
   * Useful for converting a spread index back into a stable reading anchor
   * that survives reflow.
   *
   * @param spreadIndex - Zero-based spread index.
   * @param side - Page side. `'right'` (default) is the first page in
   *   vertical-rl reading order; `'left'` is the second page.
   * @returns An in-chapter anchor pointing at the first character of the
   *   chosen page, or `null` if the spread / page does not exist.
   */
  anchorAt(spreadIndex: number, side: 'right' | 'left' = 'right'): InChapterAnchor | null {
    if (this.images.size > 0) {
      return this.anchorAtInExclusion(spreadIndex, side);
    }
    return this.anchorAtInNormal(spreadIndex * 2 + (side === 'right' ? 0 : 1));
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
    if (!this.isAnchorInRange(anchor.paragraph, anchor.charIndex)) return null;
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
   * @param spreadIdx - Zero-based spread index.
   * @param x - Spread-local x in pixels.
   * @param y - Spread-local y in pixels.
   * @returns Anchor at the coordinate, or `null` if outside any column.
   */
  anchorAtCoord(spreadIdx: number, x: number, y: number): InChapterAnchor | null {
    if (this.images.size > 0) return this.anchorAtCoordInExclusion(spreadIdx, x, y);
    return this.anchorAtCoordInNormal(spreadIdx, x, y);
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
   * The snapshot bakes in the current config (font / size / line spacing /
   * page geometry); restoring with a different config requires either
   * passing the snapshot to a fresh `MejiroBook` whose options match, or
   * calling `setOptions` afterwards (which re-measures from scratch).
   */
  snapshot(): ChapterLayoutSnapshot {
    const paragraphs: ParagraphSnapshot[] = this.cached.map((para, i) => {
      const entry = this.entries[i];
      const snap: ParagraphSnapshot = {
        text: para.chars.join(''),
        advances: Array.from(para.advances),
        breakPoints: Array.from(entry.breakPoints),
        inlineAnnotations: para.inlineAnnotations.map(cloneInlineAnnotation),
      };
      if (para.isHeading === true) snap.isHeading = true;
      if (para.headingLevel != null) snap.headingLevel = para.headingLevel;
      if (para.kind != null && para.kind !== 'body') snap.kind = para.kind;
      if (para.layoutRubyAnnotations) {
        snap.layoutRubyAnnotations = para.layoutRubyAnnotations.map((r): LayoutRubySnapshot => {
          const out: LayoutRubySnapshot = {
            startIndex: r.startIndex,
            endIndex: r.endIndex,
            rubyText: Array.from(r.rubyText),
            rubyAdvances: Array.from(r.rubyAdvances),
          };
          if (r.type) out.type = r.type;
          if (r.jukugoSplitPoints) out.jukugoSplitPoints = [...r.jukugoSplitPoints];
          return out;
        });
      }
      if (para.layoutTcyAnnotations) {
        snap.layoutTcyAnnotations = para.layoutTcyAnnotations.map((t) => ({ ...t }));
      }
      return snap;
    });
    const images =
      this.images.size > 0
        ? [...this.images.entries()].map(([spreadIndex, spreadImages]) => ({
            spreadIndex,
            images: spreadImages.map((image) => ({ ...image })),
          }))
        : undefined;

    return {
      version: 1,
      config: {
        fontSize: this.config.fontSize,
        lineSpacing: this.config.lineSpacing,
        headingScale: this.config.headingScale,
        mode: this.config.mode,
        enableHanging: this.config.enableHanging,
        ...(this.config.headingStyles
          ? { headingStyles: cloneHeadingStyles(this.config.headingStyles) }
          : {}),
      },
      size: { ...this.size },
      paragraphs,
      ...(images ? { images } : {}),
    };
  }

  /**
   * Searches the chapter text for matches of `query`, returning a list of
   * matches resolved to anchor + layout location.
   *
   * Search is paragraph-local — matches do not span paragraph boundaries.
   * Codepoint offsets (`charStart` / `charEnd`) are compatible with
   * {@link InChapterAnchor.charIndex} and survive reflow.
   *
   * @param query - Literal substring (default), a regex source string (when
   *   {@link FindTextOptions.regex} is `true`), or a `RegExp` — whose `source`
   *   takes the regex path whatever {@link FindTextOptions.regex} says. A
   *   `RegExp` keeps its own `i` / `m` / `s` flags unless
   *   {@link FindTextOptions.caseSensitive} is set, which then wins; `g` and
   *   Unicode mode are always applied and `y` is ignored.
   * @param options - Search options.
   * @returns Matches in document order. Empty array when `query` is empty
   *   or no matches are found.
   * @throws If the pattern is invalid or exceeds the regex safety limits. To
   *   keep matching time bounded, the guard also refuses patterns that can
   *   backtrack catastrophically: a quantified group that itself contains a
   *   quantifier or an alternation, and two quantified terms in the same
   *   concatenation with nothing between them that always consumes input
   *   (`a*a*b`, `a*b?a*c`). A term that always consumes anchors the quantifiers
   *   on either side of it, so `\d+年\d+月` is accepted.
   */
  findText(query: string | RegExp, options: FindTextOptions = {}): SearchMatch[] {
    const { regex = false, caseSensitive, maxResults } = options;
    const isRegExp = query instanceof RegExp;
    if (!(isRegExp || query)) return [];
    const limit = maxResults != null && maxResults > 0 ? maxResults : Number.POSITIVE_INFINITY;

    const asRegex = isRegExp || regex;
    const source = isRegExp ? query.source : query;
    if (asRegex) assertSafeRegexSearch(source);
    const pattern = new RegExp(
      asRegex ? source : source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      searchFlags(query, caseSensitive),
    );

    const results: SearchMatch[] = [];
    let regexTextLength = 0;
    for (let pIdx = 0; pIdx < this.cached.length; pIdx++) {
      const chars = this.cached[pIdx].chars;
      if (chars.length === 0) continue;
      const joined = chars.join('');
      if (asRegex) {
        regexTextLength += joined.length;
        if (regexTextLength > MAX_REGEX_SEARCH_TEXT_LENGTH) {
          throw new RangeError(
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
        const loc = this.locateAnchor({ paragraph: pIdx, charIndex: startCp });
        if (!loc) continue;
        results.push({
          paragraph: pIdx,
          charStart: startCp,
          charEnd: endCp,
          match: matchText,
          spreadIdx: loc.spreadIdx,
          pageIdx: loc.pageIdx,
          lineIdx: loc.lineIdx,
          side: loc.side,
        });
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  // ── Private helpers ──

  private contentWidth(): number {
    return this.size.pageWidth - this.size.pagePaddingX * 2;
  }

  private resolveScale(level?: number): number {
    if (level == null) return 1;
    return this.config.headingStyles?.[level]?.scale ?? this.config.headingScale;
  }

  private paragraphScale(headingLevel?: number, isHeading?: boolean): number {
    if (headingLevel != null) return this.resolveScale(headingLevel);
    return isHeading === true ? this.config.headingScale : 1;
  }

  private linePitch(): number {
    return this.config.fontSize * this.config.lineSpacing;
  }

  private measureOpts(): MeasureOptions {
    return {
      fontSize: this.config.fontSize,
      lineHeight: this.config.lineSpacing,
      headingStyles: this.config.headingStyles,
      headingScale: this.config.headingScale,
    };
  }

  private invalidate(): void {
    this.normal = null;
    this.excl = null;
    // Anything that triggers invalidate() (resize / applyConfig / re-measure)
    // changes inputs to the per-spread exclusion engine (line pitch, line
    // width, font size), so the spread-local cache must be cleared too. The
    // setImages path bypasses this and invalidates only the changed spread.
    this.spreadExclusionCache.clear();
  }

  private recomputeBreaks(): void {
    this.commitBreaks(this.breakEntries(this.size.lineWidth));
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
        mode: this.config.mode,
        enableHanging: this.config.enableHanging,
        rubyAnnotations: para.layoutRubyAnnotations,
        tcyAnnotations: para.layoutTcyAnnotations,
      });
      entries.push({
        chars: para.chars,
        breakPoints: br.breakPoints,
        inlineAnnotations: para.inlineAnnotations,
        isHeading: para.isHeading,
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

    this.normal = { pages, paraLineStarts, metrics };
  }

  private getNormalSpread(spreadIndex: number, totalPages: number): SpreadResult {
    this.ensureNormal();
    return {
      right: this.buildNormalPage(spreadIndex * 2),
      left: this.buildNormalPage(spreadIndex * 2 + 1),
      totalPages,
    };
  }

  private buildNormalPage(pageIndex: number): PageResult {
    const { pages, paraLineStarts, metrics } = this.normal as NormalCache;
    if (pageIndex >= pages.length) return emptyPageResult();

    const slices = pages[pageIndex];
    if (!slices || slices.length === 0) return emptyPageResult();

    const page = buildRenderPage(slices, this.entries);
    const { fontSize } = this.config;

    const lines: PageLine[] = [];
    for (const para of page.paragraphs) {
      const fs = Math.round(fontSize * this.paragraphScale(para.headingLevel, para.isHeading));
      for (const line of para.lines) {
        lines.push({ segments: line.segments, headingLevel: para.headingLevel, fontSize: fs });
      }
    }

    const firstSlice = slices[0];
    const startLine = paraLineStarts[firstSlice.paragraphIndex] + firstSlice.lineStart;
    const slots = buildColumnSlots(metrics, startLine, lines.length, this.size.lineWidth);

    return { page, lines, slots, hasImages: false };
  }

  // ── Exclusion mode ──

  private ensureExclusion(): void {
    if (this.excl) return;
    this.computeExclusion();
  }

  private computeExclusion(): void {
    const { fontSize } = this.config;
    const lp = this.linePitch();
    const cw = this.contentWidth();
    const normalLinesPerPage = Math.floor(cw / lp);
    const normalLinesPerSpread = normalLinesPerPage * 2;
    const opts = this.measureOpts();

    // Pre-reflow metrics for image coordinate adjustment
    const preMetrics = buildLineMetrics(this.entries, opts);
    const preMeasures = buildParagraphMeasures(this.entries, opts);
    const prePages = paginate(cw, preMeasures);
    const preParaLineStarts: number[] = [];
    let preTotal = 0;
    for (const entry of this.entries) {
      preParaLineStarts.push(preTotal);
      preTotal += entry.breakPoints.length + 1;
    }
    const preSpreadStarts = prePages
      .filter((_, pageIndex) => pageIndex % 2 === 0)
      .map((slices) => {
        const first = slices[0];
        return first ? preParaLineStarts[first.paragraphIndex] + first.lineStart : preTotal;
      });

    // Compute exclusion for each spread that has images
    const spreadEngine = new SpreadExclusionEngine({
      pageWidth: this.size.pageWidth,
      pagePaddingX: this.size.pagePaddingX,
      pagePaddingY: this.size.pagePaddingY,
      lineWidth: this.size.lineWidth,
      linePitch: lp,
    });

    const exclBySpread = new Map<number, SpreadExclusionResult>();
    for (const [si, imgs] of this.images) {
      if (imgs.length === 0) continue;
      const cached = this.spreadExclusionCache.get(si);
      if (cached) {
        exclBySpread.set(si, cached);
        continue;
      }
      spreadEngine.clearImages();
      const spreadStartLine = preSpreadStarts[si] ?? si * normalLinesPerSpread;
      for (const img of imgs) {
        const margin = img.margin ?? fontSize;
        const crossesSpine = img.x < 0 && img.x + img.w > 0;

        if (crossesSpine) {
          // Split straddling images at the spine so each page gets the
          // correct heading offset compensation independently.
          const rightW = img.x + img.w; // portion on right page (x >= 0)
          if (rightW > 0) {
            const rCenter = rightW / 2;
            const fromRight = this.size.pageWidth - this.size.pagePaddingX - rCenter;
            const col = findPhysicalColumn(preMetrics.offsets, spreadStartLine, fromRight, lp);
            const rAdj = getImageXOffset(preMetrics.offsets, spreadStartLine, col);
            spreadEngine.addImage({
              x: rAdj,
              y: img.y,
              w: rightW,
              h: img.h,
              inlineMargin: margin,
            });
          }
          const leftW = -img.x; // portion on left page (x < 0)
          if (leftW > 0) {
            const lCenter = img.x + leftW / 2;
            const fromRight = -lCenter;
            const col = findPhysicalColumn(preMetrics.offsets, spreadStartLine, fromRight, lp);
            const lAdj = getImageXOffset(preMetrics.offsets, spreadStartLine, col);
            spreadEngine.addImage({
              x: img.x + lAdj,
              y: img.y,
              w: leftW,
              h: img.h,
              inlineMargin: margin,
            });
          }
        } else {
          const center = img.x + img.w / 2;
          const onRight = center > 0 && center < this.size.pageWidth;
          const onLeft = center < 0;
          let xAdj = 0;
          if (onRight) {
            const fromRight = this.size.pageWidth - this.size.pagePaddingX - center;
            const col = findPhysicalColumn(preMetrics.offsets, spreadStartLine, fromRight, lp);
            xAdj = getImageXOffset(preMetrics.offsets, spreadStartLine, col);
          } else if (onLeft) {
            const fromRight = -center;
            const col = findPhysicalColumn(preMetrics.offsets, spreadStartLine, fromRight, lp);
            xAdj = getImageXOffset(preMetrics.offsets, spreadStartLine, col);
          }
          spreadEngine.addImage({
            x: img.x + xAdj,
            y: img.y,
            w: img.w,
            h: img.h,
            inlineMargin: margin,
          });
        }
      }
      const result = spreadEngine.compute();
      exclBySpread.set(si, result);
      this.spreadExclusionCache.set(si, result);
    }

    let entries = this.entries;
    for (let attempt = 0; attempt < 6; attempt++) {
      // Reflow can only lengthen the chapter by shortening columns, so the
      // widths are computed for the current line count plus a margin — sized
      // in lines, never in characters. Each attempt re-derives the margin from
      // the lines the previous attempt produced, so repeated growth converges.
      const actualLines = entries.reduce((sum, e) => sum + e.breakPoints.length + 1, 0);
      const lineLimit =
        actualLines +
        Math.max(normalLinesPerSpread * SPREAD_REFLOW_MARGIN, Math.ceil(actualLines / 2));
      const candidateMetrics = buildLineMetrics(entries, opts).metrics;
      const candidateWidths = this.buildSpreadLayoutsAndWidths(
        exclBySpread,
        candidateMetrics,
        lineLimit,
      ).lineWidths;
      const nextEntries = this.computeEntriesWithLineWidths(candidateWidths);
      if (sameBreakPoints(entries, nextEntries)) {
        entries = nextEntries;
        break;
      }
      entries = nextEntries;
    }

    // Flatten all lines for slot-based rendering
    const allSlices: PageSlice[] = entries.map((e, i) => ({
      paragraphIndex: i,
      lineStart: 0,
      lineEnd: e.breakPoints.length + 1,
    }));
    const fullPage = buildRenderPage(allSlices, entries);
    const postMetrics = buildLineMetrics(entries, opts);
    const { metrics: lm } = postMetrics;

    const allLines: PageLine[] = [];
    const lineParaIdx: number[] = [];
    let pi = 0;
    for (const para of fullPage.paragraphs) {
      const fs = Math.round(fontSize * this.paragraphScale(para.headingLevel, para.isHeading));
      for (const line of para.lines) {
        allLines.push({
          segments: line.segments,
          headingLevel: para.headingLevel,
          fontSize: fs,
        });
        lineParaIdx.push(pi);
      }
      pi++;
    }

    const { layouts } = this.buildSpreadLayoutsAndWidths(exclBySpread, lm, allLines.length);

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

  private computeEntriesWithLineWidths(lineWidths: Float32Array): RenderEntry[] {
    let gi = 0;
    const entries: RenderEntry[] = [];
    for (const para of this.cached) {
      // A paragraph can occupy at most one line per character, so it never
      // needs to see the widths beyond that. The view is a subarray, so no
      // per-paragraph copy of the remaining widths is made.
      const end = Math.min(lineWidths.length, gi + para.text.length + 1);
      const plw = end > gi ? lineWidths.subarray(gi, end) : undefined;
      const br = computeBreaks({
        text: para.text,
        advances: para.advances,
        lineWidth: this.size.lineWidth,
        lineWidths: plw,
        mode: this.config.mode,
        enableHanging: this.config.enableHanging,
        rubyAnnotations: para.layoutRubyAnnotations,
        tcyAnnotations: para.layoutTcyAnnotations,
      });
      gi += br.breakPoints.length + 1;
      entries.push({
        chars: para.chars,
        breakPoints: br.breakPoints,
        inlineAnnotations: para.inlineAnnotations,
        isHeading: para.isHeading,
        headingLevel: para.headingLevel,
        kind: para.kind,
      });
    }
    return entries;
  }

  private buildSpreadLayoutsAndWidths(
    exclBySpread: ReadonlyMap<number, SpreadExclusionResult>,
    metrics: LineMetric[],
    lineLimit: number,
  ): SpreadLayoutBuildResult {
    const layouts: SpreadLayoutInfo[] = [];
    const lineWidths: number[] = [];
    const lp = this.linePitch();
    const cw = this.contentWidth();
    const fallbackLinesPerSpread = Math.max(1, Math.floor(cw / lp)) * 2;
    let li = 0;

    while (li < lineLimit) {
      const si = layouts.length;
      const start = li;
      const excl = exclBySpread.get(si);

      if (li >= metrics.length) {
        const fallbackWidths = excl?.lineWidths;
        const count = Math.min(
          lineLimit - li,
          Math.max(fallbackWidths?.length ?? 0, fallbackLinesPerSpread),
        );
        for (let i = 0; i < count; i++) {
          lineWidths.push(fallbackWidths?.[i] ?? this.size.lineWidth);
        }
        layouts.push({
          lineStart: start,
          slotCount: count,
          rightSlotCount: Math.ceil(count / 2),
          rightSlots: [],
          leftSlots: [],
          hasRightImages: false,
          hasLeftImages: false,
        });
        li += count;
        continue;
      }

      let rSlots: ColumnSlot[];
      let lSlots: ColumnSlot[];
      let rCount: number;
      let lCount: number;
      let rHasImg = false;
      let lHasImg = false;

      if (excl) {
        // Ask the engine whether it changed the page's slot coverage. Probing
        // for a shortened slot misses a column that an image blocks entirely,
        // because such a column drops out of the slot list at full height.
        rHasImg = excl.rightAffected;
        lHasImg = excl.leftAffected;

        if (rHasImg) {
          rSlots = adjustExclusionSlots(excl.rightSlots, metrics, li, lp, cw);
          rCount = rSlots.length;
        } else {
          rCount = packPageLines(metrics, li, cw);
          rSlots = buildColumnSlots(metrics, li, rCount, this.size.lineWidth);
        }

        if (lHasImg) {
          lSlots = adjustExclusionSlots(excl.leftSlots, metrics, li + rCount, lp, cw);
          lCount = lSlots.length;
        } else {
          lCount = packPageLines(metrics, li + rCount, cw);
          lSlots = buildColumnSlots(metrics, li + rCount, lCount, this.size.lineWidth);
        }
      } else {
        rCount = packPageLines(metrics, li, cw);
        rSlots = buildColumnSlots(metrics, li, rCount, this.size.lineWidth);
        lCount = packPageLines(metrics, li + rCount, cw);
        lSlots = buildColumnSlots(metrics, li + rCount, lCount, this.size.lineWidth);
      }

      for (const slot of rHasImg ? rSlots : rSlots.slice(0, rCount)) {
        lineWidths.push(rHasImg ? slot.height : this.size.lineWidth);
      }
      for (const slot of lHasImg ? lSlots : lSlots.slice(0, lCount)) {
        lineWidths.push(lHasImg ? slot.height : this.size.lineWidth);
      }

      layouts.push({
        lineStart: start,
        slotCount: rCount + lCount,
        rightSlotCount: rCount,
        rightSlots: rSlots,
        leftSlots: lSlots,
        hasRightImages: rHasImg,
        hasLeftImages: lHasImg,
      });
      li += rCount + lCount;
    }

    return { layouts, lineWidths: new Float32Array(lineWidths) };
  }

  private getExclusionSpread(spreadIndex: number, totalPages: number): SpreadResult {
    this.ensureExclusion();
    const { spreadLayouts } = this.excl as ExclusionCache;
    const sl = spreadLayouts[spreadIndex];

    if (!sl) {
      return { right: emptyPageResult(), left: emptyPageResult(), totalPages };
    }

    const rStart = sl.lineStart;
    const rEnd = rStart + sl.rightSlotCount;
    const lStart = rEnd;
    const lEnd = rStart + sl.slotCount;

    return {
      right: this.buildExclusionPage(rStart, rEnd, sl.rightSlots, sl.hasRightImages),
      left: this.buildExclusionPage(lStart, lEnd, sl.leftSlots, sl.hasLeftImages),
      totalPages,
    };
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
          paragraphs.push(exclusionParagraph(entries[curPi], curLines));
        }
        curPi = pi;
        curLines = [];
      }
      curLines.push({ segments: lines[i].segments });
    }
    if (curLines.length > 0 && curPi >= 0) {
      paragraphs.push(exclusionParagraph(entries[curPi], curLines));
    }

    return { page: { paragraphs }, lines: pageLines, slots, hasImages };
  }

  // ── Anchor locator helpers ──

  private locateAnchorInNormal(paragraph: number, charIndex: number): AnchorLocation | null {
    this.ensureNormal();
    const { pages, paraLineStarts } = this.normal as NormalCache;
    const inParaLine = findInParaLine(this.entries[paragraph].breakPoints, charIndex);
    const globalLine = paraLineStarts[paragraph] + inParaLine;

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      for (const slice of pages[pageIdx]) {
        const sliceStart = paraLineStarts[slice.paragraphIndex] + slice.lineStart;
        const sliceEnd = paraLineStarts[slice.paragraphIndex] + slice.lineEnd;
        if (globalLine >= sliceStart && globalLine < sliceEnd) {
          return {
            spreadIdx: Math.floor(pageIdx / 2),
            pageIdx,
            lineIdx: globalLine,
            side: pageIdx % 2 === 0 ? 'right' : 'left',
          };
        }
      }
    }
    return null;
  }

  private locateAnchorInExclusion(paragraph: number, charIndex: number): AnchorLocation | null {
    this.ensureExclusion();
    const { entries, paraLineStarts, spreadLayouts } = this.excl as ExclusionCache;
    const inParaLine = findInParaLine(entries[paragraph].breakPoints, charIndex);
    const globalLine = paraLineStarts[paragraph] + inParaLine;

    for (let s = 0; s < spreadLayouts.length; s++) {
      const sl = spreadLayouts[s];
      if (globalLine >= sl.lineStart && globalLine < sl.lineStart + sl.slotCount) {
        const isRight = globalLine < sl.lineStart + sl.rightSlotCount;
        return {
          spreadIdx: s,
          pageIdx: s * 2 + (isRight ? 0 : 1),
          lineIdx: globalLine,
          side: isRight ? 'right' : 'left',
        };
      }
    }
    return null;
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
    return { paragraph: first.paragraphIndex, charIndex };
  }

  private anchorAtInExclusion(spreadIndex: number, side: 'right' | 'left'): InChapterAnchor | null {
    this.ensureExclusion();
    const { entries, lineParaIndex, paraLineStarts, spreadLayouts } = this.excl as ExclusionCache;
    const sl = spreadLayouts[spreadIndex];
    if (!sl) return null;
    const targetLine = sl.lineStart + (side === 'right' ? 0 : sl.rightSlotCount);
    if (targetLine < 0 || targetLine >= lineParaIndex.length) return null;
    const paragraph = lineParaIndex[targetLine];
    const inParaLine = targetLine - paraLineStarts[paragraph];
    const bp = entries[paragraph].breakPoints;
    const charIndex = lineStartChar(bp, inParaLine);
    return { paragraph, charIndex };
  }

  // ── Coord ↔ anchor helpers ──

  private coordOfAnchorInNormal(anchor: InChapterAnchor): AnchorRect | null {
    const loc = this.locateAnchorInNormal(anchor.paragraph, anchor.charIndex);
    if (!loc) return null;
    const { pages, paraLineStarts, metrics } = this.normal as NormalCache;
    const slices = pages[loc.pageIdx];
    const first = slices?.[0];
    if (!first) return null;
    const pageStart = paraLineStarts[first.paragraphIndex] + first.lineStart;
    const slotIdx = loc.lineIdx - pageStart;
    const page = this.buildNormalPage(loc.pageIdx);
    const slot = page.slots[slotIdx];
    if (!slot) return null;
    return this.makeAnchorRect(
      anchor,
      slot,
      metrics[loc.lineIdx]?.pitch ?? this.linePitch(),
      loc,
      this.entries[anchor.paragraph].breakPoints,
    );
  }

  private coordOfAnchorInExclusion(anchor: InChapterAnchor): AnchorRect | null {
    const loc = this.locateAnchorInExclusion(anchor.paragraph, anchor.charIndex);
    if (!loc) return null;
    const { entries, metrics, spreadLayouts } = this.excl as ExclusionCache;
    const sl = spreadLayouts[loc.spreadIdx];
    if (!sl) return null;
    const offset = loc.lineIdx - sl.lineStart;
    const onRight = offset < sl.rightSlotCount;
    const slot = onRight ? sl.rightSlots[offset] : sl.leftSlots[offset - sl.rightSlotCount];
    if (!slot) return null;
    return this.makeAnchorRect(
      anchor,
      slot,
      metrics[loc.lineIdx]?.pitch ?? this.linePitch(),
      loc,
      entries[anchor.paragraph].breakPoints,
    );
  }

  private makeAnchorRect(
    anchor: InChapterAnchor,
    slot: ColumnSlot,
    colPitch: number,
    loc: AnchorLocation,
    breakPoints: Uint32Array,
  ): AnchorRect {
    const advances = this.layoutAdvancesOf(anchor.paragraph);
    const inParaLine = findInParaLine(breakPoints, anchor.charIndex);
    const lineStart = lineStartChar(breakPoints, inParaLine);
    let yOffset = 0;
    for (let i = lineStart; i < anchor.charIndex; i++) yOffset += advances[i];
    const charAdvance =
      anchor.charIndex < advances.length ? advances[anchor.charIndex] : this.config.fontSize;
    const contentWidth = this.contentWidth();
    const rightEdge = loc.side === 'right' ? contentWidth - slot.xPos : -slot.xPos;
    return {
      spreadIdx: loc.spreadIdx,
      pageIdx: loc.pageIdx,
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
    const firstPara = Math.max(0, range.start.paragraph);
    const lastPara = Math.min(range.end.paragraph, this.cached.length - 1, entries.length - 1);
    for (let p = firstPara; p <= lastPara; p++) {
      const charCount = this.cached[p].chars.length;
      const lo = p === range.start.paragraph ? Math.max(0, range.start.charIndex) : 0;
      const hi = p === range.end.paragraph ? Math.min(range.end.charIndex, charCount) : charCount;
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
    const { pages, paraLineStarts, metrics } = this.normal as NormalCache;

    // Global line span of every page, so each run only needs a cursor step.
    const pageRanges: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const slices of pages) {
      const first = slices[0];
      const start = first ? paraLineStarts[first.paragraphIndex] + first.lineStart : cursor;
      cursor = start + slices.reduce((sum, s) => sum + (s.lineEnd - s.lineStart), 0);
      pageRanges.push({ start, end: cursor });
    }

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
          spreadIdx: Math.floor(pageIdx / 2),
          pageIdx,
          lineIdx: globalLine,
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
          spreadIdx: s,
          pageIdx: s * 2 + (onRight ? 0 : 1),
          lineIdx: globalLine,
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
      spreadIdx: loc.spreadIdx,
      pageIdx: loc.pageIdx,
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
    if (yInLine <= 0) return { paragraph, charIndex: lineStart };
    let acc = 0;
    for (let i = lineStart; i < lineEnd; i++) {
      const half = advances[i] / 2;
      if (acc + half >= yInLine) return { paragraph, charIndex: i };
      acc += advances[i];
    }
    return { paragraph, charIndex: lineEnd };
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
    throw new RangeError(
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
          throw new Error('Unsafe regex search pattern: quantified complex group');
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
