import { describe, expect, it } from 'vitest';
import {
  computeExclusionSlots,
  computeLineWidths,
  ExclusionEngine,
  SpreadExclusionEngine,
} from '../src/exclusion.js';
import { computeBreaks } from '../src/layout.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

describe('computeLineWidths', () => {
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

  it('clamps to zero when exclusion exceeds line width', () => {
    const widths = computeLineWidths(50, 3, [{ blockStart: 0, blockEnd: 3, inlineSize: 80 }]);
    expect([...widths]).toEqual([0, 0, 0]);
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
    expect(slots[0]).toEqual({ xPos: 0, yStart: 0, height: 400 });
    // Col 1: above (0..100 = 100px) then below (260..400 = 140px)
    expect(slots[1]).toEqual({ xPos: 30, yStart: 0, height: 100 });
    expect(slots[2]).toEqual({ xPos: 30, yStart: 260, height: 140 });
    // Col 2: full height
    expect(slots[3]).toEqual({ xPos: 60, yStart: 0, height: 400 });
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
    // 5 columns × 2 gaps each = 10 slots
    expect(slots).toHaveLength(10);
    // First column: gap at 80..200 (120px), gap at 300..400 (100px)
    expect(slots[0]).toEqual({ xPos: 0, yStart: 80, height: 120 });
    expect(slots[1]).toEqual({ xPos: 0, yStart: 300, height: 100 });
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
    // 5 columns × 2 gaps each = 10 slots
    expect(slots).toHaveLength(10);
    expect(slots[0]).toEqual({ xPos: 0, yStart: 0, height: 50 });
    expect(slots[1]).toEqual({ xPos: 0, yStart: 350, height: 50 });
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

  it('inlineMargin expands image in inline direction', () => {
    // Image at y=100, h=100 with inlineMargin=20 → effective y=80..220
    // Gaps: 0..80 (80px) and 220..400 (180px)
    const { slots } = computeExclusionSlots({
      ...base,
      images: [{ x: 0, y: 100, w: 150, h: 100, inlineMargin: 20 }],
    });
    // 5 columns × 2 gaps each = 10 slots
    expect(slots).toHaveLength(10);
    expect(slots[0]).toEqual({ xPos: 0, yStart: 0, height: 80 });
    expect(slots[1]).toEqual({ xPos: 0, yStart: 220, height: 180 });
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
