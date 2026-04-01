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
  /** Line height multiplier. */
  lineHeight: number;
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

/** Returns the effective heading level for an entry (undefined for body text). */
function entryHeadingLevel(entry: RenderEntry): number | undefined {
  return entry.headingLevel ?? (entry.isHeading ? 1 : undefined);
}

/**
 * Builds paragraph measures from render entries for use with `paginate()`.
 *
 * Computes line pitch (font size x line height) and inter-paragraph gaps
 * based on whether each paragraph is a heading or body text.
 *
 * @param entries - Render entries for each paragraph.
 * @param options - Font size, line height, and spacing configuration.
 * @returns Array of paragraph measures suitable for `paginate()`.
 */
export function buildParagraphMeasures(
  entries: RenderEntry[],
  options: MeasureOptions,
): ParagraphMeasure[] {
  const {
    fontSize,
    lineHeight,
    headingScale = 1.4,
    paragraphGapEm = 0.4,
    headingGapEm = 1.2,
    headingStyles,
  } = options;

  const basePitch = fontSize * lineHeight;
  const paragraphGap = fontSize * paragraphGapEm;

  /** Resolve scale for a heading level. */
  function resolveScale(level: number): number {
    return headingStyles?.[level]?.scale ?? headingScale;
  }

  /** Resolve gapAfterEm for a heading level. */
  function resolveGapAfter(level: number): number {
    return headingStyles?.[level]?.gapAfterEm ?? headingGapEm;
  }

  return entries.map((entry, i) => {
    const lineCount = entry.breakPoints.length + 1;
    const level = entryHeadingLevel(entry);

    // Line pitch for this paragraph
    let linePitch: number;
    if (level != null) {
      const scale = resolveScale(level);
      const headingFontSize = Math.round(fontSize * scale);
      linePitch = headingFontSize * lineHeight;
    } else {
      linePitch = basePitch;
    }

    // Gap before this paragraph
    let gapBefore: number;
    if (i > 0) {
      const prevLevel = entryHeadingLevel(entries[i - 1]);
      gapBefore = prevLevel != null ? fontSize * resolveGapAfter(prevLevel) : paragraphGap;
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
 * @param options - Font size, line height, and spacing configuration.
 * @returns Per-line metrics array, cumulative offsets, and base line pitch.
 */
export function buildLineMetrics(
  entries: RenderEntry[],
  options: MeasureOptions,
): LineMetricsResult {
  const {
    fontSize,
    lineHeight,
    headingScale = 1.4,
    paragraphGapEm = 0.4,
    headingGapEm = 1.2,
    headingStyles,
  } = options;

  const basePitch = fontSize * lineHeight;
  const paragraphGap = fontSize * paragraphGapEm;

  function resolveScale(level: number): number {
    return headingStyles?.[level]?.scale ?? headingScale;
  }
  function resolveGapAfter(level: number): number {
    return headingStyles?.[level]?.gapAfterEm ?? headingGapEm;
  }

  const metrics: LineMetric[] = [];
  const offsetList: number[] = [];
  let prevPitch = basePitch;

  for (let pi = 0; pi < entries.length; pi++) {
    const entry = entries[pi];
    const lineCount = entry.breakPoints.length + 1;
    const level = entryHeadingLevel(entry);
    const pitch =
      level != null ? Math.round(fontSize * resolveScale(level)) * lineHeight : basePitch;

    for (let li = 0; li < lineCount; li++) {
      let gapBefore = 0;
      if (li === 0 && pi > 0) {
        const prevLevel = entryHeadingLevel(entries[pi - 1]);
        gapBefore = prevLevel != null ? fontSize * resolveGapAfter(prevLevel) : paragraphGap;
      }

      if (metrics.length === 0) {
        offsetList.push(0);
      } else {
        offsetList.push(offsetList[offsetList.length - 1] + (prevPitch - basePitch) + gapBefore);
      }

      metrics.push({ pitch, gapBefore, headingLevel: level });
      prevPitch = pitch;
    }
  }

  return { metrics, offsets: new Float32Array(offsetList), linePitch: basePitch };
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
 * @param slots - Column slots from the exclusion engine.
 * @param metrics - Per-line metrics from {@link buildLineMetrics}.
 * @param startIdx - Global line index of the first slot.
 * @param basePitch - Base body line pitch (from {@link LineMetricsResult.linePitch}).
 * @returns New array of adjusted slots (input is not mutated).
 */
export function adjustExclusionSlots(
  slots: ColumnSlot[],
  metrics: LineMetric[],
  startIdx: number,
  basePitch: number,
): ColumnSlot[] {
  const adjusted: ColumnSlot[] = [];
  let extraOffset = 0;
  for (let i = 0; i < slots.length; i++) {
    const li = startIdx + i;
    if (li >= metrics.length) break;
    if (i > 0) {
      extraOffset += metrics[li - 1].pitch - basePitch;
      extraOffset += metrics[li].gapBefore;
    }
    adjusted.push({
      xPos: slots[i].xPos + extraOffset,
      yStart: slots[i].yStart,
      height: slots[i].height,
    });
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
  const startOffset = spreadStartLine < offsets.length ? offsets[spreadStartLine] : 0;
  const globalLine = spreadStartLine + col;
  const colOffset = globalLine < offsets.length ? offsets[globalLine] : startOffset;
  return colOffset - startOffset;
}
