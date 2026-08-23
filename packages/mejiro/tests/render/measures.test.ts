import { describe, expect, it } from 'vitest';
import type { ColumnSlot } from '../../src/exclusion.js';
import {
  adjustExclusionSlots,
  buildColumnSlots,
  buildLineMetrics,
  buildParagraphMeasures,
  findPhysicalColumn,
  getImageXOffset,
  packPageLines,
} from '../../src/render/measures.js';
import type { LineMetric, RenderEntry } from '../../src/render/types.js';

function makeEntry(charCount: number, breakCount: number, headingLevel?: number): RenderEntry {
  return {
    chars: Array.from({ length: charCount }, () => 'あ'),
    breakPoints: new Uint32Array(breakCount),
    inlineAnnotations: [],
    headingLevel,
    isHeading: headingLevel != null,
  };
}

describe('buildParagraphMeasures', () => {
  it('computes body paragraph measures', () => {
    const entries = [makeEntry(20, 2)]; // 3 lines
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures).toEqual([{ lineCount: 3, linePitch: 16 * 1.8, gapBefore: 16 * 0.4 }]);
  });

  it('computes heading paragraph measures with default scale', () => {
    const entries = [makeEntry(5, 0, 1)]; // 1 line, h1
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    const headingFontSize = Math.round(16 * 1.4);
    expect(measures).toEqual([
      { lineCount: 1, linePitch: headingFontSize * 1.8, gapBefore: 16 * 0.4 },
    ]);
  });

  it('applies heading gap after a heading paragraph', () => {
    const entries = [
      makeEntry(5, 0, 1), // h1
      makeEntry(20, 2), // body after heading
    ];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures[1].gapBefore).toBe(16 * 1.2);
  });

  it('applies paragraph gap after a body paragraph', () => {
    const entries = [
      makeEntry(20, 2), // body
      makeEntry(20, 2), // body
    ];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures[1].gapBefore).toBe(16 * 0.4);
  });

  it('uses custom scale and gap options', () => {
    const entries = [makeEntry(5, 0, 1)];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 20,
      lineHeight: 2.0,
      headingScale: 1.5,
      paragraphGapEm: 0.5,
      headingGapEm: 1.5,
    });
    const headingFontSize = Math.round(20 * 1.5);
    expect(measures).toEqual([
      { lineCount: 1, linePitch: headingFontSize * 2.0, gapBefore: 20 * 0.5 },
    ]);
  });

  it('returns empty array for empty input', () => {
    const measures = buildParagraphMeasures([], {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures).toEqual([]);
  });

  // ── headingLevel + headingStyles tests ──

  it('uses per-level headingStyles scale', () => {
    const entries = [makeEntry(5, 0, 2)]; // h2
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
      headingStyles: {
        1: { scale: 1.6 },
        2: { scale: 1.3 },
      },
    });
    const h2FontSize = Math.round(16 * 1.3);
    expect(measures[0].linePitch).toBe(h2FontSize * 1.8);
  });

  it('uses per-level headingStyles gapAfterEm', () => {
    const entries = [
      makeEntry(5, 0, 2), // h2
      makeEntry(20, 2), // body
    ];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
      headingStyles: {
        2: { gapAfterEm: 2.0 },
      },
    });
    expect(measures[1].gapBefore).toBe(16 * 2.0);
  });

  it('falls back to headingScale when headingStyles has no entry for the level', () => {
    const entries = [makeEntry(5, 0, 3)]; // h3, no headingStyles for level 3
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
      headingScale: 1.5,
      headingStyles: {
        1: { scale: 2.0 },
      },
    });
    const h3FontSize = Math.round(16 * 1.5); // falls back to headingScale
    expect(measures[0].linePitch).toBe(h3FontSize * 1.8);
  });

  it('supports legacy isHeading without headingLevel', () => {
    const entry: RenderEntry = {
      chars: Array.from({ length: 5 }, () => 'あ'),
      breakPoints: new Uint32Array(0),
      inlineAnnotations: [],
      isHeading: true,
    };
    const measures = buildParagraphMeasures([entry, makeEntry(20, 2)], {
      fontSize: 16,
      lineHeight: 1.8,
      headingScale: 1.25,
      headingGapEm: 1.1,
      headingStyles: { 1: { scale: 1.8, gapAfterEm: 1.6 } },
    });
    const headingFontSize = Math.round(16 * 1.25);
    expect(measures[0].linePitch).toBe(headingFontSize * 1.8);
    expect(measures[1].gapBefore).toBe(16 * 1.1);
  });

  it('differentiates h1 and h3 with headingStyles', () => {
    const entries = [
      makeEntry(5, 0, 1), // h1
      makeEntry(10, 1, 3), // h3
      makeEntry(20, 2), // body
    ];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
      headingStyles: {
        1: { scale: 1.6, gapAfterEm: 1.4 },
        3: { scale: 1.2, gapAfterEm: 0.8 },
      },
    });

    // h1 pitch
    expect(measures[0].linePitch).toBe(Math.round(16 * 1.6) * 1.8);
    // h3 pitch
    expect(measures[1].linePitch).toBe(Math.round(16 * 1.2) * 1.8);
    // gap after h1 → h3
    expect(measures[1].gapBefore).toBe(16 * 1.4);
    // gap after h3 → body
    expect(measures[2].gapBefore).toBe(16 * 0.8);
  });
});

