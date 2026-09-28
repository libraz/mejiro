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
 * Columns split identically by an image form a band group read band by band,
 * as the exclusion engine orders them; a column blocked from top to bottom
 * is skipped at the pitch of the line that tried to enter it.
 */

import {
  type ColumnSlot,
  columnGapsAt,
  type ImageRect,
  type SpreadPageImages,
  sameGapPartition,
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
}

interface BandGroup {
  columns: FlowColumn[];
  /** Band being filled, top to bottom. */
  band: number;
  /** Next column of {@link BandGroup.band} to fill. */
  next: number;
  /** Whether band 0 still accepts columns. */
  open: boolean;
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
  /** Block-direction extent used by the columns closed so far on this page. */
  private edge = 0;
  private nextIndex = 0;
  private group: BandGroup | null = null;

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
    this.pageImages = this.imagesOf(0, 'right');
  }

  /** Whether every later line lands on an image-free page at full line width. */
  get pastImages(): boolean {
    return this.spread > this.lastImageSpread;
  }

  /** A copy that places lines without recording them, for probing line widths. */
  probe(): ColumnFlow {
    const copy: ColumnFlow = Object.create(ColumnFlow.prototype);
    Object.assign(copy, this, { spreads: null, rightSlots: [], leftSlots: [] });
    const group = this.group;
    if (group) {
      copy.group = { ...group, columns: group.columns.map((column) => ({ ...column })) };
    }
    return copy;
  }

  /**
   * Places the next line and returns the inline size available to it.
   *
   * @param metric - Pitch and gap of the line, as {@link buildLineMetrics} resolves them.
   */
  place(metric: LineMetric): number {
    for (;;) {
      const group = this.group;
      if (group) {
        if (group.band === 0 && group.open) {
          const column = this.joinColumn(group, metric);
          if (column) return this.emit(column.gaps[0]);
          group.band = 1;
          group.next = 0;
        }
        const reference = group.columns[0].gaps;
        if (group.next === group.columns.length) {
          group.band++;
          group.next = 0;
        }
        // A line wider than the column it would enter ends the group: the
        // column's gaps were cut, and its neighbour placed, for a narrower one.
        const column = group.columns[group.next];
        if (group.band < reference.length && metric.pitch <= column.width) {
          group.next++;
          return this.emit(column.gaps[group.band]);
        }
        const last = group.columns[group.columns.length - 1];
        this.edge = last.x + last.width;
        this.nextIndex = last.index + 1;
        this.group = null;
      }
      const column = this.openColumn(metric);
      if (column) {
        this.group = { columns: [column], band: 0, next: 1, open: true };
        return this.emit(column.gaps[0]);
      }
      this.nextPage();
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

  /** Extends band 0 of `group` with the next column when it is cut into the same gaps. */
  private joinColumn(group: BandGroup, metric: LineMetric): FlowColumn | null {
    const last = group.columns[group.columns.length - 1];
    const column = this.findColumn(last.x + last.width + metric.gapBefore, last.index + 1, metric);
    if (column && sameGapPartition(column.gaps, group.columns[0].gaps)) {
      group.columns.push(column);
      return column;
    }
    group.open = false;
    return null;
  }

  /** First column with a usable gap at or after the page's closed extent. */
  private openColumn(metric: LineMetric): FlowColumn | null {
    const x = this.pageLines > 0 ? this.edge + metric.gapBefore : this.edge;
    return this.findColumn(x, this.nextIndex, metric);
  }

  private findColumn(x: number, index: number, metric: LineMetric): FlowColumn | null {
    const { contentWidth, lineWidth, basePitch } = this.geometry;
    const { pitch } = metric;
    for (;;) {
      // The page's first column is kept even when it overflows, so layout always progresses.
      if (x + pitch > contentWidth + 0.5 && !(x === 0 && this.pageLines === 0)) return null;
      const { gaps } = columnGapsAt(
        x,
        pitch,
        index,
        contentWidth,
        lineWidth,
        this.pageImages,
        basePitch,
      );
      if (gaps.length > 0) return { x, index, gaps, width: pitch };
      x += pitch;
      index++;
    }
  }

  private emit(gap: ColumnSlot): number {
    if (this.spreads) (this.side === 'right' ? this.rightSlots : this.leftSlots).push(gap);
    this.pageLines++;
    this.lines++;
    return gap.height;
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
    this.pageImages = this.imagesOf(this.spread, this.side);
    this.pageLines = 0;
    this.edge = 0;
    this.nextIndex = 0;
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
