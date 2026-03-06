import { describe, expect, it } from 'vitest';
import { computeBreaks } from '../src/layout.js';
import basicBreak from './golden/basic-break.json';
import forcedBreak from './golden/forced-break.json';
import hangingComma from './golden/hanging-comma.json';
import hangingPeriod from './golden/hanging-period.json';
import kinsokuLineEnd from './golden/kinsoku-line-end.json';
import kinsokuLineStart from './golden/kinsoku-line-start.json';
import mixedWidth from './golden/mixed-width.json';
import { toCodepoints, uniformAdvances } from './helpers.js';

function runGolden(fixture: {
  description: string;
  input: { text: string; advanceWidth?: number; advances?: number[]; lineWidth: number };
  expected: { breakPoints: number[]; hangingAdjustments?: number[] };
}) {
  const text = toCodepoints(fixture.input.text);
  const advances = fixture.input.advances
    ? new Float32Array(fixture.input.advances)
    : uniformAdvances(text.length, fixture.input.advanceWidth!);

  const result = computeBreaks({
    text,
    advances,
    lineWidth: fixture.input.lineWidth,
  });

  expect([...result.breakPoints]).toEqual(fixture.expected.breakPoints);

  if (fixture.expected.hangingAdjustments) {
    expect(result.hangingAdjustments).toBeDefined();
    expect([...result.hangingAdjustments!]).toEqual(fixture.expected.hangingAdjustments);
  }
}

describe('golden tests', () => {
  it(basicBreak.description, () => runGolden(basicBreak));
  it(kinsokuLineStart.description, () => runGolden(kinsokuLineStart));
  it(kinsokuLineEnd.description, () => runGolden(kinsokuLineEnd));
  it(hangingComma.description, () => runGolden(hangingComma));
  it(hangingPeriod.description, () => runGolden(hangingPeriod));
  it(forcedBreak.description, () => runGolden(forcedBreak));
  it(mixedWidth.description, () => runGolden(mixedWidth));
});

describe('edge cases', () => {
  it('returns empty breakPoints for empty text', () => {
    const result = computeBreaks({
      text: new Uint32Array(0),
      advances: new Float32Array(0),
      lineWidth: 100,
    });
    expect(result.breakPoints.length).toBe(0);
  });

  it('returns no break for single character', () => {
    const result = computeBreaks({
      text: toCodepoints('あ'),
      advances: uniformAdvances(1, 16),
      lineWidth: 100,
    });
    expect(result.breakPoints.length).toBe(0);
  });

  it('returns no break when text fits in one line', () => {
    const text = toCodepoints('あいう');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 100,
    });
    expect(result.breakPoints.length).toBe(0);
  });

  it('handles single character wider than line width', () => {
    const result = computeBreaks({
      text: toCodepoints('あ'),
      advances: uniformAdvances(1, 200),
      lineWidth: 100,
    });
    expect(result.breakPoints.length).toBe(0);
  });

  it('does not hang when enableHanging is false', () => {
    const text = toCodepoints('あいうえおかきくけこ、さしす');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 160,
      enableHanging: false,
    });
    expect(result.hangingAdjustments).toBeUndefined();
  });
});

describe('trailing hanging punctuation', () => {
  it('does not produce a break at the last character index', () => {
    // 8 chars + 。 at the end; lineWidth fits 8 chars (128px) but not 9 (144px)
    // The 。 should hang, but no break should be pushed at the last index
    // because there are no characters after it.
    const text = toCodepoints('あいうえおかきく。');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 130,
    });
    // All text fits on one line (。 hangs), so no break points
    expect([...result.breakPoints]).toEqual([]);
  });

  it('does not produce a break at the last character with multiple lines', () => {
    // Two lines: first 8 chars fill line 1, next 7 chars + 。 fill line 2
    // Line 2: 7*16=112, +。=128 > 120. 。hangs (112 <= 120).
    // Break should be at index 7 (after 8th char) only, NOT at index 15.
    const text = toCodepoints('あいうえおかきくさしすせそたちつ。');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 120,
    });
    // breakPoints.length + 1 must equal actual line count
    // If break at last char is pushed, breakPoints would be [7, 16] but
    // there are only 2 real lines (0-7, 8-16), not 3.
    const lastBp = result.breakPoints[result.breakPoints.length - 1];
    expect(lastBp).toBeLessThan(text.length - 1);
  });
});

describe('cluster support', () => {
  it('does not break within a cluster', () => {
    const text = toCodepoints('あいうえおかきくけこ');
    const clusterIds = new Uint32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      clusterIds,
    });
    // Should not break at positions 0-1, 1-2, 3-4, 4-5, 6-7, 7-8
    for (const bp of result.breakPoints) {
      if (bp + 1 < text.length) {
        expect(clusterIds[bp]).not.toBe(clusterIds[bp + 1]);
      }
    }
  });
});
