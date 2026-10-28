/**
 * @file Places exclusion-mode lines on spreads one at a time.
 *
 * Every column is positioned from the metrics of the lines already placed, and
 * its gaps are cut from the images at that physical position, so the columns a
 * page excludes are the ones the drawn image covers in the final layout. A
 * line's slot depends only on the lines before it, which lets the caller probe
 * a paragraph's line widths on a copy of the flow, break the paragraph once,
 * and then commit its lines: a single deterministic pass with no re-break.
 *
 * Reading order matches the exclusion engine: a page an image divides across
 * its full width is filled tier by tier, each tier restarting at the right
 * edge; within a tier a column is read through all of its gaps, top to bottom,
 * before the next column opens. A column blocked from top to bottom is skipped
 * at the pitch of the line that tried to enter it.
 */

import {
  type ColumnSlot,
  columnGapsAt,
  type ImageRect,
  type PageTier,
  pageTiers,
  type SpreadPageImages,
} from '../exclusion.js';
import type { LineMetric } from '../render/types.js';

/** Page geometry the flow places columns in. */
export interface ColumnFlowGeometry {
  /** Page content width in the block direction (px). */
  contentWidth: number;
  /** Full inline size of a column (px). */
  lineWidth: number;
  /** Body line pitch; also the smallest gap a line may occupy (px). */
  basePitch: number;
}

/** Per-spread line placement produced by {@link ColumnFlow}. */
export interface SpreadLayoutInfo {
  /** Global index of the spread's first line. */
  lineStart: number;
  /** Lines on both pages. */
  slotCount: number;
  /** Lines on the right page. */
  rightSlotCount: number;
  /** One slot per right-page line, in reading order. */
  rightSlots: ColumnSlot[];
  /** One slot per left-page line, in reading order. */
  leftSlots: ColumnSlot[];
  /** Whether an image reaches into the right page's content box. */
  hasRightImages: boolean;
  /** Whether an image reaches into the left page's content box. */
  hasLeftImages: boolean;
}

interface FlowColumn {
  x: number;
  index: number;
  gaps: readonly ColumnSlot[];
  /** Pitch the column was cut for; no wider line enters it. */
  width: number;
  /** Next gap to fill, top to bottom. */
  next: number;
}

/** Deterministic line placement over the spreads of one chapter. */
export class ColumnFlow {
  private readonly geometry: ColumnFlowGeometry;
  private readonly images: ReadonlyMap<number, SpreadPageImages>;
  private readonly lastImageSpread: number;
  /** Null on a probe, which only reports widths. */
  private readonly spreads: SpreadLayoutInfo[] | null;

  private spread = 0;
  private side: 'right' | 'left' = 'right';
  private lines = 0;
  private spreadStart = 0;
  private rightSlots: ColumnSlot[] = [];
  private leftSlots: ColumnSlot[] = [];
  private pageImages: readonly ImageRect[] = [];
  private pageLines = 0;
  /** Tiers of the current page, top to bottom. */
  private tiers: readonly PageTier[] = [];
  private tier = 0;
  private tierLines = 0;
  /** Block-direction extent used by the columns closed so far in this tier. */
  private edge = 0;
  private nextIndex = 0;
  private column: FlowColumn | null = null;

  /**
   * @param geometry - Page geometry shared by every page.
   * @param images - Per spread, its images split by page in content-area coordinates.
   */
  constructor(geometry: ColumnFlowGeometry, images: ReadonlyMap<number, SpreadPageImages>) {
    this.geometry = geometry;
    this.images = images;
    let last = -1;
    for (const [spread, pages] of images) {
      if (pages.right.length + pages.left.length > 0) last = Math.max(last, spread);
    }
    this.lastImageSpread = last;
    this.spreads = [];
    this.enterPage();
  }

  /** Whether every later line lands on an image-free page at full line width. */
  get pastImages(): boolean {
    return this.spread > this.lastImageSpread;
  }

  /** A copy that places lines without recording them, for probing line widths. */
  probe(): ColumnFlow {
    const copy: ColumnFlow = Object.create(ColumnFlow.prototype);
    Object.assign(copy, this, { spreads: null, rightSlots: [], leftSlots: [] });
    if (this.column) copy.column = { ...this.column };
    return copy;
  }

  /**
   * Places the next line and returns the inline size available to it.
   *
   * @param metric - Pitch and gap of the line, as {@link buildLineMetrics} resolves them.
   */
  place(metric: LineMetric): number {
    for (;;) {
      const current = this.column;
      if (current) {
        // A line wider than the column ends it: its gaps were cut for a narrower one.
        if (current.next < current.gaps.length && metric.pitch <= current.width) {
          return this.emit(current.gaps[current.next++]);
        }
        this.edge = current.x + current.width;
        this.nextIndex = current.index + 1;
        this.column = null;
      }
      const column = this.openColumn(metric);
      if (column) {
        this.column = column;
        return this.emit(column.gaps[column.next++]);
      }
      if (this.tier + 1 < this.tiers.length) this.enterTier(this.tier + 1);
      else this.nextPage();
    }
  }

