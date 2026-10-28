import { describe, expect, it } from 'vitest';
import {
  type ColumnSlot,
  columnGapsAt,
  computeExclusionSlots,
  computeLineWidths,
  ExclusionEngine,
  type ImageRect,
  pageTiers,
  SpreadExclusionEngine,
} from '../src/exclusion.js';
import { computeBreaks } from '../src/layout.js';
import { paginate } from '../src/paginate.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

describe('computeLineWidths', () => {
  it('covers every line a fractional zone touches', () => {
    const widths = computeLineWidths(100, 5, [{ blockStart: 0.5, blockEnd: 3, inlineSize: 40 }]);
    expect([...widths]).toEqual([60, 60, 60, 100, 100]);
    const tail = computeLineWidths(100, 5, [{ blockStart: 2, blockEnd: 3.2, inlineSize: 40 }]);
    expect([...tail]).toEqual([100, 100, 60, 60, 100]);
  });

  it('rejects a NaN zone bound instead of skipping the zone', () => {
    expect(() =>
      computeLineWidths(100, 5, [{ blockStart: Number.NaN, blockEnd: 3, inlineSize: 40 }]),
    ).toThrow(RangeError);
  });

  it('rejects an inline size or base width that cannot yield finite positive widths', () => {
    const zone = { blockStart: 0, blockEnd: 2 };
    for (const inlineSize of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -10,
    ]) {
      expect(
        () => computeLineWidths(100, 3, [{ ...zone, inlineSize }]),
        String(inlineSize),
      ).toThrow(RangeError);
    }
    for (const base of [Number.NaN, Number.POSITIVE_INFINITY, 0, -100]) {
      expect(() => computeLineWidths(base, 3, []), String(base)).toThrow(RangeError);
    }
    // Every accepted call returns finite widths of at least 1px.
    const widths = computeLineWidths(100, 3, [{ ...zone, inlineSize: 500 }]);
    expect([...widths].every((w) => Number.isFinite(w) && w >= 1)).toBe(true);
  });

  it('returns uniform widths when no exclusions', () => {
    const widths = computeLineWidths(100, 5, []);
    expect([...widths]).toEqual([100, 100, 100, 100, 100]);
  });

  it('subtracts exclusion inline size from affected lines', () => {
    const widths = computeLineWidths(100, 5, [{ blockStart: 1, blockEnd: 3, inlineSize: 30 }]);
    expect([...widths]).toEqual([100, 70, 70, 100, 100]);
  });

  it('handles multiple overlapping exclusions', () => {
    const widths = computeLineWidths(100, 5, [
      { blockStart: 0, blockEnd: 3, inlineSize: 20 },
      { blockStart: 2, blockEnd: 5, inlineSize: 30 },
    ]);
    // line 0: 100-20=80, line 1: 100-20=80, line 2: 100-20-30=50, line 3: 100-30=70, line 4: 100-30=70
    expect([...widths]).toEqual([80, 80, 50, 70, 70]);
  });

  it('clamps to a positive width when exclusion exceeds line width', () => {
    const widths = computeLineWidths(50, 3, [{ blockStart: 0, blockEnd: 3, inlineSize: 80 }]);
    // computeBreaks rejects non-positive line widths, so a fully covered line
    // keeps a small positive width instead of collapsing to 0.
    for (const w of widths) expect(w).toBeGreaterThan(0);
  });

  it('produces a computeBreaks-safe array for a full-height exclusion', () => {
    const text = toCodepoints('あいうえおかきくけこ');
    const lineWidths = computeLineWidths(50, 3, [{ blockStart: 0, blockEnd: 3, inlineSize: 50 }]);
    for (const w of lineWidths) expect(w).toBeGreaterThan(0);
    expect(() =>
      computeBreaks({
        text,
        advances: uniformAdvances(text.length, 16),
        lineWidth: 50,
        lineWidths,
      }),
    ).not.toThrow();
  });

  it('handles out-of-range exclusion zones gracefully', () => {
    const widths = computeLineWidths(100, 3, [{ blockStart: -2, blockEnd: 10, inlineSize: 25 }]);
    expect([...widths]).toEqual([75, 75, 75]);
  });
});

describe('computeBreaks with per-line widths', () => {
  it('uses per-line widths for different break points', () => {
    // 20 chars, 16px each. Line 0: width 80 (5 chars), Line 1: width 48 (3 chars), rest: width 80
    const text = toCodepoints('あいうえおかきくけこさしすせそたちつてと');
    const lineWidths = new Float32Array([80, 48, 80, 80, 80, 80, 80]);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      lineWidths,
    });
    const bp = [...result.breakPoints];
    // Line 0: 5 chars (0-4), break at 4
    expect(bp[0]).toBe(4);
    // Line 1: 3 chars (5-7), break at 7
    expect(bp[1]).toBe(7);
    // Line 2: back to 5 chars (8-12), break at 12
    expect(bp[2]).toBe(12);
  });

  it('falls back to lineWidth for lines beyond lineWidths array', () => {
    // 15 chars, 16px each. lineWidths only specifies 1 line.
    const text = toCodepoints('あいうえおかきくけこさしすせそ');
    const lineWidths = new Float32Array([48]); // Only line 0 is narrow
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      lineWidths,
    });
    const bp = [...result.breakPoints];
    // Line 0: 48/16 = 3 chars (0-2), break at 2
    expect(bp[0]).toBe(2);
    // Line 1+: 80/16 = 5 chars, break at 7
    expect(bp[1]).toBe(7);
  });

  it('returns lineWidths in result when per-line widths are provided', () => {
    const text = toCodepoints('あいうえおかきくけこ');
    const lineWidths = new Float32Array([48, 80, 80]);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      lineWidths,
    });
    expect(result.lineWidths).toBeDefined();
    // Each entry should be the width used for that line
    const lw = result.lineWidths as Float32Array;
    expect(lw[0]).toBe(48);
    // Remaining lines fall back or use specified
    for (const w of [...lw].slice(1)) {
      expect(w).toBe(80);
    }
  });

  it('does not return lineWidths when per-line widths are not provided', () => {
    const text = toCodepoints('あいうえおかきくけこ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
    });
    expect(result.lineWidths).toBeUndefined();
  });

  it('backward compatible — existing tests still pass with lineWidth only', () => {
    const text = toCodepoints('あいうえおかきくけこ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
    });
    // 10 chars, 5 per line → 1 break at index 4
    expect([...result.breakPoints]).toEqual([4]);
  });
});

