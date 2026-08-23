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

/**
 * Band-ordered slots for eight columns of 400px inline size with one image
 * covering columns 2-5 between y=150 and y=250.
 *
 * The engine splits those four columns into an upper and a lower gap and emits
 * the whole upper band before the lower one, so columns 2-5 each appear twice
 * with four other slots in between.
 */
function bandOrderedSlots(): ColumnSlot[] {
  const { slots } = computeExclusionSlots({
    lineWidth: LINE_WIDTH,
    lineCount: COLUMNS,
    linePitch: PITCH,
    contentWidth: PITCH * COLUMNS,
    images: [{ x: 60, y: 150, w: 120, h: 100 }],
  });
  return slots;
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

describe('adjustExclusionSlots with band-ordered slots', () => {
  it('receives columns 2-5 twice with the rest of the upper band in between', () => {
    const slots = bandOrderedSlots();

    expect(slots.map((s) => s.columnIndex)).toEqual([0, 1, 2, 3, 4, 5, 2, 3, 4, 5, 6, 7]);
  });

  it('accumulates paragraph gaps once per column, not once per slot', () => {
    const slots = bandOrderedSlots();
    // Gaps on lines 3 and 10 open a new column; the one on line 7 falls on a
    // lower-band slot of a column that is already positioned and must not move it.
    const metrics = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH);

    expect(adjusted.map((s) => s.columnIndex)).toEqual([0, 1, 2, 3, 4, 5, 2, 3, 4, 5, 6, 7]);
    expect(adjusted.map((s) => s.xPos)).toEqual([
      0, 30, 60, 100, 130, 160, 60, 100, 130, 160, 200, 230,
    ]);
  });

  it('keeps both gaps of a column on one physical x position', () => {
    const slots = bandOrderedSlots();
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
    const slots = bandOrderedSlots().map(({ xPos, yStart, height }) => ({ xPos, yStart, height }));
    const metrics = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH);

    expect(adjusted.map((s) => s.xPos)).toEqual([
      0, 30, 60, 100, 130, 160, 60, 100, 130, 160, 200, 230,
    ]);
  });

  it('drops an overflowing column from both of its bands', () => {
    const slots = bandOrderedSlots();
    const metrics = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);

    // Column 4 ends at x=160; column 5 would end at x=190, past the box.
    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH, 165);

    expect(adjusted.map((s) => s.columnIndex)).toEqual([0, 1, 2, 3, 4, 2, 3, 4]);
    expect(adjusted.map((s) => s.yStart)).toEqual([0, 0, 0, 0, 0, 250, 250, 250]);
    expect(adjusted.map((s) => s.xPos)).toEqual([0, 30, 60, 100, 130, 60, 100, 130]);
  });

  it('keeps a column whole when only a later band would overflow', () => {
    const slots = bandOrderedSlots();
    const metrics = metricsWithGaps({}, slots.length);
    // Line 8 carries column 4's lower band. Its pitch alone pushes that one
    // slot past the box, which must not punch a hole into an admitted column.
    metrics[8].pitch = 130;

    const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH, 245);

    expect(adjusted.map((s) => s.columnIndex)).toEqual([0, 1, 2, 3, 4, 5, 2, 3, 4, 5, 6, 7]);
  });

  it('never keeps a column for only part of its gaps', () => {
    const slots = bandOrderedSlots();
    const inputCounts = slotsPerColumn(slots);
    const gapped = metricsWithGaps({ 3: 10, 7: 10, 10: 10 }, slots.length);
    // A tall line on a lower band is the case that tempts a per-slot verdict.
    const tallLowerBand = metricsWithGaps({}, slots.length);
    tallLowerBand[8].pitch = 130;

    for (const metrics of [gapped, tallLowerBand]) {
      for (const contentWidth of [65, 105, 135, 165, 195, 245]) {
        const adjusted = adjustExclusionSlots(slots, metrics, 0, PITCH, contentWidth);

        for (const [col, count] of slotsPerColumn(adjusted)) {
          expect(count).toBe(inputCounts.get(col));
        }
      }
    }
  });
});
