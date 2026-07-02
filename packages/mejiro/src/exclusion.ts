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
 * Computes per-line widths by subtracting exclusion zones from the base line width.
 *
 * Multiple exclusion zones may overlap; their inline sizes are summed per line.
 * The resulting width for any line is clamped to a minimum of 0.
 *
 * @param baseLineWidth - Default line width in pixels.
 * @param lineCount - Number of lines to generate widths for.
 * @param exclusions - Exclusion zones that reduce available line width.
 * @returns A `Float32Array` of per-line widths.
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
      widths[i] = Math.max(0, widths[i] - zone.inlineSize);
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
 * Per-column rendering slot computed from image exclusions.
 *
 * Each slot describes where text should be placed within a column
 * and how much vertical space is available. A single physical column
 * may produce multiple slots (e.g. one above and one below an image).
 */
export interface ColumnSlot {
  /** Horizontal offset from the right edge of the content area (px). */
  xPos: number;
  /** Vertical offset from the top of the content area (px). */
  yStart: number;
  /** Available height for text in this column (px). */
  height: number;
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
 * multiple slots (e.g. one above and one below the image), each
 * with its own line width entry. Text flows through all usable gaps
 * in order, filling the space above, then below the image.
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
   * Computes per-column slots and line widths for the current images.
   *
   * For each physical column, finds **all** contiguous vertical gaps
   * not occupied by any image. Each gap becomes a separate slot.
   * Affected columns may produce multiple slots (and thus multiple
   * entries in `lineWidths`), so `slots.length >= lineCount`.
   *
   * @returns Column slots for rendering and line widths for `computeBreaks()`.
   */
  compute(): { slots: ColumnSlot[]; lineWidths: Float32Array } {
    const { lineWidth, lineCount, linePitch, contentWidth } = this.geometry;
    const minGapHeight = this.geometry.minGapHeight ?? linePitch;
    const slots: ColumnSlot[] = [];

    for (let col = 0; col < lineCount; col++) {
      const gaps = computeColumnGaps(
        col,
        linePitch,
        contentWidth,
        lineWidth,
        this.images,
        minGapHeight,
      );
      for (const gap of gaps) {
        slots.push(gap);
      }
    }

    const widths = new Float32Array(slots.length);
    for (let i = 0; i < slots.length; i++) {
      widths[i] = slots[i].height;
    }

    return { slots, lineWidths: widths };
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
 * @returns Column slots for rendering and line widths for layout.
 */
export function computeExclusionSlots(
  options: ExclusionPageGeometry & {
    /** Image rectangles in content-area coordinates. */
    images: readonly ImageRect[];
  },
): { slots: ColumnSlot[]; lineWidths: Float32Array } {
  const { images, ...geometry } = options;
  const engine = new ExclusionEngine(geometry);
  for (const img of images) {
    engine.addImage(img);
  }
  return engine.compute();
}

/**
 * Computes all usable vertical gaps in a single column
 * after subtracting all overlapping image regions.
 * Returns one slot per gap (possibly multiple per column).
 */
function computeColumnGaps(
  colIndex: number,
  linePitch: number,
  contentW: number,
  lineWidth: number,
  images: readonly ImageRect[],
  minGapHeight: number,
): ColumnSlot[] {
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
    return [{ xPos, yStart: 0, height: lineWidth }];
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

  // Collect all gaps (above, between, below images)
  const gaps: ColumnSlot[] = [];
  let prevEnd = 0;
  for (const [top, bottom] of merged) {
    const gapH = top - prevEnd;
    if (gapH >= minGapHeight) {
      gaps.push({ xPos, yStart: prevEnd, height: gapH });
    }
    prevEnd = bottom;
  }
  const tailGap = lineWidth - prevEnd;
  if (tailGap >= minGapHeight) {
    gaps.push({ xPos, yStart: prevEnd, height: tailGap });
  }

  return gaps;
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
    };
  }
}