describe('computeBreaks with exclusion zones (integration)', () => {
  it('flows text around an exclusion zone', () => {
    // Simulate an image occupying 32px on lines 1-2 (out of 80px base)
    const text = toCodepoints('あいうえおかきくけこさしすせそたちつてと');
    const lineWidths = computeLineWidths(80, 10, [{ blockStart: 1, blockEnd: 3, inlineSize: 32 }]);
    // Line 0: 80px (5 chars), Lines 1-2: 48px (3 chars), Lines 3+: 80px (5 chars)
    expect(lineWidths[0]).toBe(80);
    expect(lineWidths[1]).toBe(48);
    expect(lineWidths[2]).toBe(48);
    expect(lineWidths[3]).toBe(80);

    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      lineWidths,
    });
    const bp = [...result.breakPoints];
    expect(bp[0]).toBe(4); // Line 0: 5 chars
    expect(bp[1]).toBe(7); // Line 1: 3 chars (narrowed)
    expect(bp[2]).toBe(10); // Line 2: 3 chars (narrowed)
    expect(bp[3]).toBe(15); // Line 3: 5 chars (back to normal)
  });

  it('flows text around multiple exclusion zones', () => {
    // Two images: one on lines 0-1 (48px each), another on lines 3-4 (32px each)
    const text = toCodepoints('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ');
    const lineWidths = computeLineWidths(80, 10, [
      { blockStart: 0, blockEnd: 2, inlineSize: 32 },
      { blockStart: 3, blockEnd: 5, inlineSize: 48 },
    ]);
    expect(lineWidths[0]).toBe(48); // narrowed by 32
    expect(lineWidths[1]).toBe(48);
    expect(lineWidths[2]).toBe(80); // normal
    expect(lineWidths[3]).toBe(32); // narrowed by 48
    expect(lineWidths[4]).toBe(32);
    expect(lineWidths[5]).toBe(80); // normal

    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      lineWidths,
    });
    const bp = [...result.breakPoints];
    expect(bp[0]).toBe(2); // Line 0: 3 chars (48/16=3)
    expect(bp[1]).toBe(5); // Line 1: 3 chars (48px)
    expect(bp[2]).toBe(10); // Line 2: 5 chars (80px, back to normal)
    expect(bp[3]).toBe(12); // Line 3: 2 chars (32/16=2)
    expect(bp[4]).toBe(14); // Line 4: 2 chars (32px)
    expect(bp[5]).toBe(19); // Line 5: 5 chars (80px)
  });

  it('handles per-column variable widths (simulating gap computation)', () => {
    // Simulate gap-based layout: columns have different heights based on image position
    // Column 0: full (80), Column 1: 48 (above image), Column 2: 32 (below image), Column 3: full
    const text = toCodepoints('あいうえおかきくけこさしすせそたちつてと');
    const lineWidths = new Float32Array([80, 48, 32, 80, 80, 80, 80, 80]);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      lineWidths,
    });
    const bp = [...result.breakPoints];
    expect(bp[0]).toBe(4); // Column 0: 5 chars (80px)
    expect(bp[1]).toBe(7); // Column 1: 3 chars (48px)
    expect(bp[2]).toBe(9); // Column 2: 2 chars (32px)
    expect(bp[3]).toBe(14); // Column 3: 5 chars (80px, back to normal)
  });
});

