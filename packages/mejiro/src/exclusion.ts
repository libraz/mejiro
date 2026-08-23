/**
 * Exclusion zone — a rectangular region that text must flow around.
 *
 * In vertical writing mode (`writing-mode: vertical-rl`):
 * - The **block direction** is horizontal (right-to-left), where each line is a column.
 * - The **inline direction** is vertical (top-to-bottom), which is the `lineWidth` axis.
 * - `blockStart` / `blockEnd` map to line indices.
 * - `inlineSize` is how much of the line's width the exclusion occupies.
 */
export interface ExclusionZone {
  /** First affected line index (0-based, inclusive). */
  blockStart: number;
  /** Last affected line index (exclusive). */
  blockEnd: number;
  /** Amount of inline space consumed by the exclusion (px). Subtracted from `lineWidth`. */
  inlineSize: number;
}

/**
 * Smallest line width (px) any exclusion computation may produce.
 *
 * `computeBreaks()` rejects non-positive `lineWidths` entries, so a line whose
 * exclusions consume all of its inline size is clamped to this value instead of
 * to 0. Such a line holds at most one character.
 */
const MIN_EXCLUSION_LINE_WIDTH = 1;

/**
 * Computes per-line widths by subtracting exclusion zones from the base line width.
 *
 * Multiple exclusion zones may overlap; their inline sizes are summed per line.
 * A line whose exclusions consume its whole inline size is clamped to a small
 * positive width rather than to 0, so the result is always a valid `lineWidths`
 * input for `computeBreaks()`.
 *
 * @param baseLineWidth - Default line width in pixels.
 * @param lineCount - Number of lines to generate widths for.
 * @param exclusions - Exclusion zones that reduce available line width.
 * @returns A `Float32Array` of per-line widths, every entry strictly positive.
 */
export function computeLineWidths(
  baseLineWidth: number,
  lineCount: number,
  exclusions: readonly ExclusionZone[],
): Float32Array {
  const widths = new Float32Array(lineCount);
  widths.fill(baseLineWidth);

  for (const zone of exclusions) {
    const start = Math.max(0, zone.blockStart);
    const end = Math.min(lineCount, zone.blockEnd);
    for (let i = start; i < end; i++) {
      widths[i] = Math.max(MIN_EXCLUSION_LINE_WIDTH, widths[i] - zone.inlineSize);
    }
  }

  return widths;
}

// ── Image-based exclusion (higher-level API) ──

/**
 * A rectangle in content-area coordinates representing an image or obstacle.
 *
 * In vertical writing mode:
 * - `x` / `w` are in the block direction (horizontal, columns flow right-to-left).
 * - `y` / `h` are in the inline direction (vertical, text flows top-to-bottom).
 *
 * Coordinates are relative to the content area origin (top-left of the
 * area where text is rendered, after padding).
 *
 * This is the layout-side shape: it adds the margins the exclusion engine
 * reserves around the image. The bare `{ x, y, w, h }` shape a host drags
 * around in its UI is `ImageOverlayRect`.
 */
export interface ImageRect {
  /** Horizontal offset from the left edge of the content area (px). */
  x: number;
  /** Vertical offset from the top of the content area (px). */
  y: number;
  /** Width in the block direction (px). */
  w: number;
  /** Height in the inline direction (px). */
  h: number;
  /** Margin in the inline direction (top/bottom in vertical-rl) in pixels. Applied to both sides. @defaultValue 0 */
  inlineMargin?: number;
  /** Margin in the block direction (left/right in vertical-rl) in pixels. Applied to both sides. @defaultValue 0 */
  blockMargin?: number;
}

/**
 * Rendering slot computed from image exclusions.
 *
 * Each slot describes where text should be placed and how much vertical space
 * is available there. A single physical column may produce several slots (e.g.
 * one above and one below an image) or none at all, and slots are emitted in
 * reading order rather than in column order — so a slot's position in the array
 * is a line index, not a column index. The physical column a slot belongs to is
 * given by `columnIndex`.
 */
export interface ColumnSlot {
  /** Horizontal offset from the right edge of the content area (px). */
  xPos: number;
  /** Vertical offset from the top of the content area (px). */
  yStart: number;
  /** Available height for text in this column (px). */
  height: number;
  /**
   * Physical column this slot belongs to (0 = the column nearest the right
   * content edge). Several slots share a `columnIndex` when an image splits a
   * column into multiple gaps. Every slot produced by this package carries it;
   * it is optional only so hand-built slot arrays stay assignable.
   */
  columnIndex?: number;
}

