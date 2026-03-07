export { toCodepoints } from '../src/text.js';

/**
 * Creates a Float32Array of uniform advances.
 */
export function uniformAdvances(length: number, width: number): Float32Array {
  const arr = new Float32Array(length);
  arr.fill(width);
  return arr;
}
