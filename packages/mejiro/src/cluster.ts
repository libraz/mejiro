import { mergeClusterIds } from './typography-hints.js';

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

/**
 * Returns whether `pos` and `pos+1` belong to the same grapheme cluster by
 * Unicode's extension rules: a Grapheme_Extend codepoint (combining marks,
 * variation selectors, half-width sound marks, tag characters) or an emoji
 * modifier attaches to its base, a ZWJ joins both
 * neighbours, and regional indicators pair up. Independent of cluster IDs.
 *
 * @param text - Unicode codepoint array.
 * @param pos - Position to check (a break would occur after this index).
 * @param pairStarts - {@link regionalIndicatorPairStarts} of `text`, which
 *   replaces the walk back over a regional-indicator run.
 */
export function isGraphemeContinuation(
  text: Uint32Array,
  pos: number,
  pairStarts?: Uint8Array,
): boolean {
  if (pos < 0 || pos + 1 >= text.length) return false;
  const next = text[pos + 1];
  if (isGraphemeExtender(next) || text[pos] === ZWJ) return true;
  if (isRegionalIndicator(text[pos]) && isRegionalIndicator(next)) {
    if (pairStarts) return pairStarts[pos] === 1;
    // Indicators pair from the start of their run; an odd run length up to `pos` is mid-pair.
    let run = 0;
    for (let j = pos; j >= 0 && isRegionalIndicator(text[j]); j--) run++;
    return run % 2 === 1;
  }
  return false;
}

/**
 * Marks every position whose regional indicator opens a pair with the next one,
 * in one pass, so a caller querying many positions does not walk each run again.
 *
 * @param text - Unicode codepoint array.
 * @returns Per-position flags, or `undefined` when `text` holds no adjacent indicators.
 */
export function regionalIndicatorPairStarts(text: Uint32Array): Uint8Array | undefined {
  let starts: Uint8Array | undefined;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    run = isRegionalIndicator(text[i]) ? run + 1 : 0;
    if (run % 2 === 1 && i + 1 < text.length && isRegionalIndicator(text[i + 1])) {
      starts ??= new Uint8Array(text.length);
      starts[i] = 1;
    }
  }
  return starts;
}

const ZWJ = 0x200d;

const GRAPHEME_EXTEND = /\p{Grapheme_Extend}/u;
let bmpExtenders: Uint8Array | undefined;

/** Grapheme_Extend from the Unicode tables, plus ZWJ and emoji modifiers, which also attach. */
function isGraphemeExtender(cp: number): boolean {
  if (cp === ZWJ || (cp >= 0x1f3fb && cp <= 0x1f3ff)) return true;
  if (cp < 0x0300) return false;
  if (cp > 0xffff) return GRAPHEME_EXTEND.test(String.fromCodePoint(cp));
  if (!bmpExtenders) {
    // One pass over the BMP replaces a per-position regex test on the break path.
    bmpExtenders = new Uint8Array(0x10000);
    for (let c = 0x0300; c <= 0xffff; c++) {
      if (GRAPHEME_EXTEND.test(String.fromCharCode(c))) bmpExtenders[c] = 1;
    }
  }
  return bmpExtenders[cp] === 1;
}

function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/**
 * Joins an annotation preprocessor's own clusters with the caller's, as their
 * transitive closure, so a caller cluster reaching past an annotation span
 * stays joined to it. Each class keeps the caller's ID of its first position,
 * so a caller cluster no annotation touches comes back with its ID unchanged.
 *
 * @param existing - Caller-supplied cluster IDs, or `undefined`.
 * @param own - Cluster IDs the preprocessor derived from its annotations alone.
 * @returns `own` when there is nothing usable to merge, otherwise a fresh array.
 */
export function mergeAnnotationClusters(
  existing: Uint32Array | undefined,
  own: Uint32Array,
): Uint32Array {
  // A length mismatch describes other text and is ignored, as mergeClusterIds does.
  if (existing?.length !== own.length) return own;
  const merged = mergeClusterIds(own.length, existing, own) ?? own;
  // mergeClusterIds labels each class by its lowest position.
  for (let i = 0; i < merged.length; i++) merged[i] = existing[merged[i]];
  return merged;
}