/**
 * Page geometry for exclusion computation.
 */
export interface ExclusionPageGeometry {
  /** Base line width (inline size of a full column) in pixels. */
  lineWidth: number;
  /** Number of columns on the page. */
  lineCount: number;
  /** Column pitch (fontSize × lineHeight) in pixels. */
  linePitch: number;
  /** Total content width in the block direction (px). */
  contentWidth: number;
  /** Minimum vertical gap height usable for text. Defaults to `linePitch`. */
  minGapHeight?: number;
}

/**
 * Manages image exclusion zones for text layout on a page.
 *
 * Computes per-column text placement by finding all contiguous
 * vertical gaps not occupied by any image. Each gap becomes a
 * layout slot with its own line width and rendering position.
 *
 * For a column partially blocked by an image, the engine produces
 * multiple slots (e.g. one above and one below the image), each with
 * its own line width entry. Slots are emitted in reading order: a run
 * of adjacent columns split the same way by an image forms a band
 * group, and text fills the band above the image across the whole
 * group before wrapping back to the band below it.
 *
 * @example
 * ```ts
 * const engine = new ExclusionEngine({
 *   lineWidth: 600,
 *   lineCount: 12,
 *   linePitch: 30.4,
 *   contentWidth: 380,
 * });
 *
 * engine.addImage({ x: 100, y: 50, w: 120, h: 160 });
 *
 * const { slots, lineWidths } = engine.compute();
 * const result = computeBreaks({ text, advances, lineWidth: 600, lineWidths });
 * // Render each line at slots[i].xPos, slots[i].yStart
 * ```
 */
export class ExclusionEngine {
  private geometry: ExclusionPageGeometry;
  private images: ImageRect[] = [];

  /**
   * Creates an engine for one page's geometry with an empty image set. The
   * geometry is retained by reference until {@link ExclusionEngine.setGeometry}
   * replaces it, so pass a value the caller will not mutate afterwards.
   *
   * @param geometry - Column count, pitch and content extent of the page.
   */
  constructor(geometry: ExclusionPageGeometry) {
    this.geometry = geometry;
  }

  /** Replaces page geometry (e.g. on resize). */
  setGeometry(geometry: ExclusionPageGeometry): void {
    this.geometry = geometry;
  }

  /** Returns the current page geometry. */
  getGeometry(): Readonly<ExclusionPageGeometry> {
    return this.geometry;
  }

  /** Adds an image to the exclusion set. Returns `this` for chaining. */
  addImage(rect: ImageRect): this {
    this.images.push(rect);
    return this;
  }