// ── Exclusion layout helpers ──

const baseOpts = { fontSize: 16, lineHeight: 1.8 };
const basePitch = 16 * 1.8; // 28.8

describe('buildLineMetrics', () => {
  it('computes body paragraph metrics', () => {
    const entries = [makeEntry(20, 2)]; // 3 lines
    const { metrics, offsets, linePitch } = buildLineMetrics(entries, baseOpts);
    expect(metrics).toHaveLength(3);
    expect(linePitch).toBe(basePitch);
    for (const m of metrics) {
      expect(m.pitch).toBe(basePitch);
      expect(m.headingLevel).toBeUndefined();
    }
    // All offsets should be 0 (no heading, single paragraph)
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(0);
    expect(offsets[2]).toBe(0);
  });

  it('computes heading + body metrics with offsets', () => {
    const entries = [
      makeEntry(5, 0, 1), // h1, 1 line
      makeEntry(20, 2), // body, 3 lines
    ];
    const { metrics, offsets } = buildLineMetrics(entries, {
      ...baseOpts,
      headingStyles: { 1: { scale: 1.6, gapAfterEm: 1.4 } },
    });
    expect(metrics).toHaveLength(4);
    const h1Pitch = Math.round(16 * 1.6) * 1.8;
    expect(metrics[0].pitch).toBe(h1Pitch);
    expect(metrics[1].pitch).toBe(basePitch);

    // Offset at line 0 = 0
    expect(offsets[0]).toBe(0);
    // Offset at line 1 = (h1Pitch - basePitch) + headingGap
    const headingGap = 16 * 1.4;
    expect(offsets[1]).toBeCloseTo(h1Pitch - basePitch + headingGap);
    // Offset at line 2 = same (no additional excess for body lines)
    expect(offsets[2]).toBeCloseTo(offsets[1]);
  });

  it('returns empty for empty input', () => {
    const { metrics, offsets } = buildLineMetrics([], baseOpts);
    expect(metrics).toHaveLength(0);
    expect(offsets).toHaveLength(0);
  });
});

describe('packPageLines', () => {
  it('packs body lines into a page', () => {
    const { metrics } = buildLineMetrics([makeEntry(100, 4)], baseOpts); // 5 lines
    // Page width = 3 * basePitch → should fit 3 lines
    const count = packPageLines(metrics, 0, basePitch * 3);
    expect(count).toBe(3);
  });

  it('accounts for heading pitch', () => {
    const entries = [makeEntry(5, 0, 1), makeEntry(100, 9)]; // h1(1) + body(10)
    const { metrics } = buildLineMetrics(entries, {
      ...baseOpts,
      headingStyles: { 1: { scale: 1.6, gapAfterEm: 1.4 } },
    });
    // First line = h1 pitch (wider), so fewer lines fit
    const countWithHeading = packPageLines(metrics, 0, basePitch * 5);
    const countBodyOnly = packPageLines(metrics, 1, basePitch * 5);
    expect(countWithHeading).toBeLessThan(countBodyOnly);
  });

  it('starts from given index', () => {
    const { metrics } = buildLineMetrics([makeEntry(100, 9)], baseOpts); // 10 lines
    const count = packPageLines(metrics, 5, basePitch * 3);
    expect(count).toBe(3);
  });

  it('returns one line when the first line is wider than the page', () => {
    expect(packPageLines([{ pitch: 120, gapBefore: 0 }], 0, 80)).toBe(1);
  });
});

