import type { ColumnSlot } from '../exclusion.js';
import type { ParagraphMeasure } from '../paginate.js';
import type { LineMetric, LineMetricsResult, RenderEntry } from './types.js';

/** Style overrides for a specific heading level. */
export interface HeadingStyle {
  /** Scale factor for heading font size relative to base fontSize. */
  scale?: number;
  /** Gap after this heading in em units (based on base fontSize). */
  gapAfterEm?: number;
}

/** Options for computing paragraph measures. */
export interface MeasureOptions {
  /** Base font size in pixels. */
  fontSize: number;
  /** Line spacing multiplier. */
  lineSpacing?: number;
  /**
   * Line spacing multiplier.
   * @deprecated Use `lineSpacing`; retained as a v0.x compatibility alias.
   */
  lineHeight?: number;
  /**
   * Scale factor for heading font size (applies to all heading levels
   * unless overridden by `headingStyles`).
   * @defaultValue 1.4
   */
  headingScale?: number;
  /** Gap before body paragraphs in em units. @defaultValue 0.4 */
  paragraphGapEm?: number;
  /**
   * Gap after a heading paragraph in em units (applies to all heading levels
   * unless overridden by `headingStyles`).
   * @defaultValue 1.2
   */
  headingGapEm?: number;
  /**
   * Per-level heading style overrides. Keys are heading levels (1–6).
   * Each level can override `scale` and `gapAfterEm`.
   */
  headingStyles?: Record<number, HeadingStyle>;
}

/** Returns whether an entry should use heading metrics. */
function isHeadingEntry(entry: RenderEntry): boolean {
  return entry.headingLevel != null || entry.isHeading === true;
}

/**
 * Builds paragraph measures from render entries for use with `paginate()`.
 *
 * Computes line pitch (font size x line spacing) and inter-paragraph gaps
 * based on whether each paragraph is a heading or body text.
 *
 * @param entries - Render entries for each paragraph.
 * @param options - Font size, line spacing, and paragraph gap configuration.
 * @returns Array of paragraph measures suitable for `paginate()`.
 */
export function buildParagraphMeasures(
  entries: RenderEntry[],
  options: MeasureOptions,
): ParagraphMeasure[] {
  const {
    fontSize,
    headingScale = 1.4,
    paragraphGapEm = 0.4,
    headingGapEm = 1.2,
    headingStyles,
  } = options;
  const lineSpacing = resolveLineSpacing(options);

  const basePitch = fontSize * lineSpacing;
  const paragraphGap = fontSize * paragraphGapEm;

  /** Resolve scale for a heading entry. Legacy `isHeading` uses generic heading settings. */
  function resolveScale(entry: RenderEntry): number {
    return entry.headingLevel != null
      ? (headingStyles?.[entry.headingLevel]?.scale ?? headingScale)
      : headingScale;
  }

  /** Resolve gapAfterEm for a heading entry. Legacy `isHeading` uses generic heading settings. */
  function resolveGapAfter(entry: RenderEntry): number {
    return entry.headingLevel != null
      ? (headingStyles?.[entry.headingLevel]?.gapAfterEm ?? headingGapEm)
      : headingGapEm;
  }

  return entries.map((entry, i) => {
    const lineCount = entry.breakPoints.length + 1;
    const isHeading = isHeadingEntry(entry);

    // Line pitch for this paragraph
    let linePitch: number;
    if (isHeading) {
      const scale = resolveScale(entry);
      const headingFontSize = Math.round(fontSize * scale);
      linePitch = headingFontSize * lineSpacing;
    } else {
      linePitch = basePitch;
    }

    // Gap before this paragraph
    let gapBefore: number;
    if (i > 0) {
      const prev = entries[i - 1];
      gapBefore = isHeadingEntry(prev) ? fontSize * resolveGapAfter(prev) : paragraphGap;
    } else {
      gapBefore = paragraphGap;
    }

    return { lineCount, linePitch, gapBefore };
  });
}

// ── Exclusion layout helpers ──

/**
 * Computes per-line layout metrics and cumulative x-offsets from render entries.
 *
 * Used for exclusion-mode rendering where column positions must account for
 * heading pitch differences and paragraph gaps. The cumulative offsets enable
 * adjusting image coordinates before passing them to the exclusion engine.
 *
 * @param entries - Render entries for each paragraph.
 * @param options - Font size, line spacing, and paragraph gap configuration.
 * @returns Per-line metrics array, cumulative offsets, and base line pitch.
 */
