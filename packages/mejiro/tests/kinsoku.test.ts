import { describe, expect, it } from 'vitest';
import { computeBreaks, getLineRanges, toCodepoints } from '../src/index.js';
import {
  buildKinsokuRules,
  getDefaultKinsokuRules,
  isLineEndProhibited,
  isLineStartProhibited,
  isUnbreakablePair,
} from '../src/kinsoku.js';

describe('isLineStartProhibited', () => {
  it('prohibits closing brackets in strict mode', () => {
    expect(isLineStartProhibited(0x300d, { kinsoku: 'strict' })).toBe(true); // 」
    expect(isLineStartProhibited(0x3011, { kinsoku: 'strict' })).toBe(true); // 】
  });

  it('prohibits small kana in strict mode', () => {
    expect(isLineStartProhibited(0x3041, { kinsoku: 'strict' })).toBe(true); // ぁ
    expect(isLineStartProhibited(0x30c3, { kinsoku: 'strict' })).toBe(true); // ッ
    expect(isLineStartProhibited(0x3095, { kinsoku: 'strict' })).toBe(true); // ゕ
    expect(isLineStartProhibited(0x30f6, { kinsoku: 'strict' })).toBe(true); // ヶ
  });

  it('prohibits JLReq punctuation extensions in strict mode', () => {
    expect(isLineStartProhibited(0x2026, { kinsoku: 'strict' })).toBe(true); // …
    expect(isLineStartProhibited(0x2025, { kinsoku: 'strict' })).toBe(true); // ‥
    expect(isLineStartProhibited(0x301c, { kinsoku: 'strict' })).toBe(true); // 〜
    expect(isLineStartProhibited(0x2015, { kinsoku: 'strict' })).toBe(true); // ―
    expect(isLineStartProhibited(0x2019, { kinsoku: 'strict' })).toBe(true); // ’
    expect(isLineStartProhibited(0x201d, { kinsoku: 'strict' })).toBe(true); // ”
  });

  it('allows small kana in loose mode', () => {
    expect(isLineStartProhibited(0x3041, { kinsoku: 'loose' })).toBe(false); // ぁ
    expect(isLineStartProhibited(0x30c3, { kinsoku: 'loose' })).toBe(false); // ッ
    expect(isLineStartProhibited(0x30fc, { kinsoku: 'loose' })).toBe(false); // ー
  });

  it('still prohibits punctuation in loose mode', () => {
    expect(isLineStartProhibited(0x3001, { kinsoku: 'loose' })).toBe(true); // 、
    expect(isLineStartProhibited(0x300d, { kinsoku: 'loose' })).toBe(true); // 」
  });

  it('allows regular characters', () => {
    expect(isLineStartProhibited(0x3042, { kinsoku: 'strict' })).toBe(false); // あ
    expect(isLineStartProhibited(0x6f22, { kinsoku: 'strict' })).toBe(false); // 漢
  });

  it('uses custom rules when provided', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x0041], // 'A'
      lineEndProhibited: [0x0042], // 'B'
    });
    expect(isLineStartProhibited(0x0041, { kinsoku: rules })).toBe(true);
    // Original rules no longer apply when custom rules are passed
    expect(isLineStartProhibited(0x3001, { kinsoku: rules })).toBe(false);
  });
});

describe('isLineEndProhibited', () => {
  it('prohibits opening brackets', () => {
    expect(isLineEndProhibited(0x300c)).toBe(true); // 「
    expect(isLineEndProhibited(0x3010)).toBe(true); // 【
    expect(isLineEndProhibited(0x301d)).toBe(true); // 〝
    expect(isLineEndProhibited(0x201c)).toBe(true); // “
  });

  it('allows regular characters', () => {
    expect(isLineEndProhibited(0x3042)).toBe(false); // あ
  });

  it('uses custom rules when provided', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x0041],
      lineEndProhibited: [0x0042], // 'B'
    });
    expect(isLineEndProhibited(0x0042, { kinsoku: rules })).toBe(true);
    // Original rules no longer apply
    expect(isLineEndProhibited(0x300c, { kinsoku: rules })).toBe(false);
  });
});

