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
 * Computes the largest overhang a character may take when hanging at line end.
 *
 * This is an upper bound, not the amount an actual line hangs by: the per-line
 * values in `BreakResult.hangingAdjustments` are the width by which the line
 * exceeds its available width, which is at most this value and is smaller
 * whenever the preceding characters do not fill the line exactly.
 *
 * @param codepoint - Unicode codepoint of the character.
 * @param advance - Advance width of the character in pixels.
 * @returns The maximum overhang amount, or 0 if not a hanging target.
 */
export function computeHangingAdjustment(codepoint: number, advance: number): number {
  return isHangingTarget(codepoint) ? advance : 0;
}
