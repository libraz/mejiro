import type { RubyInputAnnotation } from '../browser/types.js';
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
import type { BookImage, PageLine, PageResult, PageSize, SpreadResult } from './types.js';

/** @internal Cached per-paragraph data for fast re-layout. */
export interface CachedParagraph {
  text: Uint32Array;
  advances: Float32Array;
  chars: string[];
  rubyAnnotations: RubyInputAnnotation[];
  layoutRubyAnnotations?: RubyAnnotation[];
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

function emptyPageResult(): PageResult {
  return { page: { paragraphs: [] }, lines: [], slots: [], hasImages: false };
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
      return this.excl?.totalPages ?? 1;
    }
    this.ensureNormal();
    return Math.max(1, this.normal?.pages.length ?? 0);
  }

  /** Whether any spread has image exclusions set. */
  get hasImages(): boolean {
    return this.images.size > 0;
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
    this.excl = null;
  }

  /** Removes all image exclusions. */
  clearImages(): void {
    this.images.clear();
    this.excl = null;
  }

  /**
   * Sets or clears images for a spread and returns the updated spread result.
   * Combines {@link setImages} / {@link clearImages} with {@link getSpread}.
   *
   * @param spreadIndex - Zero-based spread index.
   * @param images - Image rectangles, or `undefined` / empty array to clear all images.
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

  // ── Private helpers ──

  private contentWidth(): number {
    return this.size.pageWidth - this.size.pagePaddingX * 2;
  }

  private resolveScale(level?: number): number {
    if (level == null) return 1;
    return this.config.headingStyles?.[level]?.scale ?? this.config.headingScale;
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
        rubyAnnotations: para.rubyAnnotations,
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
      const fs = Math.round(fontSize * this.resolveScale(para.headingLevel));
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
            spreadEngine.addImage({
              x: img.x,
              y: img.y,
              w: leftW,
              h: img.h,
              inlineMargin: margin,
            });
          }
        } else {
          const center = img.x + img.w / 2;
          const onRight = center > 0 && center < this.size.pageWidth;
          let xAdj = 0;
          if (onRight) {
            const fromRight = this.size.pageWidth - this.size.pagePaddingX - center;
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
      exclBySpread.set(si, spreadEngine.compute());
    }

    // Build tiled lineWidths across all spreads
    const totalChars = this.cached.reduce((s, p) => s + p.text.length, 0);
    const maxSpreads = Math.ceil(totalChars / Math.max(normalLinesPerSpread, 1)) + 10;
    const wList: number[] = [];
    for (let s = 0; s < maxSpreads; s++) {
      const e = exclBySpread.get(s);
      if (e) {
        for (let i = 0; i < e.lineWidths.length; i++) wList.push(e.lineWidths[i]);
      } else {
        for (let i = 0; i < normalLinesPerSpread; i++) wList.push(this.size.lineWidth);
      }
    }
    const tiled = new Float32Array(wList);

    // Re-layout all paragraphs with per-spread lineWidths
    let gi = 0;
    const entries: RenderEntry[] = [];
    for (const para of this.cached) {
      const rem = tiled.length - gi;
      const plw = rem > 0 ? tiled.slice(gi, gi + rem) : undefined;
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
        rubyAnnotations: para.rubyAnnotations,
        headingLevel: para.headingLevel,
      });
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
      const fs = Math.round(fontSize * this.resolveScale(para.headingLevel));
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

    // Gap-aware spread assignment
    const layouts: SpreadLayoutInfo[] = [];
    let li = 0;
    while (li < allLines.length) {
      const si = layouts.length;
      const excl = exclBySpread.get(si);

      if (excl) {
        const rHasImg = excl.rightSlots.some((s) => s.height < this.size.lineWidth - 0.5);
        const lHasImg = excl.leftSlots.some((s) => s.height < this.size.lineWidth - 0.5);

        // Use excl.rightSlotCount for right page line count to keep lineWidths
        // aligned with the exclusion engine's right/left split. Without this,
        // packPageLines may return a different count than the engine assumed,
        // causing left page lines to read from wrong lineWidth offsets.
        let rSlots: ColumnSlot[];
        const rCount = rHasImg ? excl.rightSlots.length : excl.rightSlotCount;
        if (rHasImg) {
          rSlots = adjustExclusionSlots(excl.rightSlots, lm, li, lp);
        } else {
          rSlots = buildColumnSlots(lm, li, rCount, this.size.lineWidth);
        }

        let lSlots: ColumnSlot[];
        let lCount: number;
        if (lHasImg) {
          lSlots = adjustExclusionSlots(excl.leftSlots, lm, li + rCount, lp);
          lCount = lSlots.length;
        } else {
          lCount = packPageLines(lm, li + rCount, cw);
          lSlots = buildColumnSlots(lm, li + rCount, lCount, this.size.lineWidth);
        }

        layouts.push({
          lineStart: li,
          slotCount: rCount + lCount,
          rightSlotCount: rCount,
          rightSlots: rSlots,
          leftSlots: lSlots,
          hasRightImages: rHasImg,
          hasLeftImages: lHasImg,
        });
        li += rCount + lCount;
      } else {
        const start = li;
        const rCount = packPageLines(lm, li, cw);
        li += rCount;
        const lCount = packPageLines(lm, li, cw);
        li += lCount;
        layouts.push({
          lineStart: start,
          slotCount: rCount + lCount,
          rightSlotCount: rCount,
          rightSlots: buildColumnSlots(lm, start, rCount, this.size.lineWidth),
          leftSlots: buildColumnSlots(lm, start + rCount, lCount, this.size.lineWidth),
          hasRightImages: false,
          hasLeftImages: false,
        });
      }
    }

    this.excl = {
      lines: allLines,
      lineParaIndex: lineParaIdx,
      entries,
      spreadLayouts: layouts,
      totalPages: Math.max(1, layouts.length * 2),
    };
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
          paragraphs.push({ lines: curLines, isHeading: hl != null, headingLevel: hl });
        }
        curPi = pi;
        curLines = [];
      }
      curLines.push({ segments: lines[i].segments });
    }
    if (curLines.length > 0 && curPi >= 0) {
      const hl = entries[curPi].headingLevel;
      paragraphs.push({ lines: curLines, isHeading: hl != null, headingLevel: hl });
    }

    return { page: { paragraphs }, lines: pageLines, slots, hasImages };
  }
}
