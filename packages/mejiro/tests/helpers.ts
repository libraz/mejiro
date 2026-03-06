/**
 * Converts a string to a Uint32Array of Unicode codepoints.
 */
export function toCodepoints(str: string): Uint32Array {
  const cps: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) cps.push(cp);
  }
  return new Uint32Array(cps);
}

/**
 * Creates a Float32Array of uniform advances.
 */
export function uniformAdvances(length: number, width: number): Float32Array {
  const arr = new Float32Array(length);
  arr.fill(width);
  return arr;
}
