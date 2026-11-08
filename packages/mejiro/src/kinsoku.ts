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
  // Half-width forms of the marks above
  0x002c, // ,
  0x002e, // .
  0x003a, // :
  0x003b, // ;
  0x003f, // ?
  0x0021, // !
  0x0029, // )
  0x005d, // ]
  0x007d, // }
  0xff61, // ｡
  0xff63, // ｣
  0xff64, // ､
  0xff65, // ･
  0xff70, // ｰ
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
  0xff67, // ｧ
  0xff68, // ｨ
  0xff69, // ｩ
  0xff6a, // ｪ
  0xff6b, // ｫ
  0xff6c, // ｬ
  0xff6d, // ｭ
  0xff6e, // ｮ
  0xff6f, // ｯ
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
  0xff67,
  0xff68,
  0xff69,
  0xff6a,
  0xff6b, // ｧｨｩｪｫ
  0xff6c,
  0xff6d,
  0xff6e,
  0xff6f, // ｬｭｮｯ
  // Long vowel mark
  0x30fc, // ー
  0xff70, // ｰ
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
  // Half-width forms of the marks above
  0x0028, // (
  0x005b, // [
  0x007b, // {
  0xff62, // ｢
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
 * Raw kinsoku lists that {@link buildKinsokuRules} turns into
 * {@link KinsokuRules}.
 */
export interface KinsokuRuleSource {
  /** Codepoints prohibited at the start of a line. */
  readonly lineStartProhibited: readonly number[];
  /** Codepoints prohibited at the end of a line. */
  readonly lineEndProhibited: readonly number[];
  /**
   * Adjacent codepoint pairs that must not be split across lines.
   * @defaultValue []
   */
  readonly unbreakablePairs?: readonly (readonly [number, number])[];
}

/** Options shared by the kinsoku predicates. */
export interface KinsokuCheckOptions {
  /**
   * Kinsoku rules to apply: a built-in mode, or custom rules, which replace the
   * built-in ones entirely.
   * @defaultValue 'strict'
   */
  kinsoku?: KinsokuMode | KinsokuRules;
}

/** Lookup sets of one rule set, built once per {@link KinsokuRules} object. */
interface RuleSets {
  lineStart: ReadonlySet<number>;
  lineEnd: ReadonlySet<number>;
  pairs: ReadonlySet<string>;
}

/** Lookup sets keyed by the rules object they were built from; the rules stay free of them. */
const ruleSets = new WeakMap<KinsokuRules, RuleSets>();

/** A kinsoku argument resolved to what the predicates read. @internal */
export interface ResolvedKinsoku {
  mode: KinsokuMode;
  sets: RuleSets | undefined;
}

const DEFAULT_RESOLVED: ResolvedKinsoku = { mode: 'strict', sets: undefined };
const LOOSE_RESOLVED: ResolvedKinsoku = { mode: 'loose', sets: undefined };

/**
 * Resolves a `kinsoku` option once, so a hot loop does not repeat the checks.
 *
 * @param kinsoku - Mode or custom rules; `undefined` means `'strict'`.
 * @throws RangeError when a string is not a known mode.
 * @throws TypeError when the value is neither a mode string nor a rules object.
 * @internal
 */
export function resolveKinsoku(kinsoku: KinsokuMode | KinsokuRules | undefined): ResolvedKinsoku {
  if (kinsoku === undefined || kinsoku === 'strict') return DEFAULT_RESOLVED;
  if (kinsoku === 'loose') return LOOSE_RESOLVED;
  if (typeof kinsoku === 'string') {
    throw new RangeError(
      `kinsoku: unknown mode "${kinsoku}"; use 'strict', 'loose' or custom rules`,
    );
  }
  if (typeof kinsoku !== 'object' || kinsoku === null) {
    throw new TypeError('kinsoku must be a mode string or rules from buildKinsokuRules()');
  }
  let sets = ruleSets.get(kinsoku);
  if (!sets) {
    if (
      !(
        Array.isArray(kinsoku.lineStartProhibited) &&
        Array.isArray(kinsoku.lineEndProhibited) &&
        Array.isArray(kinsoku.unbreakablePairs)
      )
    ) {
      throw new TypeError('kinsoku must be a mode string or rules from buildKinsokuRules()');
    }
    sets = setsOf(kinsoku);
    ruleSets.set(kinsoku, sets);
  }
  return { mode: 'strict', sets };
}

function setsOf(rules: KinsokuRuleSource): RuleSets {
  return {
    lineStart: new Set(rules.lineStartProhibited),
    lineEnd: new Set(rules.lineEndProhibited),
    pairs: new Set((rules.unbreakablePairs ?? []).map(([left, right]) => pairKey(left, right))),
  };
}

/** {@link isLineStartProhibited} on an already resolved argument. @internal */
export function startProhibited(codepoint: number, resolved: ResolvedKinsoku): boolean {
  if (resolved.sets) return resolved.sets.lineStart.has(codepoint);
  if (!STRICT_LINE_START_PROHIBITED.has(codepoint)) return false;
  return !(resolved.mode === 'loose' && LOOSE_LINE_START_EXCLUSIONS.has(codepoint));
}