export function buildLineMetrics(
  entries: RenderEntry[],
  options: MeasureOptions,
): LineMetricsResult {
  const {
    fontSize,
    headingScale = 1.4,
    paragraphGapEm = 0.4,
    headingGapEm = 1.2,
    headingStyles,
  } = options;
  const lineSpacing = resolveLineSpacing(options);

  const basePitch = fontSize * lineSpacing;
  const paragraphGap = fontSize * paragraphGapEm;

  function resolveScale(entry: RenderEntry): number {
    return entry.headingLevel != null
      ? (headingStyles?.[entry.headingLevel]?.scale ?? headingScale)
      : headingScale;
  }
  function resolveGapAfter(entry: RenderEntry): number {
    return entry.headingLevel != null
      ? (headingStyles?.[entry.headingLevel]?.gapAfterEm ?? headingGapEm)
      : headingGapEm;
  }

  const metrics: LineMetric[] = [];
  const offsetList: number[] = [];
  let prevPitch = basePitch;

  for (let pi = 0; pi < entries.length; pi++) {
    const entry = entries[pi];
    const lineCount = entry.breakPoints.length + 1;
    const isHeading = isHeadingEntry(entry);
    const pitch = isHeading ? Math.round(fontSize * resolveScale(entry)) * lineSpacing : basePitch;

    for (let li = 0; li < lineCount; li++) {
      let gapBefore = 0;
      if (li === 0 && pi > 0) {
        const prev = entries[pi - 1];
        gapBefore = isHeadingEntry(prev) ? fontSize * resolveGapAfter(prev) : paragraphGap;
      }

      if (metrics.length === 0) {
        offsetList.push(0);
      } else {
        offsetList.push(offsetList[offsetList.length - 1] + (prevPitch - basePitch) + gapBefore);
      }

      metrics.push({ pitch, gapBefore, headingLevel: entry.headingLevel });
      prevPitch = pitch;
    }
  }

  return { metrics, offsets: new Float32Array(offsetList), linePitch: basePitch };
}

function resolveLineSpacing(options: MeasureOptions): number {
  return options.lineSpacing ?? options.lineHeight ?? 1;
}

/**
 * Counts how many lines fit within a page width, accounting for per-line pitch
 * and paragraph gaps. The first line on a page uses only its pitch (no gap).
 *
 * @param metrics - Per-line metrics from {@link buildLineMetrics}.
 * @param startIdx - Index of the first line to pack.
 * @param pageWidth - Available page width in pixels.
 * @returns Number of lines that fit.
 */
export function packPageLines(metrics: LineMetric[], startIdx: number, pageWidth: number): number {
  let count = 0;
  let used = 0;
  while (startIdx + count < metrics.length) {
    const m = metrics[startIdx + count];
    const addition = count === 0 ? m.pitch : m.gapBefore + m.pitch;
    if (used + addition > pageWidth + 0.5) break;
    used += addition;
    count++;
  }
  if (count === 0 && startIdx < metrics.length) return 1;
  return count;
}

/**
 * Builds column slots for a normal (non-image) page with per-line pitch and
 * paragraph gap offsets baked into each slot's `xPos`.
 *
 * @param metrics - Per-line metrics from {@link buildLineMetrics}.
 * @param startIdx - Index of the first line on this page.
 * @param count - Number of lines to include.
 * @param columnHeight - Height of each column (vertical content height).
 * @returns Array of column slots suitable for absolute positioning.
 */
export function buildColumnSlots(
  metrics: LineMetric[],
  startIdx: number,
  count: number,
  columnHeight: number,
): ColumnSlot[] {
  const slots: ColumnSlot[] = [];
  let xPos = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      xPos += metrics[startIdx + i - 1].pitch;
      xPos += metrics[startIdx + i].gapBefore;
    }
    slots.push({ xPos, yStart: 0, height: columnHeight });
  }
  return slots;
}

