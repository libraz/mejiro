/** Punctuation characters eligible for hanging at line end. */
const HANGING_TARGETS = new Set([
  0x3001, // 、
  0x3002, // 。
  0xff0c, // ，
  0xff0e, // ．
]);

/**
 * Returns whether the given codepoint is eligible for hanging punctuation.
 * @param codepoint - Unicode codepoint to check.
 */
export function isHangingTarget(codepoint: number): boolean {
  return HANGING_TARGETS.has(codepoint);
}

/**
 * Computes the hanging adjustment amount for a character.
 * @param codepoint - Unicode codepoint of the character.
 * @param advance - Advance width of the character in pixels.
 * @returns The hanging overhang amount, or 0 if not a hanging target.
 */
export function computeHangingAdjustment(codepoint: number, advance: number): number {
  return isHangingTarget(codepoint) ? advance : 0;
}