/** {@link isLineEndProhibited} on an already resolved argument. @internal */
export function endProhibited(codepoint: number, resolved: ResolvedKinsoku): boolean {
  return resolved.sets ? resolved.sets.lineEnd.has(codepoint) : LINE_END_PROHIBITED.has(codepoint);
}

/** {@link isUnbreakablePair} on an already resolved argument. @internal */
export function pairUnbreakable(left: number, right: number, resolved: ResolvedKinsoku): boolean {
  const key = pairKey(left, right);
  return resolved.sets ? resolved.sets.pairs.has(key) : DEFAULT_UNBREAKABLE_PAIR_SET.has(key);
}

/**
 * Returns whether the given codepoint is prohibited at the start of a line.
 *
 * @param codepoint - Unicode codepoint to check.
 * @param options - Kinsoku rules to apply. @defaultValue strict mode
 * @throws RangeError when `options.kinsoku` is a string that is not a known mode.
 * @throws TypeError when `options.kinsoku` is neither a mode string nor rules.
 */
export function isLineStartProhibited(codepoint: number, options?: KinsokuCheckOptions): boolean {
  return startProhibited(codepoint, resolveKinsoku(options?.kinsoku));
}

/**
 * Returns whether the given codepoint is prohibited at the end of a line.
 *
 * Strict and loose mode prohibit the same line-end characters.
 *
 * @param codepoint - Unicode codepoint to check.
 * @param options - Kinsoku rules to apply. @defaultValue strict mode
 * @throws RangeError when `options.kinsoku` is a string that is not a known mode.
 * @throws TypeError when `options.kinsoku` is neither a mode string nor rules.
 */
export function isLineEndProhibited(codepoint: number, options?: KinsokuCheckOptions): boolean {
  return endProhibited(codepoint, resolveKinsoku(options?.kinsoku));
}

/**
 * Returns whether a break between adjacent codepoints is prohibited by pair rules.
 *
 * @param left - Codepoint before the proposed line break.
 * @param right - Codepoint after the proposed line break.
 * @param options - Kinsoku rules to apply. @defaultValue strict mode
 * @throws RangeError when `options.kinsoku` is a string that is not a known mode.
 * @throws TypeError when `options.kinsoku` is neither a mode string nor rules.
 */
export function isUnbreakablePair(
  left: number,
  right: number,
  options?: KinsokuCheckOptions,
): boolean {
  return pairUnbreakable(left, right, resolveKinsoku(options?.kinsoku));
}

const DEFAULT_UNBREAKABLE_PAIR_SET = new Set(
  UNBREAKABLE_PAIRS.map(([left, right]) => pairKey(left, right)),
);

/**
 * Returns a copy of the default strict kinsoku rules.
 *
 * Pass it to {@link extendKinsokuRules} to add to the defaults.
 */
export function getDefaultKinsokuRules(): KinsokuRules {
  return buildKinsokuRules({
    lineStartProhibited: [...STRICT_LINE_START_PROHIBITED],
    lineEndProhibited: [...LINE_END_PROHIBITED],
    unbreakablePairs: UNBREAKABLE_PAIRS,
  });
}

/**
 * Builds custom kinsoku rules from raw codepoint lists.
 *
 * The lists are copied and frozen, so changing the arrays passed in afterwards
 * does not change the rules.
 *
 * @param source - The codepoints and pairs to prohibit.
 * @returns Rules to pass as the `kinsoku` option.
 */
export function buildKinsokuRules(source: KinsokuRuleSource): KinsokuRules {
  const rules: KinsokuRules = Object.freeze({
    lineStartProhibited: Object.freeze([...source.lineStartProhibited]),
    lineEndProhibited: Object.freeze([...source.lineEndProhibited]),
    unbreakablePairs: Object.freeze(
      (source.unbreakablePairs ?? []).map(([left, right]) => Object.freeze([left, right] as const)),
    ),
  });
  ruleSets.set(rules, setsOf(rules));
  return rules;
}

/**
 * Returns rules that prohibit everything `base` does plus `additions`.
 *
 * @example
 * ```ts
 * // The default rules, with ％ also kept off the start of a line.
 * const rules = extendKinsokuRules(getDefaultKinsokuRules(), { lineStartProhibited: [0xff05] });
 * ```
 *
 * @param base - Rules to start from.
 * @param additions - Lists to append to the matching lists of `base`; omitted lists add nothing.
 * @returns New rules; `base` is unchanged.
 */
export function extendKinsokuRules(
  base: KinsokuRules,
  additions: Partial<KinsokuRuleSource>,
): KinsokuRules {
  return buildKinsokuRules({
    lineStartProhibited: [...base.lineStartProhibited, ...(additions.lineStartProhibited ?? [])],
    lineEndProhibited: [...base.lineEndProhibited, ...(additions.lineEndProhibited ?? [])],
    unbreakablePairs: [...base.unbreakablePairs, ...(additions.unbreakablePairs ?? [])],
  });
}