/**
 * Adjusts exclusion engine slots by adding heading pitch excess and paragraph
 * gaps. The exclusion engine assumes uniform line pitch; this function corrects
 * the slot positions to account for heading lines being wider and inter-paragraph
 * spacing.
 *
 * The exclusion engine also derives its column count from the uniform base
 * pitch (`floor(contentWidth / basePitch)`), so a spread with a wider-than-body
 * heading produces more columns than physically fit once the heading excess is
 * re-added here. When `contentWidth` is supplied, trailing columns whose
 * adjusted physical extent (`xPos + pitch`) would overflow the content box are
 * dropped, so the caller can reflow those lines onto the following page/spread
 * instead of letting them clip past the page's leading edge. The slot array is
 * ordered by non-decreasing `xPos`, so the overflowing slots are always a
 * trailing run. At least one slot is always kept so layout makes progress.
 *
 * @param slots - Column slots from the exclusion engine.
 * @param metrics - Per-line metrics from {@link buildLineMetrics}.
 * @param startIdx - Global line index of the first slot.
 * @param basePitch - Base body line pitch (from {@link LineMetricsResult.linePitch}).
 * @param contentWidth - Page content-box width (px). When set, overflowing
 *   trailing slots are dropped. When omitted, no trimming is applied.
 * @returns New array of adjusted slots (input is not mutated).
 */
export function adjustExclusionSlots(
  slots: ColumnSlot[],
  metrics: LineMetric[],
  startIdx: number,
  basePitch: number,
  contentWidth?: number,
): ColumnSlot[] {
  const adjusted: ColumnSlot[] = [];
  let extraOffset = 0;
  for (let i = 0; i < slots.length; i++) {
    const li = startIdx + i;
    if (li >= metrics.length) break;
    // Only accumulate pitch excess and paragraph gaps when moving to a
    // new physical column.  When an image splits a column into multiple
    // gaps (slots), they share the same xPos and should receive the same
    // offset — incrementing here would double-count the heading excess.
    if (i > 0 && slots[i].xPos !== slots[i - 1].xPos) {
      extraOffset += metrics[li - 1].pitch - basePitch;
      extraOffset += metrics[li].gapBefore;
    }
    const xPos = slots[i].xPos + extraOffset;
    // Drop trailing columns that would overflow the content box once the
    // heading excess has been re-applied. Keep at least one slot so the
    // page is never empty (which would stall the line walk).
    if (
      contentWidth != null &&
      adjusted.length > 0 &&
      xPos + metrics[li].pitch > contentWidth + 0.5
    ) {
      break;
    }
    adjusted.push({ xPos, yStart: slots[i].yStart, height: slots[i].height });
  }
  return adjusted;
}

/**
 * Returns the cumulative x-offset at a given column within a spread.
 * Used to adjust image x-coordinates before passing them to the exclusion engine,
 * compensating for heading pitch differences and paragraph gaps.
 *
 * @param offsets - Cumulative offsets from {@link LineMetricsResult.offsets}.
 * @param spreadStartLine - Global line index of the spread's first line.
 * @param col - Column index within the spread (0 = rightmost).
 * @returns Relative x-offset in pixels.
 */
export function getImageXOffset(
  offsets: Float32Array,
  spreadStartLine: number,
  col: number,
): number {
  return relativeOffsetAt(offsets, spreadStartLine, col);
}

/**
 * Finds the column index at a given physical distance from the right content edge,
 * accounting for heading pitch differences and paragraph gaps.
 *
 * The physical position of column `col` is `col * basePitch + offset(col)`.
 * A naive `floor(fromRight / basePitch)` overestimates the column index when
 * heading lines are wider than body lines. This function refines the estimate
 * downward until the physical position fits within `fromRight`.
 *
 * @param offsets - Cumulative offsets from {@link LineMetricsResult.offsets}.
 * @param spreadStartLine - Global line index of the spread's first line.
 * @param fromRight - Physical distance from the right content edge (px).
 * @param basePitch - Base body line pitch (px).
 * @returns Column index at that physical distance.
 */
export function findPhysicalColumn(
  offsets: Float32Array,
  spreadStartLine: number,
  fromRight: number,
  basePitch: number,
): number {
  let col = Math.max(0, Math.floor(fromRight / basePitch));
  const maxCol = Math.max(0, offsets.length - spreadStartLine - 1);
  while (col > 0) {
    const physicalPos = col * basePitch + relativeOffsetAt(offsets, spreadStartLine, col);
    if (physicalPos <= fromRight) break;
    col--;
  }
  while (col < maxCol) {
    const next = col + 1;
    const physicalPos = next * basePitch + relativeOffsetAt(offsets, spreadStartLine, next);
    if (physicalPos > fromRight) break;
    col = next;
  }
  return col;
}

function relativeOffsetAt(offsets: Float32Array, spreadStartLine: number, col: number): number {
  if (offsets.length === 0 || spreadStartLine >= offsets.length) return 0;
  const startOffset = offsets[spreadStartLine];
  const globalLine = spreadStartLine + col;
  const offsetIndex = Math.min(globalLine, offsets.length - 1);
  return offsets[offsetIndex] - startOffset;
}
