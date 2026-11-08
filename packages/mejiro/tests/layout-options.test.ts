import {
  buildKinsokuRules,
  canBreakAt,
  computeBreaks,
  isClusterBreakAllowed,
  isLineEndProhibited,
  isLineStartProhibited,
  isUnbreakablePair,
  type KinsokuMode,
  type KinsokuRules,
  preprocessRuby,
  toCodepoints,
} from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

/*
 * computeBreaks option combinations, pairwise (strength 2) over four factors.
 *
 * Model: kinsoku = absent | strict | loose | customRules
 *        enableHanging = true | false
 *        clusterIds = absent | given
 *        tcyAnnotations = absent | given
 *
 * | kinsoku     | enableHanging | clusterIds | tcyAnnotations |
 * | strict      | true          | absent     | absent         |
 * | absent      | false         | absent     | given          |
 * | customRules | true          | absent     | given          |
 * | strict      | false         | given      | given          |
 * | loose       | true          | given      | given          |
 * | loose       | false         | absent     | absent         |
 * | absent      | true          | absent     | given          |
 * | customRules | false         | given      | absent         |
 * | absent      | false         | given      | absent         |
 *
 * Expected: an absent kinsoku behaves as 'strict'; hangingAdjustments is always
 * present, one entry per line, zero-filled when hanging is off.
 */

const TEXT = toCodepoints('あいうえおっかきくけこ、さしすせそゃたちつてと');
const ADVANCE = 10;
const LINE_WIDTH = 50;
const ADVANCES = new Float32Array(TEXT.length).fill(ADVANCE);

/** Prohibits か at line start and nothing else. */
const CUSTOM_RULES = buildKinsokuRules({
  lineStartProhibited: [0x304b],
  lineEndProhibited: [],
});

type KinsokuFactor = 'absent' | KinsokuMode | 'customRules';

interface Row {
  kinsoku: KinsokuFactor;
  enableHanging: boolean;
  clusterIds: boolean;
  tcy: boolean;
}

const ROWS: readonly Row[] = [
  { kinsoku: 'strict', enableHanging: true, clusterIds: false, tcy: false },
  { kinsoku: 'absent', enableHanging: false, clusterIds: false, tcy: true },
  { kinsoku: 'customRules', enableHanging: true, clusterIds: false, tcy: true },
  { kinsoku: 'strict', enableHanging: false, clusterIds: true, tcy: true },
  { kinsoku: 'loose', enableHanging: true, clusterIds: true, tcy: true },
  { kinsoku: 'loose', enableHanging: false, clusterIds: false, tcy: false },
  { kinsoku: 'absent', enableHanging: true, clusterIds: false, tcy: true },
  { kinsoku: 'customRules', enableHanging: false, clusterIds: true, tcy: false },
  { kinsoku: 'absent', enableHanging: false, clusterIds: true, tcy: false },
];

/** Pins す and せ (indices 14, 15) together. */
function clusterIdsFor(): Uint32Array {
  const ids = new Uint32Array(TEXT.length);
  for (let i = 0; i < ids.length; i++) ids[i] = i;
  ids[15] = ids[14];
  return ids;
}

function kinsokuOf(factor: KinsokuFactor): KinsokuMode | KinsokuRules | undefined {
  if (factor === 'absent') return undefined;
  return factor === 'customRules' ? CUSTOM_RULES : factor;
}

function run(row: Row, kinsoku: KinsokuMode | KinsokuRules | undefined) {
  const clusterIds = row.clusterIds ? clusterIdsFor() : undefined;
  const result = computeBreaks({
    text: TEXT,
    advances: ADVANCES,
    lineWidth: LINE_WIDTH,
    enableHanging: row.enableHanging,
    kinsoku,
    clusterIds,
    tcyAnnotations: row.tcy ? [{ startIndex: 6, endIndex: 8, advance: ADVANCE }] : undefined,
  });
  return { result, clusterIds };
}

