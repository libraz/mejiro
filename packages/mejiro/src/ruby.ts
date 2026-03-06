/** Ruby annotation type per JLReq. */
export type RubyType = 'mono' | 'group' | 'jukugo';

/**
 * A ruby annotation over a contiguous span of base text.
 * Indices refer to positions in the base text's codepoint array.
 */
export interface RubyAnnotation {
  /** Start index in base text (inclusive). */
  startIndex: number;
  /** End index in base text (exclusive). */
  endIndex: number;
  /** Ruby text as Unicode codepoints. */
  rubyText: Uint32Array;
  /** Advance widths of each ruby character in px. */
  rubyAdvances: Float32Array;
  /** @defaultValue 'mono' */
  type?: RubyType;
  /**
   * For jukugo ruby: base-text-relative indices where line breaks are permitted.
   * E.g., 東京都 (indices 0,1,2) with splitPoints [1,2] allows breaks after 東 and 京.
   */
  jukugoSplitPoints?: number[];
}

/**
 * Result of ruby preprocessing: effective advances and cluster IDs
 * that encode ruby constraints for the line breaking algorithm.
 */
export interface RubyPreprocessResult {
  /** Adjusted advance widths accounting for ruby overhang. */
  effectiveAdvances: Float32Array;
  /** Cluster IDs encoding ruby grouping constraints. */
  clusterIds: Uint32Array;
}

/**
 * Returns true if the codepoint is hiragana (U+3040–U+309F) or katakana (U+30A0–U+30FF).
 */
export function isKana(cp: number): boolean {
  return (cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff);
}

/**
 * Preprocesses ruby annotations into effective advances and cluster IDs.
 *
 * Ruby width distribution follows JLReq: when ruby text is wider than base text,
 * excess width is first absorbed by overhang into adjacent kana (up to 50% of
 * the kana's advance), then distributed proportionally across base characters.
 *
 * Clustering prevents line breaks within ruby groups:
 * - `group`: all base characters share one cluster ID (no internal breaks).
 * - `jukugo`: sub-groups between split points share cluster IDs.
 * - `mono`: single base character, no clustering needed.
 *
 * @param text - Base text codepoints.
 * @param advances - Original advance widths.
 * @param annotations - Ruby annotations sorted by startIndex.
 * @param existingClusterIds - Optional pre-existing cluster IDs to merge with.
 * @returns Effective advances and merged cluster IDs.
 */
export function preprocessRuby(
  text: Uint32Array,
  advances: Float32Array,
  annotations: RubyAnnotation[],
  existingClusterIds?: Uint32Array,
): RubyPreprocessResult {
  const len = text.length;
  const effectiveAdvances = new Float32Array(advances);

  // Initialize cluster IDs: use existing or sequential
  let clusterIds: Uint32Array;
  let nextClusterId: number;

  if (existingClusterIds) {
    clusterIds = new Uint32Array(existingClusterIds);
    nextClusterId = 0;
    for (let i = 0; i < clusterIds.length; i++) {
      if (clusterIds[i] >= nextClusterId) {
        nextClusterId = clusterIds[i] + 1;
      }
    }
  } else {
    clusterIds = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      clusterIds[i] = i;
    }
    nextClusterId = len;
  }

  // Sort annotations by startIndex for consistent processing
  const sorted = [...annotations].sort((a, b) => a.startIndex - b.startIndex);

  for (const ann of sorted) {
    const { startIndex, endIndex, rubyAdvances } = ann;
    const type = ann.type ?? 'mono';

    // Calculate base and ruby widths
    let baseWidth = 0;
    for (let i = startIndex; i < endIndex; i++) {
      baseWidth += advances[i];
    }

    let rubyWidth = 0;
    for (let i = 0; i < rubyAdvances.length; i++) {
      rubyWidth += rubyAdvances[i];
    }

    // Ruby overhang into adjacent kana (JLReq)
    const excess = rubyWidth - baseWidth;
    if (excess > 0) {
      let leftOverhang = 0;
      let rightOverhang = 0;

      if (startIndex > 0 && isKana(text[startIndex - 1])) {
        leftOverhang = Math.min(advances[startIndex - 1] * 0.5, excess * 0.5);
      }
      if (endIndex < len && isKana(text[endIndex])) {
        rightOverhang = Math.min(advances[endIndex] * 0.5, excess * 0.5);
      }

      const netExcess = Math.max(0, excess - leftOverhang - rightOverhang);

      // Distribute net excess proportionally across base chars
      if (netExcess > 0 && baseWidth > 0) {
        for (let i = startIndex; i < endIndex; i++) {
          effectiveAdvances[i] += netExcess * (advances[i] / baseWidth);
        }
      }
    }

    // Clustering based on ruby type
    if (type === 'group') {
      const cid = nextClusterId++;
      for (let i = startIndex; i < endIndex; i++) {
        clusterIds[i] = cid;
      }
    } else if (type === 'jukugo' && ann.jukugoSplitPoints?.length) {
      // Create sub-groups between split points
      const splits = [0, ...ann.jukugoSplitPoints, endIndex - startIndex];
      for (let s = 0; s < splits.length - 1; s++) {
        const groupStart = startIndex + splits[s];
        const groupEnd = startIndex + splits[s + 1];
        if (groupEnd - groupStart > 1) {
          const cid = nextClusterId++;
          for (let i = groupStart; i < groupEnd; i++) {
            clusterIds[i] = cid;
          }
        }
      }
    }
    // mono: single base char, no clustering needed
  }

  return { effectiveAdvances, clusterIds };
}
