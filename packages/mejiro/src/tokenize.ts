/**
 * Converts an array of token lengths (in codepoints) into a token boundary array
 * suitable for {@link LayoutInput.tokenBoundaries}.
 *
 * Each boundary is the index of the last codepoint in that token.
 * The last token's boundary is omitted since it coincides with text end.
 *
 * @example
 * ```ts
 * // "新しい" (3) + "プログラミング" (7) + "言語" (2)
 * tokenLengthsToBoundaries([3, 7, 2])
 * // → Uint32Array [2, 9]  (break preferred after index 2 and 9)
 * ```
 *
 * @param tokenLengths - Array of token lengths in codepoints from a morphological analyzer.
 * @returns Uint32Array of boundary indices for use in LayoutInput.
 */
export function tokenLengthsToBoundaries(tokenLengths: number[]): Uint32Array {
  if (tokenLengths.length <= 1) return new Uint32Array(0);

  const boundaries = new Uint32Array(tokenLengths.length - 1);
  let pos = 0;
  for (let i = 0; i < tokenLengths.length - 1; i++) {
    pos += tokenLengths[i];
    boundaries[i] = pos - 1;
  }
  return boundaries;
}
