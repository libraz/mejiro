import { describe, expect, it } from 'vitest';
import { buildKinsokuRules } from '../src/kinsoku.js';
import { canBreakAt, computeBreaks } from '../src/layout.js';
import { tokenLengthsToBoundaries } from '../src/tokenize.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

function lineAdvanceSums(advances: Float32Array, breakPoints: Uint32Array): number[] {
  const sums: number[] = [];
  let start = 0;
  for (const breakPoint of breakPoints) {
    sums.push(advances.slice(start, breakPoint + 1).reduce((sum, a) => sum + a, 0));
    start = breakPoint + 1;
  }
  if (start < advances.length) {
    sums.push(advances.slice(start).reduce((sum, a) => sum + a, 0));
  }
  return sums;
}

function linesFromBreakPoints(text: string, breakPoints: Uint32Array): string[] {
  const chars = [...text];
  const lines: string[] = [];
  let start = 0;
  for (const breakPoint of breakPoints) {
    lines.push(chars.slice(start, breakPoint + 1).join(''));
    start = breakPoint + 1;
  }
  if (start < chars.length) lines.push(chars.slice(start).join(''));
  return lines;
}

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

  it('forces a line break at a newline character', () => {
    const text = toCodepoints('あい\nうえ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 1000,
    });

    expect([...result.breakPoints]).toEqual([2]);
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

  it('throws when advances length does not match text length', () => {
    expect(() =>
      computeBreaks({
        text: toCodepoints('あいう'),
        advances: uniformAdvances(2, 16),
        lineWidth: 100,
      }),
    ).toThrow(/advances length/);
  });

  it('throws when clusterIds length does not match text length', () => {
    expect(() =>
      computeBreaks({
        text: toCodepoints('あいう'),
        advances: uniformAdvances(3, 16),
        clusterIds: new Uint32Array([0, 1]),
        lineWidth: 100,
      }),
    ).toThrow(/clusterIds length/);
  });

  it('throws for invalid line widths and advances', () => {
    expect(() =>
      computeBreaks({
        text: toCodepoints('あ'),
        advances: uniformAdvances(1, 16),
        lineWidth: 0,
      }),
    ).toThrow(/lineWidth/);

    expect(() =>
      computeBreaks({
        text: toCodepoints('あ'),
        advances: new Float32Array([Number.NaN]),
        lineWidth: 100,
      }),
    ).toThrow(/advances\[0\]/);
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

describe('tokenBoundaries support', () => {
  it('prefers breaking at token boundaries', () => {
    // "新しいプログラミング言語" (12 chars), tokens: "新しい"(3) + "プログラミング"(7) + "言語"(2)
    // lineWidth=80 fits 5 chars at 16px each. Without tokens, break at index 4.
    // With tokens, prefer break at index 2 (end of "新しい").
    const text = toCodepoints('新しいプログラミング言語');
    const tokenBoundaries = tokenLengthsToBoundaries([3, 7, 2]);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      tokenBoundaries,
    });
    expect([...result.breakPoints]).toContain(2);
  });

  it('falls back to any valid position when no token boundary exists in range', () => {
    // "プログラミング" (7 chars), single token — no boundaries at all
    // lineWidth=64 fits 4 chars. Must fall back to character-level break.
    const text = toCodepoints('プログラミング');
    const tokenBoundaries = tokenLengthsToBoundaries([7]);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 64,
      tokenBoundaries,
    });
    expect(result.breakPoints.length).toBeGreaterThan(0);
  });

  it('does not treat a token boundary at line start as a preferred break', () => {
    const text = toCodepoints('あいうえおか');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 48,
      tokenBoundaries: tokenLengthsToBoundaries([1, 5]),
    });

    expect([...result.breakPoints]).toEqual([2]);
  });

  it('respects kinsoku even at token boundaries', () => {
    // "あいう「えお" tokens: "あいう"(3) + "「えお"(3)
    // lineWidth=48 fits 3 chars. Token boundary is at index 2, but index 3 is 「
    // which is line-end-prohibited. Kinsoku should still prevent break there.
    // Actually 「 is line-end prohibited, so canBreakAt(2) checks text[3]=「 for line-start.
    // 「 is NOT line-start-prohibited, it's line-end-prohibited.
    // So let's use a case where next char is line-start-prohibited: 」
    // "あいう」えお" tokens: "あいう"(3) + "」えお"(3)
    // token boundary at index 2. text[3] = 」 which IS line-start-prohibited.
    // So break at index 2 should be rejected by kinsoku, falls back to index 1.
    const text = toCodepoints('あいう」えお');
    const tokenBoundaries = tokenLengthsToBoundaries([3, 3]);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 48,
      tokenBoundaries,
    });
    // Should not break at 2 (next char 」 is line-start-prohibited)
    expect([...result.breakPoints]).not.toContain(2);
  });

  it('works without tokenBoundaries (backward compatible)', () => {
    const text = toCodepoints('あいうえおかきくけこ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
    });
    expect(result.breakPoints.length).toBeGreaterThan(0);
  });

  it('prefers Latin whitespace over splitting the current word', () => {
    const value = 'hello world';
    const text = toCodepoints(value);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 10),
      lineWidth: 80,
    });

    expect(linesFromBreakPoints(value, result.breakPoints)).toEqual(['hello ', 'world']);
  });

  it('does not let an early space empty a CJK line', () => {
    // 21 chars with an ASCII space at index 2; 20 chars fill the line exactly.
    const value = `ああ ${'あ'.repeat(18)}`;
    const text = toCodepoints(value);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 10),
      lineWidth: 200,
    });

    expect(result.breakPoints[0]).toBe(19);
  });

  it('prefers a space over splitting a Latin word inside CJK text', () => {
    // The nearest valid position falls inside "world", so the space wins.
    const value = 'あいうえお hello world';
    const text = toCodepoints(value);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 10),
      lineWidth: 150,
    });

    expect(linesFromBreakPoints(value, result.breakPoints)).toEqual(['あいうえお hello ', 'world']);
  });

  it('keeps the space preference when token boundaries yield no candidate', () => {
    const value = 'hello world';
    const text = toCodepoints(value);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 10),
      lineWidth: 80,
      tokenBoundaries: tokenLengthsToBoundaries([11]),
    });

    expect(linesFromBreakPoints(value, result.breakPoints)).toEqual(['hello ', 'world']);
  });

  it('does not prefer a distant space over a nearer CJK position with token boundaries', () => {
    const value = `ああ ${'あ'.repeat(18)}`;
    const text = toCodepoints(value);
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 10),
      lineWidth: 200,
      tokenBoundaries: tokenLengthsToBoundaries([text.length]),
    });

    expect(result.breakPoints[0]).toBe(19);
  });
});

