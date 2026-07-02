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
import type { RubyAnnotation } from '../ruby.js';
import type { AnchorLocation, AnchorRange, AnchorRect, InChapterAnchor } from './anchor.js';
import type { FindTextOptions, SearchMatch } from './search.js';
import type { ChapterLayoutSnapshot, LayoutRubySnapshot, ParagraphSnapshot } from './snapshot.js';
import type { BookImage, PageLine, PageResult, PageSize, SpreadResult } from './types.js';

/** @internal Cached per-paragraph data for fast re-layout. */
export interface CachedParagraph {
  text: Uint32Array;
  advances: Float32Array;
  chars: string[];
  inlineAnnotations: readonly InlineAnnotation[];
  layoutRubyAnnotations?: RubyAnnotation[];
  isHeading?: boolean;
  headingLevel?: number;
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

function emptyPageResult(): PageResult {
  return { page: { paragraphs: [] }, lines: [], slots: [], hasImages: false };
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
   * @param size - Partial page size overrides plus optional `lineSpacing`.
   */
  resize(size: Partial<PageSize> & { lineSpacing?: number }): void {
    let needRebreak = false;
    if (size.lineWidth != null && size.lineWidth !== this.size.lineWidth) {
      this.size.lineWidth = size.lineWidth;
      needRebreak = true;
    }
    if (size.pageWidth != null) this.size.pageWidth = size.pageWidth;
    if (size.pagePaddingX != null) this.size.pagePaddingX = size.pagePaddingX;
    if (size.pagePaddingY != null) this.size.pagePaddingY = size.pagePaddingY;
    if (size.lineSpacing != null) this.config.lineSpacing = size.lineSpacing;
    if (needRebreak) this.recomputeBreaks();
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
   * @returns The spread / page / line containing the anchor, or `null` if
   *   the anchor is out of range or the chapter is empty.
   */
  locateAnchor(anchor: InChapterAnchor): AnchorLocation | null {
    const { paragraph, charIndex } = anchor;
    if (paragraph < 0 || paragraph >= this.cached.length) return null;
    const text = this.cached[paragraph].text;
    if (charIndex < 0 || charIndex > text.length) return null;

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
   * @param anchor - In-chapter anchor (paragraph + char index).
   * @returns Character rectangle, or `null` when the anchor cannot be located.
   */
  coordOfAnchor(anchor: InChapterAnchor): AnchorRect | null {
    if (this.images.size > 0) return this.coordOfAnchorInExclusion(anchor);
    return this.coordOfAnchorInNormal(anchor);
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
   * @param range - The character range to highlight.
   * @returns Spread-local rectangles in document order.
   */
  selectionRects(range: AnchorRange): AnchorRect[] {
    const norm = normalizeAnchorRange(range);
    if (!norm) return [];
    const { start, end } = norm;
    const rects: AnchorRect[] = [];
    let current: AnchorRect | null = null;
    let currentKey = '';

    for (let p = start.paragraph; p <= end.paragraph; p++) {
      if (p < 0 || p >= this.cached.length) continue;
      const chars = this.cached[p].chars;
      const lo = p === start.paragraph ? start.charIndex : 0;
      const hi = p === end.paragraph ? end.charIndex : chars.length;
      for (let c = lo; c < hi; c++) {
        const r = this.coordOfAnchor({ paragraph: p, charIndex: c });
        if (!r) continue;
        const key = `${r.spreadIdx}:${r.pageIdx}:${r.x}`;
        if (key !== currentKey) {
          if (current) rects.push(current);
          current = { ...r };
          currentKey = key;
        } else if (current) {
          const bottom = r.y + r.height;
          if (bottom > current.y + current.height) current.height = bottom - current.y;
        }
      }
    }
    if (current) rects.push(current);
    return rects;
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
        inlineAnnotations: para.inlineAnnotations,
      };
      if (para.isHeading === true) snap.isHeading = true;
      if (para.headingLevel != null) snap.headingLevel = para.headingLevel;
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
        ...(this.config.headingStyles ? { headingStyles: this.config.headingStyles } : {}),
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
   * @param query - Literal substring (default) or regex source string
   *   (when {@link FindTextOptions.regex} is `true`).
   * @param options - Search options.
   * @returns Matches in document order. Empty array when `query` is empty
   *   or no matches are found.
   * @throws If `regex: true` and `query` is not a valid regex source.
   */
  findText(query: string, options: FindTextOptions = {}): SearchMatch[] {
    if (!query) return [];
    const { regex = false, caseSensitive = false, maxResults } = options;
    const limit = maxResults != null && maxResults > 0 ? maxResults : Number.POSITIVE_INFINITY;

    const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'gu' : 'giu';
    const pattern = new RegExp(source, flags);

    const results: SearchMatch[] = [];
    for (let pIdx = 0; pIdx < this.cached.length; pIdx++) {
      const chars = this.cached[pIdx].chars;
      if (chars.length === 0) continue;
      const joined = chars.join('');
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
    this.entries = this.cached.map((para) => {
      const br = computeBreaks({
        text: para.text,
        advances: para.advances,
        lineWidth: this.size.lineWidth,
        mode: this.config.mode,
        enableHanging: this.config.enableHanging,
        rubyAnnotations: para.layoutRubyAnnotations,
      });
      return {
        chars: para.chars,
        breakPoints: br.breakPoints,
        inlineAnnotations: para.inlineAnnotations,
        isHeading: para.isHeading,
        headingLevel: para.headingLevel,
      };
    });
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

    const totalChars = this.cached.reduce((s, p) => s + p.text.length, 0);
    let entries = this.entries;
    for (let attempt = 0; attempt < 6; attempt++) {
      const lineLimit =
        entries.reduce((sum, e) => sum + e.breakPoints.length + 1, 0) +
        Math.max(normalLinesPerSpread * 10, totalChars);
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

    this.excl = {
      lines: allLines,
      lineParaIndex: lineParaIdx,
      entries,
      metrics: lm,
      spreadLayouts: layouts,
      totalPages: this.exclusionTotalPages(layouts),
    };
  }

  private computeEntriesWithLineWidths(lineWidths: Float32Array): RenderEntry[] {
    let gi = 0;
    const entries: RenderEntry[] = [];
    for (const para of this.cached) {
      const rem = lineWidths.length - gi;
      const plw = rem > 0 ? lineWidths.slice(gi, gi + rem) : undefined;
      const br = computeBreaks({
        text: para.text,
        advances: para.advances,
        lineWidth: this.size.lineWidth,
        lineWidths: plw,
        mode: this.config.mode,
        enableHanging: this.config.enableHanging,
        rubyAnnotations: para.layoutRubyAnnotations,
      });
      gi += br.breakPoints.length + 1;
      entries.push({
        chars: para.chars,
        breakPoints: br.breakPoints,
        inlineAnnotations: para.inlineAnnotations,
        isHeading: para.isHeading,
        headingLevel: para.headingLevel,
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
        rHasImg = excl.rightSlots.some((s) => s.height < this.size.lineWidth - 0.5);
        lHasImg = excl.leftSlots.some((s) => s.height < this.size.lineWidth - 0.5);

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
          const hl = entries[curPi].headingLevel;
          paragraphs.push({
            lines: curLines,
            isHeading: hl != null || entries[curPi].isHeading === true,
            headingLevel: hl,
          });
        }
        curPi = pi;
        curLines = [];
      }
      curLines.push({ segments: lines[i].segments });
    }
    if (curLines.length > 0 && curPi >= 0) {
      const hl = entries[curPi].headingLevel;
      paragraphs.push({
        lines: curLines,
        isHeading: hl != null || entries[curPi].isHeading === true,
        headingLevel: hl,
      });
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
    const { entries, spreadLayouts } = this.excl as ExclusionCache;
    const inParaLine = findInParaLine(entries[paragraph].breakPoints, charIndex);
    let globalLine = inParaLine;
    for (let i = 0; i < paragraph; i++) {
      globalLine += entries[i].breakPoints.length + 1;
    }

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
    const { entries, lineParaIndex, spreadLayouts } = this.excl as ExclusionCache;
    const sl = spreadLayouts[spreadIndex];
    if (!sl) return null;
    const targetLine = sl.lineStart + (side === 'right' ? 0 : sl.rightSlotCount);
    if (targetLine < 0 || targetLine >= lineParaIndex.length) return null;
    const paragraph = lineParaIndex[targetLine];
    let base = 0;
    for (let i = 0; i < paragraph; i++) {
      base += entries[i].breakPoints.length + 1;
    }
    const inParaLine = targetLine - base;
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
    const advances = this.cached[anchor.paragraph].advances;
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
    const { entries, lineParaIndex, metrics, spreadLayouts } = this.excl as ExclusionCache;
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
    let base = 0;
    for (let i = 0; i < paragraph; i++) base += entries[i].breakPoints.length + 1;
    const inParaLine = globalLine - base;
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
    const advances = this.cached[paragraph].advances;
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
