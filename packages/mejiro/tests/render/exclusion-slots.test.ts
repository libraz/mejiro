import { describe, expect, it } from 'vitest';
import { type ColumnSlot, computeExclusionSlots } from '../../src/exclusion.js';
import { adjustExclusionSlots } from '../../src/render/measures.js';
import type { LineMetric } from '../../src/render/types.js';

/** Column pitch shared by the page geometry and the line metrics below. */
const PITCH = 30;
/** Column count of the modelled page. */
const COLUMNS = 8;
/** Inline size (vertical extent) of a full column. */
const LINE_WIDTH = 400;

/** Engine slots for eight columns of 400px inline size around one image. */
function slotsAround(image: { x: number; y: number; w: number; h: number }): ColumnSlot[] {
  const { slots } = computeExclusionSlots({
    lineWidth: LINE_WIDTH,
    lineCount: COLUMNS,
    linePitch: PITCH,
    contentWidth: PITCH * COLUMNS,
    images: [image],
  });
  return slots;
}

/**
 * An image across the full page width between y=150 and y=250 divides the page
 * into two tiers, so every column appears once in the upper tier and again in
 * the lower one.
 */
function tierOrderedSlots(): ColumnSlot[] {
  return slotsAround({ x: 0, y: 150, w: PITCH * COLUMNS, h: 100 });
}

/**
 * An image over columns 2-5 only leaves the page one tier: each of those
 * columns is read above and then below the image before the next column.
 */
function columnOrderedSlots(): ColumnSlot[] {
  return slotsAround({ x: 60, y: 150, w: 120, h: 100 });
}

/** Uniform body-pitch metrics with a paragraph gap on the given line indices. */
function metricsWithGaps(gapByLine: Record<number, number>, lineCount: number): LineMetric[] {
  return Array.from({ length: lineCount }, (_, i) => ({
    pitch: PITCH,
    gapBefore: gapByLine[i] ?? 0,
  }));
}

/** Counts how many slots each column contributes. */
function slotsPerColumn(slots: readonly ColumnSlot[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const slot of slots) {
    const col = slot.columnIndex as number;
    counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  return counts;
}

describe('adjustExclusionSlots with tier-ordered slots', () => {
  it('receives every column twice, once per tier', () => {
    const slots = tierOrderedSlots();

    expect(slots.map((s) => s.columnIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('accumulates paragraph gaps once per column, not once per slot', () => {
    const slots = tierOrderedSlots();
    // Gaps on lines 3 and 7 open a new column; the one on line 10 falls on a
    // lower-tier slot of a column that is already positioned and must not move it.
    const metrics = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH);

    const row = [0, 30, 60, 100, 130, 160, 190, 230];
    expect(adjusted.map((s) => s.xPos)).toEqual([...row, ...row]);
  });

  it('keeps both gaps of a column on one physical x position', () => {
    const slots = tierOrderedSlots();
    const metrics = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH);

    const xByColumn = new Map<number, number>();
    for (const slot of adjusted) {
      const col = slot.columnIndex as number;
      const seen = xByColumn.get(col);
      if (seen == null) xByColumn.set(col, slot.xPos);
      else expect(slot.xPos).toBe(seen);
    }
    // Columns still run right-to-left in the order they are first reached.
    const firstReached = [...xByColumn.entries()].map(([, x]) => x);
    for (let i = 1; i < firstReached.length; i++) {
      expect(firstReached[i]).toBeGreaterThan(firstReached[i - 1]);
    }
  });

  it('recovers columns from xPos when slots carry no column index', () => {
    const slots = tierOrderedSlots().map(({ xPos, yStart, height }) => ({ xPos, yStart, height }));
    const metrics = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH);

    const row = [0, 30, 60, 100, 130, 160, 190, 230];
    expect(adjusted.map((s) => s.xPos)).toEqual([...row, ...row]);
  });

  it('drops an overflowing column from both of its tiers', () => {
    const slots = tierOrderedSlots();
    const metrics = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);

    // Column 4 ends at x=160; column 5 would end at x=190, past the box.
    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH, 165);

    expect(adjusted.map((s) => s.columnIndex)).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
    expect(adjusted.map((s) => s.yStart)).toEqual([0, 0, 0, 0, 0, 250, 250, 250, 250, 250]);
    expect(adjusted.map((s) => s.xPos)).toEqual([0, 30, 60, 100, 130, 0, 30, 60, 100, 130]);
  });

  it('keeps a column whole when only a later tier would overflow', () => {
    const slots = tierOrderedSlots();
    const metrics = metricsWithGaps({}, slots.length);
    // Line 8 carries column 0's lower tier. Its pitch alone pushes that one
    // slot past the box, which must not punch a hole into an admitted column.
    metrics[8].pitch = 130;

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH, 245);

    expect(adjusted.map((s) => s.columnIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('never keeps a column for only part of its gaps', () => {
    for (const slots of [tierOrderedSlots(), columnOrderedSlots()]) {
      const inputCounts = slotsPerColumn(slots);
      const gapped = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);
      // A tall line on a lower gap is the case that tempts a per-slot verdict.
      const tallLowerGap = metricsWithGaps({}, slots.length);
      tallLowerGap[8].pitch = 130;

      for (const metrics of [gapped, tallLowerGap]) {
        for (const contentWidth of [65, 105, 135, 165, 195, 245]) {
          const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH, contentWidth);

          for (const [col, count] of slotsPerColumn(adjusted)) {
            expect(count).toBe(inputCounts.get(col));
          }
        }
      }
    }
  });
});

describe('adjustExclusionSlots with column-ordered slots', () => {
  it('receives each split column as two consecutive slots', () => {
    const slots = columnOrderedSlots();

    expect(slots.map((s) => s.columnIndex)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7]);
    expect(slots.map((s) => s.yStart)).toEqual([0, 0, 0, 250, 0, 250, 0, 250, 0, 250, 0, 0]);
  });

  it('moves only the column a paragraph gap opens', () => {
    const slots = columnOrderedSlots();
    // Line 4 opens column 3 and line 10 opens column 6; line 3 is column 2's
    // lower gap, already positioned, so its gap must not shift anything.
    const metrics = metricsWithGaps({ 3: 10, 4: 10, 10: 10 }, slots.length);

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH);

    expect(adjusted.map((s) => s.xPos)).toEqual([
      0, 30, 60, 60, 100, 100, 130, 130, 160, 160, 200, 230,
    ]);
  });

  it('drops an overflowing split column with both of its gaps', () => {
    const slots = columnOrderedSlots();
    const metrics = metricsWithGaps({ 4: 10 }, slots.length);

    // Column 4 ends at x=160; column 5 would end at x=190, past the box.
    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH, 165);

    expect(adjusted.map((s) => s.columnIndex)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});