describe('cluster-safe forced breaks', () => {
  it('prefers a cluster-safe forced break over splitting the overflowing cluster', () => {
    const text = toCodepoints('「「「「い');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      clusterIds: new Uint32Array([0, 1, 1, 2, 2]),
      lineWidth: 64,
    });

    expect([...result.breakPoints]).toEqual([2]);
  });

  it('keeps a cluster whole when the only cluster boundary is at line start', () => {
    // 「 is line-end prohibited, but the cluster あああ fits on a line of its
    // own, so the break goes there rather than into the cluster.
    const text = toCodepoints('「あああ');
    const advances = uniformAdvances(text.length, 16);
    const result = computeBreaks({
      text,
      advances,
      clusterIds: new Uint32Array([0, 1, 1, 1]),
      lineWidth: 48,
    });

    expect([...result.breakPoints]).toEqual([0]);
    expect(lineAdvanceSums(advances, result.breakPoints).every((sum) => sum <= 48)).toBe(true);
  });

  it('splits a cluster wider than the line at the last character that fits', () => {
    const text = toCodepoints('ああああ');
    const advances = uniformAdvances(text.length, 16);
    const result = computeBreaks({
      text,
      advances,
      clusterIds: new Uint32Array([0, 0, 0, 0]),
      lineWidth: 48,
    });

    // 3 of the 4 clustered characters fit, so the cluster is split after index 2.
    expect([...result.breakPoints]).toEqual([2]);
    expect(lineAdvanceSums(advances, result.breakPoints)).toEqual([48, 16]);
  });

  it('breaks only at cluster boundaries while every cluster fits the line', () => {
    const text = toCodepoints('ABCDE');
    const advances = uniformAdvances(text.length, 16);
    const clusterIds = new Uint32Array([0, 0, 0, 1, 1]);
    const result = computeBreaks({ text, advances, lineWidth: 48, clusterIds });

    expect([...result.breakPoints]).toEqual([2]);
    for (const sum of lineAdvanceSums(advances, result.breakPoints)) {
      expect(sum).toBeLessThanOrEqual(48);
    }
    for (const bp of result.breakPoints) {
      expect(clusterIds[bp]).not.toBe(clusterIds[bp + 1]);
    }
  });
});

describe('tokenLengthsToBoundaries', () => {
  it('converts token lengths to boundary indices', () => {
    // "新しい"(3) + "プログラミング"(7) + "言語"(2)
    const boundaries = tokenLengthsToBoundaries([3, 7, 2]);
    expect([...boundaries]).toEqual([2, 9]);
  });

  it('returns empty for single token', () => {
    expect([...tokenLengthsToBoundaries([5])]).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect([...tokenLengthsToBoundaries([])]).toEqual([]);
  });
});

