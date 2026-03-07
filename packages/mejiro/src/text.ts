/**
 * Converts a string to a Uint32Array of Unicode codepoints.
 *
 * This is the recommended way to prepare text input for {@link computeBreaks},
 * which requires a `Uint32Array` of codepoints.
 *
 * @param str - Input string.
 * @returns Uint32Array of Unicode codepoints.
 */
export function toCodepoints(str: string): Uint32Array {
  const cps: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) cps.push(cp);
  }
  return new Uint32Array(cps);
}