  /** Spread layouts of every line placed so far. */
  finish(): SpreadLayoutInfo[] {
    const spreads = this.spreads ?? [];
    return this.lines > this.spreadStart ? [...spreads, this.currentSpread()] : spreads;
  }

  private imagesOf(spread: number, side: 'right' | 'left'): readonly ImageRect[] {
    return this.images.get(spread)?.[side] ?? [];
  }

  /** First column with a usable gap at or after the tier's closed extent. */
  private openColumn(metric: LineMetric): FlowColumn | null {
    const x = this.tierLines > 0 ? this.edge + metric.gapBefore : this.edge;
    return this.findColumn(x, this.nextIndex, metric);
  }

  private findColumn(x: number, index: number, metric: LineMetric): FlowColumn | null {
    const { contentWidth, lineWidth, basePitch } = this.geometry;
    const { pitch } = metric;
    for (;;) {
      // The page's first column is kept even when it overflows, so layout always progresses.
      if (x + pitch > contentWidth + 0.5 && !(x === 0 && this.pageLines === 0)) return null;
      const gaps = this.tierGaps(
        columnGapsAt(x, pitch, index, contentWidth, lineWidth, this.pageImages, basePitch).gaps,
      );
      if (gaps.length > 0) return { x, index, gaps, width: pitch, next: 0 };
      x += pitch;
      index++;
    }
  }

  /** The parts of `gaps` inside the current tier that still fit a body line. */
  private tierGaps(gaps: readonly ColumnSlot[]): ColumnSlot[] {
    if (this.tiers.length === 1) return gaps as ColumnSlot[];
    const { top, bottom } = this.tiers[this.tier];
    const inside: ColumnSlot[] = [];
    for (const gap of gaps) {
      const start = Math.max(gap.yStart, top);
      const end = Math.min(gap.yStart + gap.height, bottom);
      if (end - start >= this.geometry.basePitch) {
        inside.push({ ...gap, yStart: start, height: end - start });
      }
    }
    return inside;
  }

  private emit(gap: ColumnSlot): number {
    if (this.spreads) (this.side === 'right' ? this.rightSlots : this.leftSlots).push(gap);
    this.pageLines++;
    this.tierLines++;
    this.lines++;
    return gap.height;
  }

  /** Loads the current page's images and tiers and starts its first tier. */
  private enterPage(): void {
    this.pageImages = this.imagesOf(this.spread, this.side);
    this.pageLines = 0;
    this.tiers =
      this.pageImages.length > 0 ? this.cutTiers() : [{ top: 0, bottom: this.geometry.lineWidth }];
    this.enterTier(0);
  }

  private enterTier(tier: number): void {
    this.tier = tier;
    this.tierLines = 0;
    this.edge = 0;
    this.nextIndex = 0;
  }

  /** Tiers of the current page, judged on body-pitch columns as the exclusion engine cuts them. */
  private cutTiers(): PageTier[] {
    const { contentWidth, lineWidth, basePitch } = this.geometry;
    const columns: ColumnSlot[][] = [];
    for (let i = 0; (i + 1) * basePitch <= contentWidth + 0.5; i++) {
      const { gaps } = columnGapsAt(
        i * basePitch,
        basePitch,
        i,
        contentWidth,
        lineWidth,
        this.pageImages,
        basePitch,
      );
      columns.push(gaps);
    }
    return pageTiers(columns, lineWidth);
  }

  private nextPage(): void {
    if (this.side === 'right') {
      this.side = 'left';
    } else {
      this.spreads?.push(this.currentSpread());
      this.spread++;
      this.side = 'right';
      this.spreadStart = this.lines;
      this.rightSlots = [];
      this.leftSlots = [];
    }
    this.enterPage();
  }

  private currentSpread(): SpreadLayoutInfo {
    const rightSlotCount = this.rightSlots.length;
    return {
      lineStart: this.spreadStart,
      slotCount: this.lines - this.spreadStart,
      rightSlotCount,
      rightSlots: this.rightSlots,
      leftSlots: this.leftSlots,
      hasRightImages: this.reachesContent(this.imagesOf(this.spread, 'right')),
      hasLeftImages: this.reachesContent(this.imagesOf(this.spread, 'left')),
    };
  }

  /** Whether any image, with its inline margin, overlaps the column's inline extent. */
  private reachesContent(images: readonly ImageRect[]): boolean {
    const { lineWidth } = this.geometry;
    return images.some((img) => {
      const margin = img.inlineMargin ?? 0;
      return Math.min(lineWidth, img.y + img.h + margin) > Math.max(0, img.y - margin);
    });
  }
}