describe('computeBreaks options', () => {
  describe.each(ROWS)(
    'kinsoku=$kinsoku hanging=$enableHanging clusters=$clusterIds tcy=$tcy',
    (row) => {
      const kinsoku = kinsokuOf(row.kinsoku);
      const { result, clusterIds } = run(row, kinsoku);

      it('always returns one hanging entry per line, zero where hanging is off', () => {
        expect(result.hangingAdjustments).toBeInstanceOf(Float32Array);
        expect(result.hangingAdjustments).toHaveLength(result.breakPoints.length + 1);
        if (!row.enableHanging) {
          expect([...result.hangingAdjustments].every((value) => value === 0)).toBe(true);
        }
      });

      it('breaks only where the row kinsoku and clusters allow, except forced breaks', () => {
        for (const point of result.breakPoints) {
          const next = TEXT[point + 1];
          if (next === undefined) continue;
          // The text has no cluster or kinsoku combination wide enough to force a break.
          expect(canBreakAt(TEXT, point, { clusterIds, kinsoku }), `break after ${point}`).toBe(
            true,
          );
        }
      });

      it('treats an absent kinsoku as strict', () => {
        if (row.kinsoku !== 'absent') return;
        expect(run(row, 'strict').result.breakPoints).toEqual(result.breakPoints);
      });

      it('reports collapsed advances exactly when tate-chu-yoko is given', () => {
        expect(result.effectiveAdvances !== undefined).toBe(row.tcy);
      });
    },
  );

  it('breaks before a small kana in loose mode and one position earlier in strict mode', () => {
    const text = toCodepoints('あいうえおっかきくけこ');
    const advances = new Float32Array(text.length).fill(ADVANCE);
    const strict = computeBreaks({ text, advances, lineWidth: LINE_WIDTH, kinsoku: 'strict' });
    const loose = computeBreaks({ text, advances, lineWidth: LINE_WIDTH, kinsoku: 'loose' });

    expect([...strict.breakPoints]).toEqual([3, 8]);
    expect([...loose.breakPoints]).toEqual([4, 9]);
  });

  it('reports a zero-length hanging array for empty text', () => {
    const result = computeBreaks({
      text: new Uint32Array(0),
      advances: new Float32Array(0),
      lineWidth: LINE_WIDTH,
      enableHanging: false,
    });

    expect(result.breakPoints).toHaveLength(0);
    expect(result.hangingAdjustments).toHaveLength(0);
  });

  describe('kinsoku argument', () => {
    const input = { text: TEXT, advances: ADVANCES, lineWidth: LINE_WIDTH };

    it('rejects an unknown mode string with a RangeError', () => {
      expect(() => computeBreaks({ ...input, kinsoku: 'lenient' as KinsokuMode })).toThrow(
        RangeError,
      );
    });

    it('rejects a value that is neither a mode nor rules with a TypeError', () => {
      expect(() => computeBreaks({ ...input, kinsoku: 3 as unknown as KinsokuMode })).toThrow(
        TypeError,
      );
      expect(() => computeBreaks({ ...input, kinsoku: true as unknown as KinsokuMode })).toThrow(
        TypeError,
      );
      expect(() => computeBreaks({ ...input, kinsoku: null as unknown as KinsokuMode })).toThrow(
        TypeError,
      );
    });
  });

  describe('typing', () => {
    it('takes one kinsoku field that is a mode or rules, and a non-optional hanging array', () => {
      expectTypeErrors(
        `import { buildKinsokuRules, computeBreaks } from '@libraz/mejiro';
const text = new Uint32Array(1);
const advances = new Float32Array(1);
const rules = buildKinsokuRules({ lineStartProhibited: [], lineEndProhibited: [] });
export const byMode = computeBreaks({ text, advances, lineWidth: 10, kinsoku: 'loose' });
export const byRules = computeBreaks({ text, advances, lineWidth: 10, kinsoku: rules });
export const hang: Float32Array = byMode.hangingAdjustments;
`,
        { fails: [] },
      );
    });

    it('rejects the separate mode and kinsokuRules fields', () => {
      expectTypeErrors(
        `import { buildKinsokuRules, computeBreaks } from '@libraz/mejiro';
const text = new Uint32Array(1);
const advances = new Float32Array(1);
const rules = buildKinsokuRules({ lineStartProhibited: [], lineEndProhibited: [] });
export const oldMode = computeBreaks({ text, advances, lineWidth: 10, mode: 'loose' });
export const oldRules = computeBreaks({ text, advances, lineWidth: 10, kinsokuRules: rules });
export const badMode = computeBreaks({ text, advances, lineWidth: 10, kinsoku: 'lenient' });
`,
        { fails: ['const oldMode', 'const oldRules', 'const badMode'] },
      );
    });
  });
});

