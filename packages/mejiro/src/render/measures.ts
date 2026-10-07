import type { ParagraphKind } from '../book/types.js';
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
   * Heading font scale. A heading without a level takes it as is; levels 1–6
   * scale their {@link DEFAULT_HEADING_STYLES} size in proportion to it,
   * unless `headingStyles` sets the level's own `scale`.
   * @defaultValue 1.4
   */
  headingScale?: number;
  /** Gap before body paragraphs in em units. @defaultValue 0.4 */
  paragraphGapEm?: number;
  /**
   * Gap after a heading paragraph in em units, for every level `headingStyles`
   * does not override. Unset, each level takes its
   * {@link DEFAULT_HEADING_STYLES} gap (`1.2` for a heading without a level).
   */
  headingGapEm?: number;
  /**
   * Per-level heading style overrides. Keys are heading levels (1–6).
   * Each level can override `scale` and `gapAfterEm`.
   */
  headingStyles?: Record<number, HeadingStyle>;
}

/**
 * Default heading style for levels 1–6, in step with the per-level
 * `--mejiro-paragraph-scale` and gaps of the bundled stylesheets.
 *
 * @example
 * ```ts
 * const book = new MejiroBook({
 *   fontFamily: 'serif',
 *   fontSize: 16,
 *   headingStyles: { ...DEFAULT_HEADING_STYLES, 1: { scale: 2, gapAfterEm: 1.6 } },
 * });
 * ```
 */
export const DEFAULT_HEADING_STYLES: Readonly<Record<number, HeadingStyle>> = {
  1: { scale: 1.6, gapAfterEm: 1.4 },
  2: { scale: 1.4, gapAfterEm: 1.2 },
  3: { scale: 1.2, gapAfterEm: 1.0 },
  4: { scale: 1.1, gapAfterEm: 0.8 },
  5: { scale: 1.0, gapAfterEm: 0.6 },
  6: { scale: 1.0, gapAfterEm: 0.6 },
};

/** `headingScale` the {@link DEFAULT_HEADING_STYLES} scales are stated against. */
const DEFAULT_HEADING_SCALE = 1.4;
const DEFAULT_HEADING_GAP_EM = 1.2;

/** Heading fields of a paragraph, whichever layer it comes from. */
export interface HeadingFields {
  /** Heading level (1–6). */
  headingLevel?: number;
  /** Structural classification. */
  kind?: ParagraphKind;
  /** Legacy heading flag of {@link RenderEntry}. */
  isHeading?: boolean;
}

/**
 * The one heading predicate: a paragraph is a heading when it carries a
 * `headingLevel`, is classified `kind: 'heading'`, or sets the legacy
 * `isHeading` flag. Measurement, rendering and reading-time estimates all ask
 * here, so no two of them can disagree about a paragraph.
 */
export function isHeadingParagraph(p: HeadingFields): boolean {
  return p.headingLevel != null || p.kind === 'heading' || p.isHeading === true;
}

/**
 * Resolves the heading classification a {@link RenderParagraph} carries.
 *
 * A heading flagged only by the legacy `isHeading` gets `kind: 'heading'`, so
 * a renderer deriving its class from `kind` and `headingLevel` alone styles it
 * as the heading it was measured as.
 *
 * @returns The paragraph's `isHeading`, `headingLevel` and `kind`, as every
 *   page builder emits them.
 */
export function paragraphHeading(p: HeadingFields): {
  isHeading: boolean;
  headingLevel?: number;
  kind?: ParagraphKind;
} {
  const isHeading = isHeadingParagraph(p);
  const kind = p.kind ?? (isHeading && p.headingLevel == null ? 'heading' : undefined);
  return { isHeading, headingLevel: p.headingLevel, kind };
}