  /** Removes a previously added image by reference equality. */
  removeImage(rect: ImageRect): boolean {
    const idx = this.images.indexOf(rect);
    if (idx >= 0) {
      this.images.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Removes all images. */
  clearImages(): void {
    this.images.length = 0;
  }

  /** Returns the current list of images (read-only). */
  getImages(): readonly ImageRect[] {
    return this.images;
  }

  /** Returns the number of images. */
  get imageCount(): number {
    return this.images.length;
  }

  /**
   * Computes slots and line widths for the current images.
   *
   * For each physical column, finds **all** contiguous vertical gaps
   * not occupied by any image. Each gap becomes a separate slot.
   * Affected columns may produce several slots (and thus several
   * entries in `lineWidths`), or none at all when an image blocks the
   * whole column, so `slots.length` may be above or below `lineCount`
   * and a slot cannot be looked up by column index — read
   * {@link ColumnSlot.columnIndex} to recover the physical column.
   *
   * Slots come out in reading order, not column order: adjacent columns
   * split identically by an image form a band group whose upper band is
   * filled across every column of the group before the band below it.
   *
   * Every `lineWidths` entry is strictly positive: a gap with no usable
   * height produces no slot rather than a zero-width one.
   *
   * @returns Slots for rendering, line widths for `computeBreaks()`,
   *   and whether any column's slot coverage differs from the unobstructed
   *   layout (one full-height slot per column).
   */
  compute(): { slots: ColumnSlot[]; lineWidths: Float32Array; affected: boolean } {
    const { lineWidth, lineCount, linePitch, contentWidth } = this.geometry;
    const minGapHeight = this.geometry.minGapHeight ?? linePitch;
    const columns: ColumnGaps[] = [];
    let affected = false;

    for (let col = 0; col < lineCount; col++) {
      const column = computeColumnGaps(
        col,
        linePitch,
        contentWidth,
        lineWidth,
        this.images,
        minGapHeight,
      );
      if (column.obstructed) affected = true;
      columns.push(column);
    }

    const slots = orderGapsForReading(columns);
    const widths = new Float32Array(slots.length);
    for (let i = 0; i < slots.length; i++) {
      widths[i] = slots[i].height;
    }

    return { slots, lineWidths: widths, affected };
  }
}

/**
 * Computes per-column text placement slots for images on a page.
 *
 * Convenience function equivalent to creating an {@link ExclusionEngine},
 * adding all images, and calling `compute()`. Prefer the class when
 * images are added/removed incrementally.
 *
 * @param options - Page geometry and image placements.
 * @returns Column slots for rendering, line widths for layout, and whether
 *   any column's slot coverage differs from the unobstructed layout.
 */
export function computeExclusionSlots(
  options: ExclusionPageGeometry & {
    /** Image rectangles in content-area coordinates. */
    images: readonly ImageRect[];
  },
): { slots: ColumnSlot[]; lineWidths: Float32Array; affected: boolean } {
  const { images, ...geometry } = options;
  const engine = new ExclusionEngine(geometry);
  for (const img of images) {
    engine.addImage(img);
  }
  return engine.compute();
}

/** Usable gaps of one physical column, in top-to-bottom order. */
interface ColumnGaps {
  gaps: ColumnSlot[];
  obstructed: boolean;
}

/** True when two columns are split into the same vertical gaps. */
function sameGapPartition(a: readonly ColumnSlot[], b: readonly ColumnSlot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].yStart !== b[i].yStart || a[i].height !== b[i].height) return false;
  }
  return true;
}

/**
 * Flattens per-column gaps into the order a reader traverses them.
 *
 * Adjacent columns cut into the same gaps by an image form a band group. Within
 * a group the gaps are emitted band by band — the whole band above the image
 * across every column of the group, then the band below it — which is how text
 * wraps around a figure placed in the middle of a run of columns. Columns whose
 * gaps differ start a new group, so a column is never read before a column to
 * its right. A fully blocked column contributes nothing and does not split the
 * group around it.
 */
function orderGapsForReading(columns: readonly ColumnGaps[]): ColumnSlot[] {
  const slots: ColumnSlot[] = [];
  let start = 0;
  while (start < columns.length) {
    const reference = columns[start].gaps;
    if (reference.length === 0) {
      start++;
      continue;
    }
    let end = start + 1;
    while (
      end < columns.length &&
      (columns[end].gaps.length === 0 || sameGapPartition(reference, columns[end].gaps))
    ) {
      end++;
    }
    for (let band = 0; band < reference.length; band++) {
      for (let col = start; col < end; col++) {
        const gap = columns[col].gaps[band];
        if (gap) slots.push(gap);
      }
    }
    start = end;
  }
  return slots;
}

/**
 * Computes all usable vertical gaps in a single column
 * after subtracting all overlapping image regions.
 * Returns one slot per gap (possibly multiple per column, or none when the
 * column is fully blocked), plus whether any image took inline space away
 * from this column — the latter is independent of how many gaps survived
 * the `minGapHeight` filter.
 */