describe('isUnbreakablePair', () => {
  it('keeps repeated leader and dash marks together by default', () => {
    expect(isUnbreakablePair(0x2026, 0x2026)).toBe(true); // ……
    expect(isUnbreakablePair(0x2025, 0x2025)).toBe(true); // ‥‥
    expect(isUnbreakablePair(0x2015, 0x2015)).toBe(true); // ――
  });

  it('uses custom pair rules when provided', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [],
      lineEndProhibited: [],
      unbreakablePairs: [[0x0041, 0x0042]],
    });
    expect(isUnbreakablePair(0x0041, 0x0042, { kinsoku: rules })).toBe(true);
    expect(isUnbreakablePair(0x2026, 0x2026, { kinsoku: rules })).toBe(false);
  });
});

describe('getDefaultKinsokuRules / buildKinsokuRules', () => {
  it('returns default rules that answer through the predicates', () => {
    const rules = getDefaultKinsokuRules();
    expect(rules.lineStartProhibited).toContain(0x3001);
    expect(rules.lineEndProhibited).toContain(0x300c);
    expect(rules.unbreakablePairs).toContainEqual([0x2026, 0x2026]);
    expect(isLineStartProhibited(0x3001, { kinsoku: rules })).toBe(true);
    expect(isLineEndProhibited(0x300c, { kinsoku: rules })).toBe(true);
    expect(isUnbreakablePair(0x2026, 0x2026, { kinsoku: rules })).toBe(true);
  });

  it('buildKinsokuRules creates rules that answer through the predicates', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x0041],
      lineEndProhibited: [0x0042],
    });
    expect(isLineStartProhibited(0x0041, { kinsoku: rules })).toBe(true);
    expect(isLineEndProhibited(0x0042, { kinsoku: rules })).toBe(true);
  });
});

/** Full-width counterpart of a half-width codepoint, or undefined when it has none. */
function fullWidthOf(cp: number): number | undefined {
  if (cp >= 0x21 && cp <= 0x7e) return cp + 0xfee0;
  if (cp >= 0xff61 && cp <= 0xff9f)
    return String.fromCodePoint(cp).normalize('NFKC').codePointAt(0);
  return undefined;
}

const HALF_WIDTH_CANDIDATES = [
  ...Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => 0x21 + i),
  ...Array.from({ length: 0xff9f - 0xff61 + 1 }, (_, i) => 0xff61 + i),
];

describe('half-width forms', () => {
  it.each(['strict', 'loose'] as const)(
    'treats a half-width form like its full-width form at line start (%s)',
    (mode) => {
      for (const cp of HALF_WIDTH_CANDIDATES) {
        const full = fullWidthOf(cp);
        if (full === undefined || !isLineStartProhibited(full, { kinsoku: mode })) continue;
        expect(isLineStartProhibited(cp, { kinsoku: mode }), `U+${cp.toString(16)}`).toBe(true);
      }
    },
  );

  it('treats a half-width form like its full-width form at line end', () => {
    for (const cp of HALF_WIDTH_CANDIDATES) {
      const full = fullWidthOf(cp);
      if (full === undefined || !isLineEndProhibited(full)) continue;
      expect(isLineEndProhibited(cp), `U+${cp.toString(16)}`).toBe(true);
    }
  });

  it('never starts a line of half-width katakana with the prolonged sound mark', () => {
    const text = 'ｱｲｳｴｰｵｶｷｸｰｹｺｻｼｽｰｾｿ';
    const codepoints = toCodepoints(text);
    const chars = [...text];
    for (let width = 32; width <= 96; width += 8) {
      const { breakPoints } = computeBreaks({
        text: codepoints,
        advances: new Float32Array(codepoints.length).fill(8),
        lineWidth: width,
      });
      for (const [start] of getLineRanges(breakPoints, chars.length).slice(1)) {
        expect(chars[start]).not.toBe('ｰ');
      }
    }
  });
});