describe('computeExclusionSlots', () => {
  const base = { lineWidth: 400, lineCount: 5, linePitch: 30, contentWidth: 150 };

  it('returns full-height slots with no images', () => {
    const { slots, lineWidths } = computeExclusionSlots({ ...base, images: [] });
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      expect(slot.yStart).toBe(0);
      expect(slot.height).toBe(400);
    }
    expect([...lineWidths]).toEqual([400, 400, 400, 400, 400]);
  });

  it('does not obstruct a neighbouring column over floating-point noise at a column edge', () => {
    // 30.4px columns: an image snapped to column k by k * pitch lands a few ULPs
    // off the engine's own edge arithmetic, and must still obstruct exactly one column.
    const linePitch = 30.4;
    const lineCount = 5;
    for (let k = 0; k < lineCount; k++) {
      const { slots } = computeExclusionSlots({
        lineWidth: 400,
        lineCount,
        linePitch,
        contentWidth: lineCount * linePitch,
        images: [{ x: k * linePitch, y: 100, w: linePitch, h: 100 }],
      });
      const obstructed = new Set(
        slots.filter((slot) => slot.height < 400).map((s) => s.columnIndex),
      );
      expect([...obstructed], `image at column ${k}`).toEqual([lineCount - 1 - k]);
    }
  });

  it('produces two slots per affected column (above + below)', () => {
    // Image occupies y=100..260 (h=160), x=90..120 → overlaps cols 1 only
    // Content=150, linePitch=30. Col 0: 120..150, Col 1: 90..120, Col 2: 60..90
    const { slots } = computeExclusionSlots({
      ...base,
      images: [{ x: 90, y: 100, w: 30, h: 160 }],
    });
    // Col 0: 1 slot (unaffected), Col 1: 2 slots (above+below), Cols 2-4: 1 each → 6
    expect(slots.length).toBe(6);
    // Col 0: full height
    expect(slots[0]).toEqual({ xPos: 0, yStart: 0, height: 400, columnIndex: 0 });
    // Col 1: above (0..100 = 100px) then below (260..400 = 140px)
    expect(slots[1]).toEqual({ xPos: 30, yStart: 0, height: 100, columnIndex: 1 });
    expect(slots[2]).toEqual({ xPos: 30, yStart: 260, height: 140, columnIndex: 1 });
    // Col 2: full height
    expect(slots[3]).toEqual({ xPos: 60, yStart: 0, height: 400, columnIndex: 2 });
  });

  it('handles image at top of content area (single gap below)', () => {
    // Image at y=0, h=100 → blocks 0..100, gap below = 400-100 = 300
    const { slots } = computeExclusionSlots({
      ...base,
      images: [{ x: 0, y: 0, w: 150, h: 100 }],
    });
    // Each column gets one slot (below the image)
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      expect(slot.yStart).toBe(100);
      expect(slot.height).toBe(300);
    }
  });

  it('handles multiple images producing three gaps', () => {
    // Two images stacked: y=0..80 and y=200..300.
    // Gaps: 80..200 (120px) and 300..400 (100px)
    // Each column gets 2 slots
    const { slots } = computeExclusionSlots({
      ...base,
      images: [
        { x: 0, y: 0, w: 150, h: 80 },
        { x: 0, y: 200, w: 150, h: 100 },
      ],
    });
    // 5 columns × 2 gaps each = 10 slots; the full-width images divide the
    // page into tiers, read top tier first
    expect(slots).toHaveLength(10);
    // Upper tier (80..200) across all five columns, then the lower tier (300..400)
    expect(slots.slice(0, 5)).toEqual([
      { xPos: 0, yStart: 80, height: 120, columnIndex: 0 },
      { xPos: 30, yStart: 80, height: 120, columnIndex: 1 },
      { xPos: 60, yStart: 80, height: 120, columnIndex: 2 },
      { xPos: 90, yStart: 80, height: 120, columnIndex: 3 },
      { xPos: 120, yStart: 80, height: 120, columnIndex: 4 },
    ]);
    expect(slots.slice(5)).toEqual([
      { xPos: 0, yStart: 300, height: 100, columnIndex: 0 },
      { xPos: 30, yStart: 300, height: 100, columnIndex: 1 },
      { xPos: 60, yStart: 300, height: 100, columnIndex: 2 },
      { xPos: 90, yStart: 300, height: 100, columnIndex: 3 },
      { xPos: 120, yStart: 300, height: 100, columnIndex: 4 },
    ]);
  });

  it('handles overlapping images (merged intervals)', () => {
    // Two overlapping images: y=50..200 and y=150..350. Merged: 50..350.
    // Gaps: 0..50 (50px) and 350..400 (50px)
    const { slots } = computeExclusionSlots({
      ...base,
      images: [
        { x: 0, y: 50, w: 150, h: 150 },
        { x: 0, y: 150, w: 150, h: 200 },
      ],
    });
    // 5 columns × 2 gaps each = 10 slots; the full-width merged block divides
    // the page into tiers, read top tier first
    expect(slots).toHaveLength(10);
    expect(slots[0]).toEqual({ xPos: 0, yStart: 0, height: 50, columnIndex: 0 });
    expect(slots[4]).toEqual({ xPos: 120, yStart: 0, height: 50, columnIndex: 4 });
    expect(slots[5]).toEqual({ xPos: 0, yStart: 350, height: 50, columnIndex: 0 });
  });

  it('images only affect overlapping columns', () => {
    // Narrow image at x=130, w=15 → only overlaps column 0 (right edge 120..150)
    // Col 0: 2 slots (above + below). Cols 1-4: 1 slot each.
    const { slots } = computeExclusionSlots({
      ...base,
      images: [{ x: 130, y: 100, w: 15, h: 200 }],
    });
    expect(slots).toHaveLength(6); // 2 + 1 + 1 + 1 + 1
    // Col 0's two slots
    expect(slots[0].height).toBe(100);
    expect(slots[1].height).toBe(100);
    // Col 1 unaffected
    expect(slots[2].height).toBe(400);
  });

  it('uses linePitch as the default minimum usable gap height', () => {
    const { slots } = computeExclusionSlots({
      ...base,
      images: [{ x: 0, y: 10, w: 150, h: 380 }],
    });
    expect(slots).toHaveLength(0);

    const custom = computeExclusionSlots({
      ...base,
      minGapHeight: 8,
      images: [{ x: 0, y: 10, w: 150, h: 380 }],
    });
    expect(custom.slots).toHaveLength(10);
  });

  it('lets slot count run above and below the column count', () => {
    // The documented post-condition is that slots.length is unrelated to
    // lineCount, so per-column indexing is invalid in both directions.
    const more = computeExclusionSlots({
      ...base,
      images: [{ x: 90, y: 100, w: 30, h: 160 }],
    });
    expect(more.slots.length).toBeGreaterThan(base.lineCount);

    const fewer = computeExclusionSlots({
      ...base,
      images: [{ x: 90, y: 0, w: 60, h: 400 }],
    });
    expect(fewer.slots.length).toBeLessThan(base.lineCount);

    for (const widths of [more.lineWidths, fewer.lineWidths]) {
      for (const w of widths) expect(w).toBeGreaterThan(0);
    }
  });

  it('lineWidths matches slot heights', () => {
    const { slots, lineWidths } = computeExclusionSlots({
      ...base,
      images: [{ x: 50, y: 100, w: 60, h: 200 }],
    });
    expect(lineWidths).toHaveLength(slots.length);
    for (let i = 0; i < slots.length; i++) {
      expect(lineWidths[i]).toBe(slots[i].height);
    }
  });

  it('omits columns completely blocked by image', () => {
    // Image covers entire inline extent
    const { slots, lineWidths } = computeExclusionSlots({
      ...base,
      images: [{ x: 0, y: 0, w: 150, h: 400 }],
    });
    expect(slots).toHaveLength(0);
    expect(lineWidths).toHaveLength(0);
  });

  it('never emits a zero-height gap when minGapHeight is 0', () => {
    // The image touches the top edge, so the gap above it has zero height.
    const { slots, lineWidths } = computeExclusionSlots({
      ...base,
      minGapHeight: 0,
      images: [{ x: 0, y: 0, w: 150, h: 100 }],
    });
    expect(slots).toHaveLength(5);
    for (const w of lineWidths) expect(w).toBeGreaterThan(0);

    const text = toCodepoints('あいうえおかきくけこ');
    expect(() =>
      computeBreaks({
        text,
        advances: uniformAdvances(text.length, 16),
        lineWidth: base.lineWidth,
        lineWidths,
      }),
    ).not.toThrow();
  });

  it('emits no slot for a column covered over its full inline height', () => {
    // Mixed page: column 0 is fully blocked, column 1 is partially blocked.
    const { slots, lineWidths } = computeExclusionSlots({
      ...base,
      minGapHeight: 0,
      images: [
        { x: 120, y: 0, w: 30, h: 400 },
        { x: 90, y: 100, w: 30, h: 100 },
      ],
    });
    expect(slots.every((s) => s.xPos !== 0)).toBe(true);
    for (const w of lineWidths) expect(w).toBeGreaterThan(0);

    const text = toCodepoints('あいうえおかきくけこさしすせそ');
    expect(() =>
      computeBreaks({
        text,
        advances: uniformAdvances(text.length, 16),
        lineWidth: base.lineWidth,
        lineWidths,
      }),
    ).not.toThrow();
  });

  it('reports whether images changed the slot coverage', () => {
    expect(computeExclusionSlots({ ...base, images: [] }).affected).toBe(false);
    // Image beyond the last column leaves every column untouched.
    expect(
      computeExclusionSlots({ ...base, images: [{ x: -100, y: 0, w: 20, h: 100 }] }).affected,
    ).toBe(false);
    // A fully blocked column leaves every surviving slot at full height,
    // yet the page's coverage still differs from the unobstructed layout.
    const blocked = computeExclusionSlots({
      ...base,
      images: [{ x: 120, y: 0, w: 30, h: 400 }],
    });
    expect(blocked.slots).toHaveLength(4);
    expect(blocked.slots.every((s) => s.height === base.lineWidth)).toBe(true);
    expect(blocked.affected).toBe(true);
  });

  it('inlineMargin expands image in inline direction', () => {
    // Image at y=100, h=100 with inlineMargin=20 → effective y=80..220
    // Gaps: 0..80 (80px) and 220..400 (180px)
    const { slots } = computeExclusionSlots({
      ...base,
      images: [{ x: 0, y: 100, w: 150, h: 100, inlineMargin: 20 }],
    });
    // 5 columns × 2 gaps each = 10 slots; the full-width image divides the page
    // into tiers, read top tier first
    expect(slots).toHaveLength(10);
    expect(slots[0]).toEqual({ xPos: 0, yStart: 0, height: 80, columnIndex: 0 });
    expect(slots[4]).toEqual({ xPos: 120, yStart: 0, height: 80, columnIndex: 4 });
    expect(slots[5]).toEqual({ xPos: 0, yStart: 220, height: 180, columnIndex: 0 });
  });

  it('reads each column past a mid-column image before the next column', () => {
    // 8 columns of pitch 30 over a 240px content width, lineWidth 400.
    // Columns are numbered from the right edge, so columns 2..5 span
    // x = 60..180 and the image sits across exactly those four columns.
    const { slots } = computeExclusionSlots({
      lineWidth: 400,
      lineCount: 8,
      linePitch: 30,
      contentWidth: 240,
      images: [{ x: 60, y: 150, w: 120, h: 100 }],
    });

    // Columns 0-1 and 6-7 keep a single full-height slot; columns 2-5 are
    // each read above and then below the image before the next column.
    expect(slots).toHaveLength(12);
    expect(slots.map((s) => [s.xPos, s.yStart, s.height])).toEqual([
      [0, 0, 400],
      [30, 0, 400],
      [60, 0, 150],
      [60, 250, 150],
      [90, 0, 150],
      [90, 250, 150],
      [120, 0, 150],
      [120, 250, 150],
      [150, 0, 150],
      [150, 250, 150],
      [180, 0, 400],
      [210, 0, 400],
    ]);
  });

  it('tags every slot with the physical column it belongs to', () => {
    const { slots } = computeExclusionSlots({
      lineWidth: 400,
      lineCount: 8,
      linePitch: 30,
      contentWidth: 240,
      images: [{ x: 60, y: 150, w: 120, h: 100 }],
    });

    // Split columns take two slots each, so the array position is not the column.
    expect(slots.map((s) => s.columnIndex)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7]);
    for (const slot of slots) {
      expect(slot.xPos).toBe((slot.columnIndex as number) * 30);
    }
  });

  it('does not read a column before a column to its right', () => {
    // Two images that leave column 0 usable only at the bottom and
    // column 1 usable only at the top. Column 0 is still read first.
    const { slots } = computeExclusionSlots({
      lineWidth: 400,
      lineCount: 2,
      linePitch: 30,
      contentWidth: 60,
      images: [
        { x: 30, y: 0, w: 30, h: 200 },
        { x: 0, y: 100, w: 30, h: 300 },
      ],
    });

    expect(slots.map((s) => [s.xPos, s.yStart, s.height])).toEqual([
      [0, 200, 200],
      [30, 0, 100],
    ]);
  });

  it('matches the slot count of the documented two-image example', () => {
    // Same geometry and images as docs/{en,ja}/09-advanced.md.
    const { slots } = computeExclusionSlots({
      lineWidth: 600,
      lineCount: 12,
      linePitch: 30.4,
      contentWidth: 380,
      images: [
        { x: 100, y: 50, w: 120, h: 160 },
        { x: 50, y: 300, w: 80, h: 100 },
      ],
    });

    expect(slots).toHaveLength(20);
  });

  it('blockMargin expands image in block direction', () => {
    // Narrow image at x=120, w=10 with blockMargin=10 → effective x=110..140
    // Without margin: only col 0 (120..150) affected
    // With margin: col 0 (120..150) and col 1 (90..120) affected (110 < 120)
    const { slots } = computeExclusionSlots({
      ...base,
      images: [{ x: 120, y: 100, w: 10, h: 200, blockMargin: 10 }],
    });
    // Col 0: affected (2 slots), Col 1: affected (2 slots), Cols 2-4: 1 slot each → 7
    expect(slots).toHaveLength(7);
  });
});