function computeColumnGaps(
  colIndex: number,
  linePitch: number,
  contentW: number,
  lineWidth: number,
  images: readonly ImageRect[],
  minGapHeight: number,
): ColumnGaps {
  const xPos = colIndex * linePitch;
  // Column horizontal range (in content coords, measured from left)
  const colRight = contentW - colIndex * linePitch;
  const colLeft = colRight - linePitch;

  // Collect vertical intervals of images overlapping this column (with margins)
  const intervals: [number, number][] = [];
  for (const img of images) {
    const bm = img.blockMargin ?? 0;
    const im = img.inlineMargin ?? 0;
    const effX = img.x - bm;
    const effW = img.w + bm * 2;
    if (effX + effW > colLeft && effX < colRight) {
      const top = Math.max(0, img.y - im);
      const bottom = Math.min(lineWidth, img.y + img.h + im);
      if (bottom > top) intervals.push([top, bottom]);
    }
  }

  if (intervals.length === 0) {
    return {
      gaps: [{ xPos, yStart: 0, height: lineWidth, columnIndex: colIndex }],
      obstructed: false,
    };
  }

  // Merge overlapping intervals
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[intervals[0][0], intervals[0][1]]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i][0] <= last[1]) {
      last[1] = Math.max(last[1], intervals[i][1]);
    } else {
      merged.push([intervals[i][0], intervals[i][1]]);
    }
  }

  // Collect all gaps (above, between, below images).
  // A gap of zero (or negative) height is never emitted, even when
  // `minGapHeight` is 0 — `computeBreaks()` requires positive line widths.
  const gaps: ColumnSlot[] = [];
  let prevEnd = 0;
  for (const [top, bottom] of merged) {
    const gapH = top - prevEnd;
    if (gapH > 0 && gapH >= minGapHeight) {
      gaps.push({ xPos, yStart: prevEnd, height: gapH, columnIndex: colIndex });
    }
    prevEnd = bottom;
  }
  const tailGap = lineWidth - prevEnd;
  if (tailGap > 0 && tailGap >= minGapHeight) {
    gaps.push({ xPos, yStart: prevEnd, height: tailGap, columnIndex: colIndex });
  }

  return { gaps, obstructed: true };
}

// ── Spread (two-page) exclusion ──

/**
 * Geometry for a two-page spread in vertical writing mode.
 *
 * Both pages are assumed to have the same dimensions.
 * In `writing-mode: vertical-rl`, the right page comes first
 * (columns flow right-to-left), then the left page continues.
 */
export interface SpreadGeometry {
  /** Width of each page in pixels (both pages are the same width). */
  pageWidth: number;
  /** Horizontal padding on each side of each page (px). */
  pagePaddingX: number;
  /** Vertical padding at the top of each page (px). */
  pagePaddingY: number;
  /** Base line width (inline size of a full column) in pixels. */
  lineWidth: number;
  /** Column pitch (fontSize × lineHeight) in pixels. */
  linePitch: number;
}

/**
 * An image rectangle positioned relative to the **right page's top-left corner**.
 *
 * Negative `x` values indicate the image extends into the left page.
 * The engine handles the gutter (padding between pages) automatically.
 */
export type SpreadImageRect = ImageRect;

/**
 * Result of spread exclusion computation.
 */
export interface SpreadExclusionResult {
  /** Slots for the right page. */
  rightSlots: ColumnSlot[];
  /** Slots for the left page. */
  leftSlots: ColumnSlot[];
  /** Combined lineWidths for a single `computeBreaks()` call (right page then left page). */
  lineWidths: Float32Array;
  /** Number of layout lines (slots) allocated to the right page. */
  rightSlotCount: number;
  /**
   * Whether any right-page column's slot coverage differs from the
   * unobstructed layout (one full-height slot per column). True also when a
   * column is blocked entirely and therefore produces no slot at all.
   */
  rightAffected: boolean;
  /** Same as {@link SpreadExclusionResult.rightAffected} for the left page. */
  leftAffected: boolean;
}

/**
 * Manages image exclusion across a two-page spread.
 *
 * Images are positioned relative to the right page's top-left corner.
 * The engine automatically converts coordinates for the left page,
 * accounting for the gutter (page padding on inner edges).
 *
 * Text flows continuously from the right page to the left page.
 * The combined `lineWidths` can be passed directly to `computeBreaks()`
 * for a single layout pass across both pages.
 *
 * @example
 * ```ts
 * const spread = new SpreadExclusionEngine({
 *   pageWidth: 537,
 *   pagePaddingX: 52,
 *   pagePaddingY: 56,
 *   lineWidth: 676,
 *   linePitch: 30.4,
 * });
 *
 * // Image on the right page
 * spread.addImage({ x: 200, y: 100, w: 120, h: 160, inlineMargin: 16 });
 *
 * // Image straddling the gutter (negative x = left page)
 * spread.addImage({ x: -100, y: 300, w: 200, h: 100 });
 *
 * const { rightSlots, leftSlots, lineWidths, rightSlotCount } = spread.compute();
 * const result = computeBreaks({ text, advances, lineWidth: 676, lineWidths });
 *
 * // Split lines for rendering:
 * // Lines 0..rightSlotCount-1 → right page using rightSlots
 * // Lines rightSlotCount..    → left page using leftSlots
 * ```
 */
