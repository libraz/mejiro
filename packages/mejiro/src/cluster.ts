/**
 * Resolves cluster boundaries into a bitmask of non-breakable positions.
 *
 * Characters sharing the same cluster ID cannot be split across lines.
 * The returned array has `1` at positions where a break is prohibited
 * (i.e. the character at `pos` and `pos+1` belong to the same cluster).
 *
 * @param text - Array of Unicode codepoints.
 * @param clusterIds - Cluster ID for each character. Same ID = indivisible unit.
 * @returns Uint8Array where `1` means "cannot break after this position".
 */
export function resolveClusterBoundaries(text: Uint32Array, clusterIds?: Uint32Array): Uint8Array {
  const len = text.length;
  const noBreak = new Uint8Array(len);
  if (!clusterIds || len === 0) return noBreak;

  for (let i = 0; i < len - 1; i++) {
    if (clusterIds[i] === clusterIds[i + 1]) {
      noBreak[i] = 1;
    }
  }
  return noBreak;
}

/**
 * Returns whether a break is allowed between `pos` and `pos+1`
 * based on cluster membership.
 *
 * @param clusterIds - Cluster ID array (optional).
 * @param pos - Position to check.
 * @param textLength - Total text length.
 */
export function isClusterBreakAllowed(
  clusterIds: Uint32Array | undefined,
  pos: number,
  textLength: number,
): boolean {
  if (!clusterIds) return true;
  if (pos + 1 >= textLength) return true;
  return clusterIds[pos] !== clusterIds[pos + 1];
}