/**
 * Resolves a paragraph's font scale relative to the base font size.
 *
 * Body text is `1`. A level's explicit `headingStyles` entry wins; otherwise
 * the level takes its {@link DEFAULT_HEADING_STYLES} scale in proportion to
 * `headingScale` (so the default `1.4` reproduces the table and any other value
 * resizes every level). A heading without a level takes `headingScale`. This
 * is the only place a heading size is decided: measurement, slot-mode font
 * sizes and the rendered `--mejiro-paragraph-scale` all read it.
 *
 * @param p - Heading fields of the paragraph.
 * @param options - `headingScale` (default `1.4`) and per-level `headingStyles`.
 */
export function resolveHeadingScale(
  p: HeadingFields,
  options: Pick<MeasureOptions, 'headingScale' | 'headingStyles'>,
): number {
  if (!isHeadingParagraph(p)) return 1;
  const headingScale = options.headingScale ?? DEFAULT_HEADING_SCALE;
  const level = p.headingLevel;
  if (level == null) return headingScale;
  const explicit = options.headingStyles?.[level]?.scale;
  if (explicit != null) return explicit;
  const levelDefault = DEFAULT_HEADING_STYLES[level]?.scale;
  if (levelDefault == null) return headingScale;
  return headingScale === DEFAULT_HEADING_SCALE
    ? levelDefault
    : levelDefault * (headingScale / DEFAULT_HEADING_SCALE);
}

function headingGapAfterEm(p: HeadingFields, options: MeasureOptions): number {
  const level = p.headingLevel;
  const explicit = level != null ? options.headingStyles?.[level]?.gapAfterEm : undefined;
  if (explicit != null) return explicit;
  if (options.headingGapEm != null) return options.headingGapEm;
  return (
    (level != null ? DEFAULT_HEADING_STYLES[level]?.gapAfterEm : undefined) ??
    DEFAULT_HEADING_GAP_EM
  );
}

/**
 * Block-start gaps, in base-font em, the bundled stylesheets give structural
 * paragraph kinds in place of `paragraphGapEm`, and the gap a blockquote leaves
 * before whatever follows it. Headings take precedence over both.
 */
const KIND_GAP_BEFORE_EM: Partial<Record<ParagraphKind, number>> = {
  blockquote: 0.8,
  sceneBreak: 1.2,
  figure: 1,
};
const BLOCKQUOTE_GAP_AFTER_EM = 1;

/** Per-paragraph pitch and gap resolution shared by the measure builders. */
export interface ParagraphMetrics {
  /** Body line pitch (font size × line spacing). */
  basePitch: number;
  /** Column pitch of every line of `entry`. */
  pitch(entry: RenderEntry): number;
  /** Gap before the first line of `entry` when `prev` precedes it. */
  gapBefore(entry: RenderEntry, prev: RenderEntry | undefined): number;
}

/**
 * Resolves line pitch and paragraph gaps for `options`. They depend only on
 * each paragraph's kind and heading level, never on its line breaks.
 */
export function paragraphMetrics(options: MeasureOptions): ParagraphMetrics {
  const { fontSize, paragraphGapEm = 0.4 } = options;
  const lineSpacing = resolveLineSpacing(options);
  const basePitch = fontSize * lineSpacing;

  return {
    basePitch,
    pitch: (entry) =>
      isHeadingParagraph(entry)
        ? Math.round(fontSize * resolveHeadingScale(entry, options)) * lineSpacing
        : basePitch,
    gapBefore: (entry, prev) => {
      if (prev == null) return fontSize * paragraphGapEm;
      if (isHeadingParagraph(prev)) return fontSize * headingGapAfterEm(prev, options);
      if (prev.kind === 'blockquote') return fontSize * BLOCKQUOTE_GAP_AFTER_EM;
      const kindGap = isHeadingParagraph(entry)
        ? undefined
        : KIND_GAP_BEFORE_EM[entry.kind ?? 'body'];
      return fontSize * (kindGap ?? paragraphGapEm);
    },
  };
}