export class SpreadExclusionEngine {
  private geometry: SpreadGeometry;
  private images: ImageRect[] = [];

  /**
   * Creates an engine for one spread's geometry with an empty image set. Column
   * counts are derived from the geometry on every {@link
   * SpreadExclusionEngine.compute} call, so only the geometry needs replacing on
   * resize. The value is retained by reference until
   * {@link SpreadExclusionEngine.setGeometry} replaces it.
   *
   * @param geometry - Page extent, padding and column pitch of the spread.
   */
  constructor(geometry: SpreadGeometry) {
    this.geometry = geometry;
  }

  /** Replaces spread geometry (e.g. on resize). */
  setGeometry(geometry: SpreadGeometry): void {
    this.geometry = geometry;
  }

  /** Returns the current spread geometry. */
  getGeometry(): Readonly<SpreadGeometry> {
    return this.geometry;
  }

  /**
   * Adds an image positioned relative to the right page's top-left corner.
   * Negative `x` values indicate the image extends into the left page.
   * Returns `this` for chaining.
   */
  addImage(rect: ImageRect): this {
    this.images.push(rect);
    return this;
  }

  /** Removes a previously added image by reference equality. */
  removeImage(rect: ImageRect): boolean {
    const idx = this.images.indexOf(rect);
    if (idx >= 0) {
      this.images.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Removes all images. */
  clearImages(): void {
    this.images.length = 0;
  }

  /** Returns the current list of images (read-only). */
  getImages(): readonly ImageRect[] {
    return this.images;
  }

  /** Returns the number of images. */
  get imageCount(): number {
    return this.images.length;
  }

  /**
   * Computes exclusion slots and line widths for the full spread.
   *
   * Internally creates two {@link ExclusionEngine} instances (right and left page),
   * distributes images to the correct page with proper coordinate conversion
   * (accounting for page padding / gutter), and concatenates the results into
   * a single continuous `lineWidths` array.
   *
   * Each page also reports whether its slot coverage was changed by the images,
   * so callers can tell "no image effect" from "image effect that happens to
   * leave every surviving slot at full height".
   */
  compute(): SpreadExclusionResult {
    const { pageWidth, pagePaddingX, pagePaddingY, lineWidth, linePitch } = this.geometry;
    const contentW = pageWidth - pagePaddingX * 2;
    const slotsPerPage = Math.floor(contentW / linePitch);

    const pageGeometry: ExclusionPageGeometry = {
      lineWidth,
      lineCount: slotsPerPage,
      linePitch,
      contentWidth: contentW,
    };

    const rightEngine = new ExclusionEngine(pageGeometry);
    const leftEngine = new ExclusionEngine(pageGeometry);

    for (const img of this.images) {
      // Convert from right-page-relative to content-area coordinates
      const cx = img.x - pagePaddingX;
      const cy = img.y - pagePaddingY;
      const bm = img.blockMargin ?? 0;
      const baseProps = {
        y: cy,
        w: img.w,
        h: img.h,
        inlineMargin: img.inlineMargin,
        blockMargin: img.blockMargin,
      };

      // Right page: image overlaps if its right edge > 0 and left edge < contentW
      if (cx + img.w + bm > 0 && cx - bm < contentW) {
        rightEngine.addImage({ ...baseProps, x: cx });
      }

      // Left page: image extends past the right page's left edge (x < pagePaddingX)
      // Coordinate conversion accounts for the gutter (both pages' inner padding)
      if (img.x - bm < 0) {
        leftEngine.addImage({ ...baseProps, x: cx + pageWidth });
      }
    }

    const rightResult = rightEngine.compute();
    const leftResult = leftEngine.compute();

    // Concatenate: right page first, then left page (vertical-rl reading order)
    const totalLen = rightResult.lineWidths.length + leftResult.lineWidths.length;
    const lineWidths = new Float32Array(totalLen);
    lineWidths.set(rightResult.lineWidths, 0);
    lineWidths.set(leftResult.lineWidths, rightResult.lineWidths.length);

    return {
      rightSlots: rightResult.slots,
      leftSlots: leftResult.slots,
      lineWidths,
      rightSlotCount: rightResult.slots.length,
      rightAffected: rightResult.affected,
      leftAffected: leftResult.affected,
    };
  }
}