describe('buildColumnSlots', () => {
  it('builds slots with correct xPos', () => {
    const { metrics } = buildLineMetrics([makeEntry(100, 4)], baseOpts); // 5 lines
    const slots = buildColumnSlots(metrics, 0, 3, 500);
    expect(slots).toHaveLength(3);
    expect(slots[0].xPos).toBe(0);
    expect(slots[1].xPos).toBeCloseTo(basePitch);
    expect(slots[2].xPos).toBeCloseTo(basePitch * 2);
    for (const s of slots) {
      expect(s.yStart).toBe(0);
      expect(s.height).toBe(500);
    }
  });

  it('includes paragraph gap in xPos', () => {
    const entries = [makeEntry(5, 0), makeEntry(100, 4)]; // 1 + 5 lines
    const { metrics } = buildLineMetrics(entries, baseOpts);
    const slots = buildColumnSlots(metrics, 0, 3, 500);
    // slot 0: xPos = 0 (first line of para 0)
    // slot 1: xPos = pitch[0] + gapBefore[1] = basePitch + paragraphGap
    const paragraphGap = 16 * 0.4;
    expect(slots[1].xPos).toBeCloseTo(basePitch + paragraphGap);
  });
});

describe('adjustExclusionSlots', () => {
  it('returns unchanged slots for uniform body lines', () => {
    const { metrics } = buildLineMetrics([makeEntry(100, 4)], baseOpts);
    const inputSlots = [
      { xPos: 0, yStart: 0, height: 500 },
      { xPos: basePitch, yStart: 0, height: 500 },
      { xPos: basePitch * 2, yStart: 0, height: 500 },
    ];
    const adjusted = adjustExclusionSlots(inputSlots, metrics, 0, basePitch);
    expect(adjusted[0].xPos).toBe(0);
    expect(adjusted[1].xPos).toBeCloseTo(basePitch);
    expect(adjusted[2].xPos).toBeCloseTo(basePitch * 2);
  });

  it('adds heading pitch excess', () => {
    const entries = [makeEntry(5, 0, 1), makeEntry(100, 9)];
    const { metrics } = buildLineMetrics(entries, {
      ...baseOpts,
      headingStyles: { 1: { scale: 1.6, gapAfterEm: 1.4 } },
    });
    const inputSlots = [
      { xPos: 0, yStart: 0, height: 500 },
      { xPos: basePitch, yStart: 0, height: 400 },
      { xPos: basePitch * 2, yStart: 0, height: 500 },
    ];
    const adjusted = adjustExclusionSlots(inputSlots, metrics, 0, basePitch);
    // First slot unchanged
    expect(adjusted[0].xPos).toBe(0);
    // Second slot shifted by heading pitch excess + gap
    const h1Pitch = Math.round(16 * 1.6) * 1.8;
    const headingGap = 16 * 1.4;
    const expectedShift = h1Pitch - basePitch + headingGap;
    expect(adjusted[1].xPos).toBeCloseTo(basePitch + expectedShift);
    // Preserves yStart and height
    expect(adjusted[1].yStart).toBe(0);
    expect(adjusted[1].height).toBe(400);
  });

  it('keeps same xPos for multi-gap slots within a single column', () => {
    // Heading with 3 lines followed by body text — simulates an image
    // splitting heading columns into two gaps each.
    const entries = [makeEntry(30, 2, 1), makeEntry(100, 4)];
    const { metrics } = buildLineMetrics(entries, {
      ...baseOpts,
      headingStyles: { 1: { scale: 1.6, gapAfterEm: 1.4 } },
    });
    const h1Pitch = Math.round(16 * 1.6) * 1.8;

    // Column 0: two gaps (split by image) → same xPos from exclusion engine
    // Column 1: single gap
    const inputSlots = [
      { xPos: 0, yStart: 0, height: 100 },
      { xPos: 0, yStart: 200, height: 300 },
      { xPos: basePitch, yStart: 0, height: 500 },
    ];
    const adjusted = adjustExclusionSlots(inputSlots, metrics, 0, basePitch);

    // Both gaps at column 0 must have the same adjusted xPos
    expect(adjusted[0].xPos).toBe(0);
    expect(adjusted[1].xPos).toBe(0);
    // Column 1 shifts by one heading pitch excess
    expect(adjusted[2].xPos).toBeCloseTo(basePitch + (h1Pitch - basePitch));
  });

  // Slots arrive in reading order: an image spanning columns 1-2 makes those
  // columns come back a second time after the whole upper band is filled.
  const bandPitch = 30;
  const bandMetrics: LineMetric[] = [
    { pitch: bandPitch, gapBefore: 0 },
    { pitch: bandPitch, gapBefore: 0 },
    { pitch: bandPitch, gapBefore: 0 },
    { pitch: bandPitch, gapBefore: 10 },
    { pitch: bandPitch, gapBefore: 0 },
    { pitch: bandPitch, gapBefore: 0 },
  ];
  const bandSlots: ColumnSlot[] = [
    { xPos: 0, yStart: 0, height: 400, columnIndex: 0 },
    { xPos: bandPitch, yStart: 0, height: 150, columnIndex: 1 },
    { xPos: bandPitch * 2, yStart: 0, height: 150, columnIndex: 2 },
    { xPos: bandPitch, yStart: 250, height: 150, columnIndex: 1 },
    { xPos: bandPitch * 2, yStart: 250, height: 150, columnIndex: 2 },
    { xPos: bandPitch * 3, yStart: 0, height: 400, columnIndex: 3 },
  ];

  it('gives every gap of a column the same xPos when slots come in band order', () => {
    const adjusted = adjustExclusionSlots(bandSlots, bandMetrics, 0, bandPitch);

    expect(adjusted.map((s) => s.xPos)).toEqual([0, 30, 60, 30, 60, 90]);
    expect(adjusted.map((s) => s.columnIndex)).toEqual([0, 1, 2, 1, 2, 3]);
  });

  it('drops an overflowing column from every band instead of truncating the rest', () => {
    // Content box holds columns 0-1 only: column 2 would end at x=90 > 85.
    const adjusted = adjustExclusionSlots(bandSlots, bandMetrics, 0, bandPitch, 85);

    // Column 1 keeps both of its gaps; columns 2 and 3 are dropped entirely.
    expect(adjusted.map((s) => s.columnIndex)).toEqual([0, 1, 1]);
    expect(adjusted.map((s) => s.yStart)).toEqual([0, 0, 250]);
  });
});