describe('kinsoku predicates', () => {
  it('read the mode from an options object, strict by default', () => {
    expect(isLineStartProhibited(0x3063)).toBe(true);
    expect(isLineStartProhibited(0x3063, { kinsoku: 'strict' })).toBe(true);
    expect(isLineStartProhibited(0x3063, { kinsoku: 'loose' })).toBe(false);
    expect(isLineStartProhibited(0x30fc, { kinsoku: 'loose' })).toBe(false);
    expect(isLineStartProhibited(0x3001, { kinsoku: 'loose' })).toBe(true);
  });

  it('read custom rules from the same field', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x41],
      lineEndProhibited: [0x42],
      unbreakablePairs: [[0x43, 0x44]],
    });

    expect(isLineStartProhibited(0x41, { kinsoku: rules })).toBe(true);
    expect(isLineStartProhibited(0x3001, { kinsoku: rules })).toBe(false);
    expect(isLineEndProhibited(0x42, { kinsoku: rules })).toBe(true);
    expect(isLineEndProhibited(0x300c, { kinsoku: rules })).toBe(false);
    expect(isLineEndProhibited(0x300c)).toBe(true);
    expect(isUnbreakablePair(0x43, 0x44, { kinsoku: rules })).toBe(true);
    expect(isUnbreakablePair(0x2026, 0x2026, { kinsoku: rules })).toBe(false);
    expect(isUnbreakablePair(0x2026, 0x2026)).toBe(true);
  });

  it('reject an unknown mode with a RangeError and a non-mode value with a TypeError', () => {
    expect(() => isLineStartProhibited(0x3063, { kinsoku: 'lenient' as KinsokuMode })).toThrow(
      RangeError,
    );
    expect(() => isLineEndProhibited(0x3063, { kinsoku: 1 as unknown as KinsokuMode })).toThrow(
      TypeError,
    );
  });

  it('are called with an options object rather than positional mode and rules', () => {
    expectTypeErrors(
      `import { canBreakAt, isLineEndProhibited, isLineStartProhibited, isUnbreakablePair } from '@libraz/mejiro';
export const start = isLineStartProhibited(0x3063, { kinsoku: 'loose' });
export const end = isLineEndProhibited(0x300c, { kinsoku: 'strict' });
export const pair = isUnbreakablePair(0x2026, 0x2026, {});
export const can = canBreakAt(new Uint32Array(2), 0, { clusterIds: new Uint32Array(2), kinsoku: 'loose' });
export const oldStart = isLineStartProhibited(0x3063, 'loose');
export const oldCan = canBreakAt(new Uint32Array(2), 0, undefined, 'loose');
`,
      { fails: ['const oldStart', 'const oldCan'] },
    );
  });
});

describe('canBreakAt', () => {
  const text = toCodepoints('あいっう');

  it('applies kinsoku from options', () => {
    expect(canBreakAt(text, 1)).toBe(false);
    expect(canBreakAt(text, 1, { kinsoku: 'loose' })).toBe(true);
  });

  it('applies cluster IDs from options', () => {
    const clusterIds = new Uint32Array([0, 1, 1, 2]);
    expect(canBreakAt(text, 2, { kinsoku: 'loose' })).toBe(true);
    expect(canBreakAt(text, 1, { kinsoku: 'loose', clusterIds })).toBe(false);
  });
});

describe('isClusterBreakAllowed', () => {
  const ids = new Uint32Array([0, 0, 1, 1, 2]);

  it('bounds the position by the cluster ID array, not a separate text length', () => {
    expect(isClusterBreakAllowed(ids, 0)).toBe(false);
    expect(isClusterBreakAllowed(ids, 1)).toBe(true);
    expect(isClusterBreakAllowed(ids, 3)).toBe(true);
    expect(isClusterBreakAllowed(ids, 4)).toBe(true);
    expect(isClusterBreakAllowed(undefined, 0)).toBe(true);
  });
});

describe('computeBreaks and preprocessRuby argument errors', () => {
  const base = { text: toCodepoints('あいうえお'), advances: new Float32Array(5).fill(10) };

  it('rejects each malformed computeBreaks input with a RangeError', () => {
    const inputs = [
      { ...base, advances: new Float32Array(4), lineWidth: 50 },
      { ...base, lineWidth: 50, clusterIds: new Uint32Array(4) },
      { ...base, lineWidth: 0 },
      { ...base, lineWidth: Number.NaN },
      { ...base, lineWidth: 50, lineWidths: new Float32Array([50, 0]) },
      { ...base, advances: new Float32Array([10, -1, 10, 10, 10]), lineWidth: 50 },
      { ...base, lineWidth: 50, breakPenalties: new Uint8Array(4) },
      { ...base, lineWidth: 50, breakPenalties: new Uint8Array(5), breakCost: { emSize: 0 } },
    ];
    for (const input of inputs) {
      expect(() => computeBreaks(input)).toThrow(RangeError);
    }
  });

  it('rejects overlapping and mono multi-character ruby with a RangeError', () => {
    const rubyText = toCodepoints('あ');
    const ruby = (startIndex: number, endIndex: number, rubyType: 'mono' | 'group') => ({
      startIndex,
      endIndex,
      rubyText,
      rubyAdvances: new Float32Array([5]),
      rubyType,
    });
    expect(() =>
      preprocessRuby(base.text, base.advances, [ruby(0, 3, 'group'), ruby(2, 4, 'group')]),
    ).toThrow(RangeError);
    expect(() => preprocessRuby(base.text, base.advances, [ruby(0, 2, 'mono')])).toThrow(
      RangeError,
    );
  });
});