/**
 * Builds paragraph measures from render entries for use with `paginate()`.
 *
 * Computes line pitch (font size x line spacing) and the gap before each
 * paragraph. The gap follows the bundled stylesheets: the previous paragraph's
 * heading gap after a heading, `1em` after a blockquote, otherwise the
 * paragraph's own kind gap (`0.8em` blockquote, `1.2em` scene break, `1em`
 * figure) or `paragraphGapEm`.
 *
 * @param entries - Render entries for each paragraph.
 * @param options - Font size, line spacing, and paragraph gap configuration.
 * @returns Array of paragraph measures suitable for `paginate()`.
 */
export function buildParagraphMeasures(
  entries: RenderEntry[],
  options: MeasureOptions,
): ParagraphMeasure[] {
  const metrics = paragraphMetrics(options);
  return entries.map((entry, i) => ({
    lineCount: entry.breakPoints.length + 1,
    linePitch: metrics.pitch(entry),
    gapBefore: metrics.gapBefore(entry, entries[i - 1]),
  }));
}

// ── Exclusion layout helpers ──

/**
 * Computes per-line layout metrics and cumulative x-offsets from render entries.
 *
 * Used for exclusion-mode rendering where column positions must account for
 * heading pitch differences and paragraph gaps. The cumulative offsets enable
 * adjusting image coordinates before passing them to the exclusion engine.
 * Pitches and gaps resolve exactly as in {@link buildParagraphMeasures}.
 *
 * @param entries - Render entries for each paragraph.
 * @param options - Font size, line spacing, and paragraph gap configuration.
 * @returns Per-line metrics array, cumulative offsets, and base line pitch.
 */
export function buildLineMetrics(
  entries: RenderEntry[],
  options: MeasureOptions,
): LineMetricsResult {
  const paragraph = paragraphMetrics(options);
  const { basePitch } = paragraph;

  const metrics: LineMetric[] = [];
  const offsetList: number[] = [];
  let prevPitch = basePitch;

  for (let pi = 0; pi < entries.length; pi++) {
    const entry = entries[pi];
    const lineCount = entry.breakPoints.length + 1;
    const pitch = paragraph.pitch(entry);

    for (let li = 0; li < lineCount; li++) {
      const gapBefore = li === 0 && pi > 0 ? paragraph.gapBefore(entry, entries[pi - 1]) : 0;

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
    slots.push({ xPos, yStart: 0, height: columnHeight, columnIndex: i });
  }
  return slots;
}

/**
 * Returns the physical column index of every slot.
 *
 * Slots produced by this package carry {@link ColumnSlot.columnIndex}. A
 * hand-built array that omits it falls back to ranking the distinct `xPos`
 * values, which recovers the columns of a reading-order array too — the
 * exclusion engine gives every gap of one column the same `xPos`, so equal
 * positions mean the same column however far apart they sit.
 */
function slotColumnIndices(slots: readonly ColumnSlot[]): number[] {
  if (slots.every((slot) => slot.columnIndex != null)) {
    return slots.map((slot) => slot.columnIndex as number);
  }
  const ranks = new Map<number, number>();
  const sorted = [...new Set(slots.map((slot) => slot.xPos))].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    ranks.set(sorted[i], i);
  }
  return slots.map((slot) => ranks.get(slot.xPos) as number);
}

/**
 * Adjusts exclusion engine slots by adding heading pitch excess and paragraph
 * gaps. The exclusion engine assumes uniform line pitch; this function corrects
 * the slot positions to account for heading lines being wider and inter-paragraph
 * spacing.
 *
 * Slots arrive in reading order, so a column split into several gaps by an
 * image is revisited later in the array rather than occupying a contiguous run.
 * The offset of a column is therefore established the first time that column is
 * seen and replayed on every later slot of the same column, keeping all gaps of
 * one column on a single physical x position.
 *
 * The exclusion engine also derives its column count from the uniform base
 * pitch (`floor(contentWidth / basePitch)`), so a spread with a wider-than-body
 * heading produces more columns than physically fit once the heading excess is
 * re-added here. When `contentWidth` is supplied, a column whose adjusted
 * physical extent (`xPos + pitch`) would overflow the content box is dropped —
 * including its gaps further along the reading order — so the caller can reflow
 * those lines onto the following page/spread instead of letting them clip past
 * the page's leading edge. Trimming is decided per column, at that column's
 * first gap, so a column is kept whole or not at all. At least one slot is
 * always kept so layout makes progress.
 *
 * @param slots - Column slots from the exclusion engine.
 * @param metrics - Per-line metrics from {@link buildLineMetrics}.
 * @param startIdx - Global line index of the first slot.
 * @param basePitch - Base body line pitch (from {@link LineMetricsResult.linePitch}).
 * @param contentWidth - Page content-box width (px). When set, overflowing
 *   columns are dropped. When omitted, no trimming is applied.
 * @returns New array of adjusted slots (input is not mutated).
 */