describe('canBreakAt', () => {
  it('allows break between regular characters', () => {
    const text = toCodepoints('あいう');
    expect(canBreakAt(text, 0)).toBe(true);
    expect(canBreakAt(text, 1)).toBe(true);
  });

  it('disallows break when next char is line-start-prohibited', () => {
    // 」is line-start-prohibited
    const text = toCodepoints('あ」い');
    expect(canBreakAt(text, 0)).toBe(false); // next char is 」
    expect(canBreakAt(text, 1)).toBe(true); // next char is い
  });

  it('disallows break when current char is line-end-prohibited', () => {
    // 「 is line-end-prohibited
    const text = toCodepoints('あ「い');
    expect(canBreakAt(text, 1)).toBe(false); // current char is 「
    expect(canBreakAt(text, 0)).toBe(true); // current char is あ
  });

  it('disallows break within a cluster', () => {
    const text = toCodepoints('あいう');
    const clusterIds = new Uint32Array([0, 0, 1]);
    expect(canBreakAt(text, 0, clusterIds)).toBe(false);
    expect(canBreakAt(text, 1, clusterIds)).toBe(true);
  });

  it('respects loose mode', () => {
    // ぁ is line-start-prohibited in strict but allowed in loose
    const text = toCodepoints('あぁい');
    expect(canBreakAt(text, 0, undefined, 'strict')).toBe(false);
    expect(canBreakAt(text, 0, undefined, 'loose')).toBe(true);
  });

  it('uses custom kinsoku rules', () => {
    const text = toCodepoints('ABC');
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x42], // 'B'
      lineEndProhibited: [],
    });
    expect(canBreakAt(text, 0, undefined, 'strict', rules)).toBe(false); // next is B
    expect(canBreakAt(text, 1, undefined, 'strict', rules)).toBe(true); // next is C
  });

  it('disallows breaks inside custom unbreakable pairs', () => {
    const text = toCodepoints('ABC');
    const rules = buildKinsokuRules({
      lineStartProhibited: [],
      lineEndProhibited: [],
      unbreakablePairs: [[0x41, 0x42]],
    });
    expect(canBreakAt(text, 0, undefined, 'strict', rules)).toBe(false);
    expect(canBreakAt(text, 1, undefined, 'strict', rules)).toBe(true);
  });
});

describe('hanging punctuation with kinsoku', () => {
  it('does not hang a period when it would leave a closing bracket at line start', () => {
    const text = toCodepoints('あいうえおかきく。」さ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 130,
    });

    expect([...result.breakPoints]).not.toContain(8);
    expect([...result.breakPoints]).toEqual([6]);
    expect(result.hangingAdjustments ? [...result.hangingAdjustments] : undefined).toEqual([0]);
  });
});

describe('computeBreaks with mode: loose', () => {
  it('allows small kana at line start in loose mode', () => {
    // "あいうえおっかきく" — ッ at index 5 is line-start-prohibited in strict
    // lineWidth = 80 fits 5 chars. In strict, break should avoid leaving っ at start.
    // In loose, っ at line start is allowed.
    const text = toCodepoints('あいうえおっかきく');
    const strictResult = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      mode: 'strict',
    });
    const looseResult = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      mode: 'loose',
    });
    // In strict, break at 4 would put っ at line start → must backtrack to 3
    // In loose, break at 4 is fine (っ at line start allowed)
    expect([...strictResult.breakPoints]).toEqual([3]);
    expect([...looseResult.breakPoints]).toEqual([4]);
  });
});

describe('computeBreaks with custom kinsokuRules', () => {
  it('uses custom rules instead of built-in', () => {
    // Custom rule: prohibit 'い' (U+3044) at line start
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x3044], // い
      lineEndProhibited: [],
    });
    // "あうえおかいきくけこ" — lineWidth fits 5 chars (80/16=5)
    // Overflow at index 5, search backward from 4:
    // Break at 4 would put い (index 5) at line start → prohibited → backtrack to 3
    const text = toCodepoints('あうえおかいきくけこ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      kinsokuRules: rules,
    });
    expect([...result.breakPoints]).toContain(3);
  });

  it('ignores built-in rules when custom rules are provided', () => {
    // 」(U+300D) is line-start-prohibited in built-in strict rules
    // Custom rules: nothing prohibited → break before 」 is allowed
    const rules = buildKinsokuRules({
      lineStartProhibited: [],
      lineEndProhibited: [],
    });
    const text = toCodepoints('あいうえお」かきくけ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 80,
      kinsokuRules: rules,
    });
    // With empty custom rules, break at 4 is fine even though 」follows
    expect([...result.breakPoints]).toContain(4);
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