describe('getImageXOffset', () => {
  it('returns 0 for col=0', () => {
    const offsets = new Float32Array([0, 10, 20, 30]);
    expect(getImageXOffset(offsets, 0, 0)).toBe(0);
  });

  it('returns relative offset', () => {
    const offsets = new Float32Array([0, 10, 25, 30, 50]);
    // Spread starts at line 1: offset 10. Col 2 → line 3: offset 30.
    expect(getImageXOffset(offsets, 1, 2)).toBe(20); // 30 - 10
  });

  it('handles out-of-bounds gracefully', () => {
    const offsets = new Float32Array([0, 10, 20]);
    // Col beyond array: keep the last known offset instead of jumping back.
    expect(getImageXOffset(offsets, 0, 100)).toBe(20);
    // Spread start beyond array: both fall back to 0
    expect(getImageXOffset(offsets, 100, 0)).toBe(0);
  });
});

describe('findPhysicalColumn', () => {
  it('moves forward when narrower heading offsets make the next column fit', () => {
    const offsets = new Float32Array([0, -10, -20]);

    expect(findPhysicalColumn(offsets, 0, 85, 50)).toBe(2);
  });

  it('terminates on a degenerate pitch or distance', () => {
    const offsets = new Float32Array([0, 10, 20]);

    expect(findPhysicalColumn(offsets, 0, 100, 0)).toBe(0);
    expect(findPhysicalColumn(offsets, 0, 100, Number.NaN)).toBe(0);
    expect(findPhysicalColumn(offsets, 0, 100, -50)).toBe(0);
    expect(findPhysicalColumn(offsets, 0, 100, Number.POSITIVE_INFINITY)).toBe(0);
    expect(findPhysicalColumn(offsets, 0, Number.NaN, 50)).toBe(0);
    expect(findPhysicalColumn(offsets, 0, Number.POSITIVE_INFINITY, 50)).toBe(0);
    expect(findPhysicalColumn(offsets, 0, -100, 50)).toBe(0);
  });

  it('keeps the column inside the spread for an out-of-range distance', () => {
    const offsets = new Float32Array([0, 0, 0, 0]);

    const col = findPhysicalColumn(offsets, 1, 1e9, 0.5);

    expect(Number.isInteger(col)).toBe(true);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThanOrEqual(offsets.length - 1 - 1);
  });
});