export function adjustExclusionSlots(
  slots: ColumnSlot[],
  metrics: LineMetric[],
  startIdx: number,
  basePitch: number,
  contentWidth?: number,
): ColumnSlot[] {
  const columns = slotColumnIndices(slots);
  const offsetByColumn = new Map<number, number>();
  const droppedColumns = new Set<number>();
  const adjusted: ColumnSlot[] = [];
  let extraOffset = 0;
  let seenColumn = false;
  for (let i = 0; i < slots.length; i++) {
    // Lines are consumed in the order slots are kept, so a dropped column
    // shifts the following slots onto the lines it would have carried.
    const li = startIdx + adjusted.length;
    if (li >= metrics.length) break;
    const column = columns[i];
    if (droppedColumns.has(column)) continue;
    const known = offsetByColumn.get(column);
    const firstGapOfColumn = known == null;
    if (firstGapOfColumn) {
      // Only accumulate pitch excess and paragraph gaps when a new physical
      // column starts; the first column of the page carries no excess.
      if (seenColumn) {
        extraOffset += metrics[li - 1].pitch - basePitch;
        extraOffset += metrics[li].gapBefore;
      }
      offsetByColumn.set(column, extraOffset);
    } else {
      // A later gap of a column already positioned — reuse its offset so every
      // gap of that column lands on the same physical x position.
      extraOffset = known;
    }
    seenColumn = true;
    const xPos = slots[i].xPos + extraOffset;
    // Drop columns that would overflow the content box once the heading excess
    // has been re-applied. The verdict is reached the first time a column is
    // met in reading order and then binds its remaining gaps, so a column is
    // never half-kept — its later bands would otherwise leave a hole that text
    // skips over into a column further left. Keep at least one slot so the page
    // is never empty (which would stall the line walk).
    if (
      firstGapOfColumn &&
      contentWidth != null &&
      adjusted.length > 0 &&
      xPos + metrics[li].pitch > contentWidth + 0.5
    ) {
      droppedColumns.add(column);
      continue;
    }
    adjusted.push({ xPos, yStart: slots[i].yStart, height: slots[i].height, columnIndex: column });
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
 * Degenerate inputs resolve to the first column: a `basePitch` that is not a
 * positive finite number carries no scale to search along, and a non-finite
 * `fromRight` has no column to point at.
 *
 * @param offsets - Cumulative offsets from {@link LineMetricsResult.offsets}.
 * @param spreadStartLine - Global line index of the spread's first line.
 * @param fromRight - Physical distance from the right content edge (px).
 * @param basePitch - Base body line pitch (px).
 * @returns Column index at that physical distance, always a finite integer in
 *   `[0, offsets.length - spreadStartLine - 1]`.
 */
export function findPhysicalColumn(
  offsets: Float32Array,
  spreadStartLine: number,
  fromRight: number,
  basePitch: number,
): number {
  const maxCol = Math.max(0, offsets.length - spreadStartLine - 1);
  if (!(basePitch > 0 && Number.isFinite(basePitch) && Number.isFinite(fromRight))) return 0;
  let col = Math.min(maxCol, Math.max(0, Math.floor(fromRight / basePitch)));
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
