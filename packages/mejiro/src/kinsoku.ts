import type { KinsokuMode, KinsokuRules } from './types.js';

/** Characters prohibited at the start of a line (strict mode). */
const STRICT_LINE_START_PROHIBITED = new Set([
  // Punctuation and closing brackets
  0x3001, // 、
  0x3002, // 。
  0xff0c, // ，
  0xff0e, // ．
  0x30fb, // ・
  0xff1a, // ：
  0xff1b, // ；
  0xff1f, // ？
  0xff01, // ！
  0x2025, // ‥
  0x2026, // …
  0x301c, // 〜
  0x2014, // —
  0x2015, // ―
  0x2019, // ’
  0x201d, // ”
  0x30fc, // ー
  0xff09, // ）
  0x3017, // 〗
  0x3019, // 〙
  0x301b, // 〛
  0x3015, // 〕
  0xff3d, // ］
  0xff5d, // ｝
  0x301f, // 〟
  0x3009, // 〉
  0x300b, // 》
  0x300d, // 」
  0x300f, // 』
  0x3011, // 】
  // Small kana
  0x3041, // ぁ
  0x3043, // ぃ
  0x3045, // ぅ
  0x3047, // ぇ
  0x3049, // ぉ
  0x3063, // っ
  0x3083, // ゃ
  0x3085, // ゅ
  0x3087, // ょ
  0x308e, // ゎ
  0x3095, // ゕ
  0x3096, // ゖ
  0x30a1, // ァ
  0x30a3, // ィ
  0x30a5, // ゥ
  0x30a7, // ェ
  0x30a9, // ォ
  0x30c3, // ッ
  0x30e3, // ャ
  0x30e5, // ュ
  0x30e7, // ョ
  0x30ee, // ヮ
  0x30f5, // ヵ
  0x30f6, // ヶ
  // Iteration marks
  0x3005, // 々
  0x303b, // 〻
  0x30fd, // ヽ
  0x30fe, // ヾ
  0x309d, // ゝ
  0x309e, // ゞ
]);

/** Characters excluded from line-start prohibition in loose mode. */
const LOOSE_LINE_START_EXCLUSIONS = new Set([
  // Small kana
  0x3041,
  0x3043,
  0x3045,
  0x3047,
  0x3049, // ぁぃぅぇぉ
  0x3063,
  0x3083,
  0x3085,
  0x3087,
  0x308e, // っゃゅょゎ
  0x30a1,
  0x30a3,
  0x30a5,
  0x30a7,
  0x30a9, // ァィゥェォ
  0x30c3,
  0x30e3,
  0x30e5,
  0x30e7,
  0x30ee, // ッャュョヮ
  0x30f5,
  0x30f6, // ヵヶ
  // Long vowel mark
  0x30fc, // ー
]);

/** Characters prohibited at the end of a line (same for strict and loose). */
const LINE_END_PROHIBITED = new Set([
  0xff08, // （
  0x3016, // 〖
  0x3018, // 〘
  0x301a, // 〚
  0x3014, // 〔
  0xff3b, // ［
  0xff5b, // ｛
  0x301d, // 〝
  0x2018, // ‘
  0x201c, // “
  0x3008, // 〈
  0x300a, // 《
  0x300c, // 「
  0x300e, // 『
  0x3010, // 【
]);

/** Adjacent pairs that should be kept together. */
const UNBREAKABLE_PAIRS: Array<readonly [number, number]> = [
  [0x2025, 0x2025], // ‥‥
  [0x2026, 0x2026], // ……
  [0x2014, 0x2014], // ——
  [0x2015, 0x2015], // ――
];

const pairKey = (left: number, right: number): string => `${left}:${right}`;

/**
 * Returns whether the given codepoint is prohibited at the start of a line.
 * @param codepoint - Unicode codepoint to check.
 * @param mode - Kinsoku mode. Defaults to 'strict'.
 * @param rules - Optional custom kinsoku rules. When provided, mode is ignored.
 */
export function isLineStartProhibited(
  codepoint: number,
  mode: KinsokuMode = 'strict',
  rules?: KinsokuRules,
): boolean {
  if (rules) return rules.lineStartProhibitedSet.has(codepoint);
  if (!STRICT_LINE_START_PROHIBITED.has(codepoint)) return false;
  if (mode === 'loose' && LOOSE_LINE_START_EXCLUSIONS.has(codepoint)) return false;
  return true;
}

/**
 * Returns whether the given codepoint is prohibited at the end of a line.
 * @param codepoint - Unicode codepoint to check.
 * @param rules - Optional custom kinsoku rules. When provided, uses rules instead of defaults.
 */
export function isLineEndProhibited(codepoint: number, rules?: KinsokuRules): boolean {
  if (rules) return rules.lineEndProhibitedSet.has(codepoint);
  return LINE_END_PROHIBITED.has(codepoint);
}

/**
 * Returns whether a break between adjacent codepoints is prohibited by pair rules.
 * @param left - Codepoint before the proposed line break.
 * @param right - Codepoint after the proposed line break.
 * @param rules - Optional custom kinsoku rules. When provided, uses rules instead of defaults.
 */
export function isUnbreakablePair(left: number, right: number, rules?: KinsokuRules): boolean {
  const key = pairKey(left, right);
  if (rules) return rules.unbreakablePairSet.has(key);
  return DEFAULT_UNBREAKABLE_PAIR_SET.has(key);
}

const DEFAULT_UNBREAKABLE_PAIR_SET = new Set(
  UNBREAKABLE_PAIRS.map(([left, right]) => pairKey(left, right)),
);

/**
 * Returns a copy of the default strict kinsoku rules.
 */
export function getDefaultKinsokuRules(): KinsokuRules {
  return buildKinsokuRules({
    lineStartProhibited: [...STRICT_LINE_START_PROHIBITED],
    lineEndProhibited: [...LINE_END_PROHIBITED],
    unbreakablePairs: [...UNBREAKABLE_PAIRS],
  });
}

/**
 * Builds a KinsokuRules object with pre-computed lookup sets from raw codepoint arrays.
 * @param raw - Object with lineStartProhibited and lineEndProhibited codepoint arrays.
 * @returns KinsokuRules with both the raw arrays and pre-computed sets.
 */
export function buildKinsokuRules(raw: {
  lineStartProhibited: number[];
  lineEndProhibited: number[];
  unbreakablePairs?: Array<readonly [number, number]>;
}): KinsokuRules {
  const unbreakablePairs = raw.unbreakablePairs ?? [];
  return {
    ...raw,
    unbreakablePairs,
    lineStartProhibitedSet: new Set(raw.lineStartProhibited),
    lineEndProhibitedSet: new Set(raw.lineEndProhibited),
    unbreakablePairSet: new Set(unbreakablePairs.map(([left, right]) => pairKey(left, right))),
  };
}