describe('ExclusionEngine', () => {
  const geometry = { lineWidth: 400, lineCount: 5, linePitch: 30, contentWidth: 150 };

  it('computes same result as computeExclusionSlots', () => {
    const images = [
      { x: 0, y: 0, w: 150, h: 80 },
      { x: 0, y: 200, w: 150, h: 100 },
    ];
    const fromFn = computeExclusionSlots({ ...geometry, images });
    const engine = new ExclusionEngine(geometry);
    for (const img of images) engine.addImage(img);
    const fromClass = engine.compute();

    expect(fromClass.slots).toEqual(fromFn.slots);
    expect([...fromClass.lineWidths]).toEqual([...fromFn.lineWidths]);
  });

  it('supports addImage chaining', () => {
    const engine = new ExclusionEngine(geometry);
    const result = engine
      .addImage({ x: 0, y: 0, w: 50, h: 50 })
      .addImage({ x: 50, y: 50, w: 50, h: 50 });
    expect(result).toBe(engine);
    expect(engine.imageCount).toBe(2);
  });

  it('removeImage removes by reference', () => {
    const engine = new ExclusionEngine(geometry);
    const img1 = { x: 0, y: 0, w: 50, h: 50 };
    const img2 = { x: 50, y: 50, w: 50, h: 50 };
    engine.addImage(img1).addImage(img2);
    expect(engine.removeImage(img1)).toBe(true);
    expect(engine.imageCount).toBe(1);
    expect(engine.getImages()).toEqual([img2]);
  });

  it('removeImage returns false for unknown image', () => {
    const engine = new ExclusionEngine(geometry);
    expect(engine.removeImage({ x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });

  it('clearImages removes all', () => {
    const engine = new ExclusionEngine(geometry);
    engine.addImage({ x: 0, y: 0, w: 50, h: 50 }).addImage({ x: 50, y: 0, w: 50, h: 50 });
    engine.clearImages();
    expect(engine.imageCount).toBe(0);
    const { slots } = engine.compute();
    for (const s of slots) expect(s.height).toBe(400);
  });

  it('setGeometry updates dimensions', () => {
    const engine = new ExclusionEngine(geometry);
    engine.addImage({ x: 0, y: 0, w: 150, h: 400 });
    // All blocked with lineWidth=400
    expect(engine.compute().slots).toHaveLength(0);
    // Increase lineWidth → gap appears below the image
    engine.setGeometry({ ...geometry, lineWidth: 500 });
    expect(engine.compute().slots.every((s) => s.height === 100)).toBe(true);
  });
});

describe('SpreadExclusionEngine', () => {
  // Page: 200px wide, 20px padding on each side → 160px content, linePitch=32 → 5 cols/page
  const spread = {
    pageWidth: 200,
    pagePaddingX: 20,
    pagePaddingY: 10,
    lineWidth: 400,
    linePitch: 32,
  };

  it('produces continuous lineWidths for both pages', () => {
    const engine = new SpreadExclusionEngine(spread);
    const { lineWidths, rightSlotCount, rightSlots, leftSlots } = engine.compute();
    // 5 cols/page × 2 pages = 10 total, no images → all full height
    expect(rightSlots).toHaveLength(5);
    expect(leftSlots).toHaveLength(5);
    expect(rightSlotCount).toBe(5);
    expect(lineWidths).toHaveLength(10);
    for (let i = 0; i < 10; i++) expect(lineWidths[i]).toBe(400);
  });

  it('image on right page only affects right slots', () => {
    const engine = new SpreadExclusionEngine(spread);
    // Image at page-relative (50, 50), content-area (30, 40), covers 1-2 columns
    engine.addImage({ x: 50, y: 50, w: 50, h: 100 });
    const { rightSlots, leftSlots, lineWidths } = engine.compute();
    // Right page has some affected slots (extra due to split)
    expect(rightSlots.length).toBeGreaterThanOrEqual(5);
    // Left page is unaffected: exactly 5 slots, all full height
    expect(leftSlots).toHaveLength(5);
    for (const s of leftSlots) expect(s.height).toBe(400);
    // Combined lineWidths covers both pages
    expect(lineWidths).toHaveLength(rightSlots.length + 5);
  });

  it('image with negative x affects left page with gutter offset', () => {
    const engine = new SpreadExclusionEngine(spread);
    // Image at page-relative x=-100, meaning 100px to the left of pageRight
    // Left-page content coord: (-100 - 20) + 200 = 80
    engine.addImage({ x: -100, y: 50, w: 50, h: 100 });
    const { rightSlots, leftSlots } = engine.compute();
    // Right page unaffected (image is fully on left page)
    expect(rightSlots).toHaveLength(5);
    for (const s of rightSlots) expect(s.height).toBe(400);
    // Left page has affected slots
    expect(leftSlots.length).toBeGreaterThan(5);
  });

  it('image straddling gutter affects both pages', () => {
    const engine = new SpreadExclusionEngine(spread);
    // Image from x=-30 to x=+30 (60px wide, crosses the gutter)
    engine.addImage({ x: -30, y: 50, w: 60, h: 100 });
    const { rightSlots, leftSlots } = engine.compute();
    // Both pages have some affected slots
    expect(rightSlots.length).toBeGreaterThanOrEqual(5);
    expect(leftSlots.length).toBeGreaterThanOrEqual(5);
  });

  it('classifies spread images using blockMargin-expanded bounds', () => {
    const engine = new SpreadExclusionEngine(spread);
    engine.addImage({ x: 5, y: 50, w: 10, h: 100, blockMargin: 30 });
    const { rightSlots, leftSlots } = engine.compute();

    expect(rightSlots.length).toBeGreaterThan(5);
    expect(leftSlots.length).toBeGreaterThan(5);
  });

  it('reports a fully blocked right column as affected', () => {
    // 400px page, 40px padding → 320px content, 30.4px pitch → 10 columns.
    // The image covers the rightmost column over the full line width, so that
    // column drops out entirely and every surviving slot is still full height.
    const engine = new SpreadExclusionEngine({
      pageWidth: 400,
      pagePaddingX: 40,
      pagePaddingY: 40,
      lineWidth: 600,
      linePitch: 30.4,
    });
    engine.addImage({ x: 330, y: 40, w: 30, h: 600 });
    const { rightSlots, leftSlots, rightAffected, leftAffected } = engine.compute();

    expect(rightSlots).toHaveLength(9);
    expect(rightSlots[0].xPos).toBeCloseTo(30.4, 5);
    expect(rightSlots.every((s) => s.height === 600)).toBe(true);
    expect(rightAffected).toBe(true);
    expect(leftSlots).toHaveLength(10);
    expect(leftAffected).toBe(false);
  });

  it('rightSlotCount splits lineWidths correctly', () => {
    const engine = new SpreadExclusionEngine(spread);
    engine.addImage({ x: 50, y: 50, w: 50, h: 100 });
    const { lineWidths, rightSlotCount, rightSlots, leftSlots } = engine.compute();
    expect(rightSlotCount).toBe(rightSlots.length);
    expect(lineWidths).toHaveLength(rightSlots.length + leftSlots.length);
    // Right portion
    for (let i = 0; i < rightSlots.length; i++) {
      expect(lineWidths[i]).toBe(rightSlots[i].height);
    }
    // Left portion
    for (let i = 0; i < leftSlots.length; i++) {
      expect(lineWidths[rightSlotCount + i]).toBe(leftSlots[i].height);
    }
  });
});

describe('SpreadExclusionEngine column count', () => {
  const columnsOnPage = (contentWidth: number, linePitch: number): number =>
    paginate(contentWidth, [{ lineCount: 100, linePitch, gapBefore: 0 }])[0].reduce(
      (n, slice) => n + slice.lineEnd - slice.lineStart,
      0,
    );

  it('keeps the last column when the content width is an exact multiple of the pitch', () => {
    const engine = new SpreadExclusionEngine({
      pageWidth: 328,
      pagePaddingX: 52,
      pagePaddingY: 10,
      lineWidth: 400,
      linePitch: 14 * 1.6,
    });
    expect(engine.compute().rightSlotCount).toBe(10);
  });

  it('fits the same number of columns as paginate across common font sizes and line heights', () => {
    for (let fontSize = 14; fontSize <= 20; fontSize++) {
      for (let lh = 1.6; lh <= 2.001; lh += 0.1) {
        const linePitch = fontSize * lh;
        for (let columns = 5; columns <= 12; columns++) {
          const contentW = Math.round(columns * linePitch * 10) / 10;
          const engine = new SpreadExclusionEngine({
            pageWidth: contentW + 40,
            pagePaddingX: 20,
            pagePaddingY: 10,
            lineWidth: 400,
            linePitch,
          });
          expect(engine.compute().rightSlotCount, `${fontSize}px x ${lh} x ${columns}`).toBe(
            columnsOnPage(contentW, linePitch),
          );
        }
      }
    }
  });
});

describe('exclusion reading order', () => {
  // Eight columns of pitch 30 over a 240px content width; columns 400px tall.
  // Column c spans x = 210 - 30c .. 240 - 30c, numbered from the right edge.
  const page = { lineWidth: 400, lineCount: 8, linePitch: 30, contentWidth: 240 };
  const FULL = page.contentWidth;

  const order = (images: ImageRect[]) =>
    computeExclusionSlots({ ...page, images }).slots.map((s) => `${s.columnIndex}@${s.yStart}`);

  it('continues a column below a partial image before opening the next column', () => {
    // Columns 2-4 carry text above y=100 and below y=180; the rest are whole.
    expect(order([{ x: 90, y: 100, w: 90, h: 80 }])).toEqual([
      '0@0',
      '1@0',
      '2@0',
      '2@180',
      '3@0',
      '3@180',
      '4@0',
      '4@180',
      '5@0',
      '6@0',
      '7@0',
    ]);
  });

  it('reads the tier above a full-width image across the page before the tier below', () => {
    const slots = order([{ x: 0, y: 100, w: FULL, h: 80 }]);
    expect(slots).toEqual([
      ...Array.from({ length: 8 }, (_, c) => `${c}@0`),
      ...Array.from({ length: 8 }, (_, c) => `${c}@180`),
    ]);
  });

  it('keeps a page one tier when the image leaves a single edge column whole', () => {
    // Columns 0-6 are split; column 7 (x = 0..30) runs the full height, so
    // no inline range is blocked in every column.
    const slots = order([{ x: 30, y: 100, w: FULL - 30, h: 80 }]);
    expect(slots.slice(0, 4)).toEqual(['0@0', '0@180', '1@0', '1@180']);
    expect(slots.at(-1)).toBe('7@0');
  });

  it('reads each column past a partial image inside the lower tier', () => {
    // A full-width band divides the page; a second image splits columns 1-2
    // of the lower tier again, and the reader steps over it column by column.
    expect(
      order([
        { x: 0, y: 100, w: FULL, h: 40 },
        { x: 150, y: 250, w: 60, h: 50 },
      ]),
    ).toEqual([
      ...Array.from({ length: 8 }, (_, c) => `${c}@0`),
      '0@140',
      '1@140',
      '1@300',
      '2@140',
      '2@300',
      '3@140',
      '4@140',
      '5@140',
      '6@140',
      '7@140',
    ]);
  });

  it('reads three tiers top to bottom under two full-width images', () => {
    const slots = order([
      { x: 0, y: 80, w: FULL, h: 40 },
      { x: 0, y: 220, w: FULL, h: 40 },
    ]);
    const tops = slots.map((s) => Number(s.split('@')[1]));
    expect(tops).toEqual([...Array(8).fill(0), ...Array(8).fill(120), ...Array(8).fill(260)]);
  });

  it('ignores a fully blocked column when deciding whether a band divides the page', () => {
    // Column 0 is blocked top to bottom; every other column is split by the band.
    const slots = order([
      { x: 210, y: 0, w: 30, h: 400 },
      { x: 0, y: 100, w: FULL, h: 80 },
    ]);
    expect(slots).toEqual([
      ...Array.from({ length: 7 }, (_, c) => `${c + 1}@0`),
      ...Array.from({ length: 7 }, (_, c) => `${c + 1}@180`),
    ]);
  });

  it('does not divide the page when a column has text only on one side of the band', () => {
    // The band crosses the page, but column 3 is also blocked below it, so the
    // reader could not finish an upper tier there; the page stays one tier.
    const slots = order([
      { x: 0, y: 100, w: FULL, h: 80 },
      { x: 120, y: 180, w: 30, h: 220 },
    ]);
    expect(slots.slice(0, 7)).toEqual(['0@0', '0@180', '1@0', '1@180', '2@0', '2@180', '3@0']);
    expect(slots[7]).toBe('4@0');
  });

  it('orders slots the same way in each page of a spread', () => {
    // 160px content per page, five 32px columns; left-page content x = image x + 180.
    const engine = new SpreadExclusionEngine({
      pageWidth: 200,
      pagePaddingX: 20,
      pagePaddingY: 0,
      lineWidth: 400,
      linePitch: 32,
    });
    // A partial image on the right page, a full-width band on the left page.
    engine.addImage({ x: 60, y: 100, w: 60, h: 80 });
    engine.addImage({ x: -180, y: 100, w: 160, h: 80 });
    const { rightSlots, leftSlots } = engine.compute();

    const right = rightSlots.map((s) => s.columnIndex as number);
    expect(new Set(right).size).toBeLessThan(right.length);
    for (let i = 1; i < right.length; i++) {
      expect(right[i]).toBeGreaterThanOrEqual(right[i - 1]);
    }
    const leftTops = leftSlots.map((s) => s.yStart);
    const firstLower = leftTops.findIndex((y) => y > 0);
    expect(firstLower).toBeGreaterThan(0);
    expect(leftTops.slice(firstLower).every((y) => y > 0)).toBe(true);
  });
});

describe('pageTiers', () => {
  const gap = (yStart: number, height: number): ColumnSlot => ({ xPos: 0, yStart, height });

  it('returns one tier over the line width when nothing divides the page', () => {
    expect(pageTiers([], 400)).toEqual([{ top: 0, bottom: 400 }]);
    expect(pageTiers([[gap(0, 400)], [gap(0, 100), gap(200, 200)]], 400)).toEqual([
      { top: 0, bottom: 400 },
    ]);
  });

  it('cuts at the range every texted column is blocked in', () => {
    const split = [gap(0, 100), gap(180, 220)];
    expect(pageTiers([split, split, [], split], 400)).toEqual([
      { top: 0, bottom: 100 },
      { top: 180, bottom: 400 },
    ]);
  });

  it('cuts at the narrowest common range when columns are blocked unevenly', () => {
    expect(
      pageTiers(
        [
          [gap(0, 100), gap(180, 220)],
          [gap(0, 120), gap(160, 240)],
        ],
        400,
      ),
    ).toEqual([
      { top: 0, bottom: 120 },
      { top: 160, bottom: 400 },
    ]);
  });

  it('does not cut between staggered images', () => {
    // Column 0 has text only below, column 1 only above: no shared tier boundary.
    expect(pageTiers([[gap(200, 200)], [gap(0, 100)]], 400)).toEqual([{ top: 0, bottom: 400 }]);
  });
});

describe('exclusion reading order invariants', () => {
  /** Deterministic PRNG so a failure reproduces from its seed. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  const page = { lineWidth: 400, lineCount: 8, linePitch: 30, contentWidth: 240 };

  it('emits every gap once, tier by tier, column by column, top to bottom', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rand = lcg(seed);
      const images: ImageRect[] = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
        const fullWidth = rand() < 0.3;
        const x = fullWidth ? 0 : Math.floor(rand() * 200);
        const w = fullWidth ? page.contentWidth : 20 + Math.floor(rand() * (page.contentWidth - x));
        return { x, y: Math.floor(rand() * 340), w, h: 20 + Math.floor(rand() * 120) };
      });
      const { slots } = computeExclusionSlots({ ...page, images });
      const columns = Array.from(
        { length: page.lineCount },
        (_, c) =>
          columnGapsAt(
            c * page.linePitch,
            page.linePitch,
            c,
            page.contentWidth,
            page.lineWidth,
            images,
            page.linePitch,
          ).gaps,
      );
      const context = `seed ${seed}: ${JSON.stringify(images)}`;

      // No gap lost or duplicated.
      const key = (g: ColumnSlot) => `${g.columnIndex}@${g.yStart}+${g.height}`;
      expect(slots.map(key).sort(), context).toEqual(columns.flat().map(key).sort());

      // Every tier boundary is blocked in every texted column, with text on both sides.
      const tiers = pageTiers(columns, page.lineWidth);
      for (let t = 1; t < tiers.length; t++) {
        const cutTop = tiers[t - 1].bottom;
        const cutBottom = tiers[t].top;
        expect(cutBottom, context).toBeGreaterThan(cutTop);
        for (const gaps of columns.filter((g) => g.length > 0)) {
          for (const g of gaps) {
            const end = g.yStart + g.height;
            expect(end <= cutTop || g.yStart >= cutBottom, context).toBe(true);
          }
          expect(
            gaps.some((g) => g.yStart + g.height <= cutTop),
            context,
          ).toBe(true);
          expect(
            gaps.some((g) => g.yStart >= cutBottom),
            context,
          ).toBe(true);
        }
      }

      // Reading order: tier, then column from the right, then top to bottom.
      const tierOf = (g: ColumnSlot) => tiers.findIndex((t) => g.yStart < t.bottom);
      for (let i = 1; i < slots.length; i++) {
        const a = slots[i - 1];
        const b = slots[i];
        const [ta, tb] = [tierOf(a), tierOf(b)];
        expect(tb, context).toBeGreaterThanOrEqual(ta);
        if (ta !== tb) continue;
        const [ca, cb] = [a.columnIndex as number, b.columnIndex as number];
        expect(cb, context).toBeGreaterThanOrEqual(ca);
        if (ca === cb) expect(b.yStart, context).toBeGreaterThan(a.yStart);
      }
    }
  });
});
