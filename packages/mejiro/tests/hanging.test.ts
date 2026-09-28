import { describe, expect, it } from 'vitest';
import { computeHangingAdjustment, isHangingTarget } from '../src/hanging.js';
import { computeBreaks } from '../src/layout.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

describe('isHangingTarget', () => {
  it('identifies Japanese comma as hanging target', () => {
    expect(isHangingTarget(0x3001)).toBe(true); // 、
  });

  it('identifies Japanese period as hanging target', () => {
    expect(isHangingTarget(0x3002)).toBe(true); // 。
  });

  it('identifies fullwidth comma as hanging target', () => {
    expect(isHangingTarget(0xff0c)).toBe(true); // ，
  });

  it('identifies fullwidth period as hanging target', () => {
    expect(isHangingTarget(0xff0e)).toBe(true); // ．
  });

  it('rejects regular characters', () => {
    expect(isHangingTarget(0x3042)).toBe(false); // あ
    expect(isHangingTarget(0x0041)).toBe(false); // A
  });
});

describe('computeHangingAdjustment', () => {
  it('returns advance for hanging targets', () => {
    expect(computeHangingAdjustment(0x3001, 16)).toBe(16);
  });

  it('returns 0 for non-hanging characters', () => {
    expect(computeHangingAdjustment(0x3042, 16)).toBe(0);
  });

  it('reports the maximum overhang, not the overhang of a line that is not full', () => {
    // 5 chars (80px) leave 8px unused of the 88px line, so 、 hangs by 8px
    // while its maximum overhang is its full 16px advance.
    const text = toCodepoints('あいうえお、かきくけこ');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 88,
    });

    expect(result.hangingAdjustments?.[0]).toBeCloseTo(8);
    expect(computeHangingAdjustment(0x3001, 16)).toBe(16);
  });
});

describe('half-width punctuation', () => {
  it('hangs ｡ and ､ at line end exactly as 。 and 、 do', () => {
    const pairs: Array<[string, string]> = [
      ['あいうえお。かきくけこ', 'あいうえお｡かきくけこ'],
      ['あいうえお、かきくけこ', 'あいうえお､かきくけこ'],
    ];
    for (const [full, half] of pairs) {
      const run = (s: string) => {
        const text = toCodepoints(s);
        return computeBreaks({ text, advances: uniformAdvances(text.length, 16), lineWidth: 80 });
      };
      const a = run(full);
      const b = run(half);
      expect([...b.breakPoints], half).toEqual([...a.breakPoints]);
      expect([...(b.hangingAdjustments ?? [])], half).toEqual([...(a.hangingAdjustments ?? [])]);
      expect([...(b.hangingAdjustments ?? [])][0], half).toBe(16);
    }
  });
});

describe('BreakResult optional fields', () => {
  it('reports one entry per line, including a hang on the last line', () => {
    const cases: Array<[string, number, number[]]> = [
      ['あいうえお、', 80, [16]],
      ['あいうえお、かきくけこ。', 80, [16, 16]],
      ['あいうえおかきくけこ', 80, [0, 0]],
    ];
    for (const [s, lineWidth, expected] of cases) {
      const text = toCodepoints(s);
      const result = computeBreaks({ text, advances: uniformAdvances(text.length, 16), lineWidth });
      expect(result.hangingAdjustments?.length, s).toBe(result.breakPoints.length + 1);
      expect([...(result.hangingAdjustments ?? [])], s).toEqual(expected);
    }
  });

  it('returns zero-length hangingAdjustments for empty text when hanging is enabled', () => {
    const result = computeBreaks({
      text: new Uint32Array(0),
      advances: new Float32Array(0),
      lineWidth: 100,
      enableHanging: true,
    });

    expect(result.hangingAdjustments).toEqual(new Float32Array(0));
  });

  it('omits hangingAdjustments for empty text when hanging is disabled', () => {
    const result = computeBreaks({
      text: new Uint32Array(0),
      advances: new Float32Array(0),
      lineWidth: 100,
      enableHanging: false,
    });

    expect(result.hangingAdjustments).toBeUndefined();
  });

  it('returns zero-length lineWidths for empty text when per-line widths are given', () => {
    const result = computeBreaks({
      text: new Uint32Array(0),
      advances: new Float32Array(0),
      lineWidth: 100,
      lineWidths: new Float32Array([100, 80]),
    });

    expect(result.lineWidths).toEqual(new Float32Array(0));
  });
});
