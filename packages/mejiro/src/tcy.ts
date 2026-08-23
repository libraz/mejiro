import type { InlineAnnotation } from './browser/types.js';

/**
 * A tate-chu-yoko (縦中横) span: characters drawn side by side inside a single
 * upright box of a vertical column.
 *
 * Indices refer to positions in the base text's codepoint array. The span is
 * indivisible and occupies {@link TcyAnnotation.advance} in the inline
 * direction regardless of how wide its characters measure on their own,
 * because `text-combine-upright` collapses them into one box.
 */
export interface TcyAnnotation {
  /** Start index in base text (inclusive). */
  startIndex: number;
  /** End index in base text (exclusive). */
  endIndex: number;
  /**
   * Inline extent the combined box occupies in px — one em of the font the
   * span is drawn with, which is what `text-combine-upright: all` produces.
   */
  advance: number;
}

/**
 * Result of tate-chu-yoko preprocessing: effective advances and cluster IDs
 * that encode the combined boxes for the line breaking algorithm.
 */
export interface TcyPreprocessResult {
  /** Advance widths with every combined span collapsed to its box width. */
  effectiveAdvances: Float32Array;
  /** Cluster IDs marking each combined span as indivisible. */
  clusterIds: Uint32Array;
}

/**
 * Collects the tate-chu-yoko spans of an inline annotation list.
 *
 * @param annotations - Inline annotations of one paragraph, or `undefined`.
 * @param em - Font size in px of the text the spans sit in; one em is the
 *   inline extent a combined box occupies.
 * @returns The tcy spans, or `undefined` when the paragraph has none — which
 *   lets callers keep the "no annotations, no preprocessing" fast path.
 */
export function buildTcyAnnotations(
  annotations: readonly InlineAnnotation[] | undefined,
  em: number,
): TcyAnnotation[] | undefined {
  if (!annotations?.length) return undefined;
  const spans: TcyAnnotation[] = [];
  for (const ann of annotations) {
    if (ann.kind === 'tcy') {
      spans.push({ startIndex: ann.startIndex, endIndex: ann.endIndex, advance: em });
    }
  }
  return spans.length > 0 ? spans : undefined;
}

/**
 * Preprocesses tate-chu-yoko spans into effective advances and cluster IDs.
 *
 * A combined span reserves exactly its box width rather than the sum of its
 * characters' advances, and shares one cluster ID so the line breaker cannot
 * split it across a column boundary. The box width is spread over the span's
 * characters in proportion to their measured advances, so anchor rectangles
 * and hit tests stay monotonic inside the span.
 *
 * Unlike ruby, malformed input is skipped rather than rejected: these spans
 * come from arbitrary EPUB markup, and a broken one must not stop a chapter
 * from being laid out. Ignored are spans that are empty, reversed, out of
 * range, non-integral, carry a non-finite advance, or overlap a span that was
 * already applied (earlier start wins, then the longer one).
 *
 * @param text - Base text codepoints.
 * @param advances - Measured advance widths.
 * @param annotations - Tate-chu-yoko spans in any order.
 * @param existingClusterIds - Optional pre-existing cluster IDs to merge with.
 * @returns Effective advances and merged cluster IDs.
 */
export function preprocessTcy(
  text: Uint32Array,
  advances: Float32Array,
  annotations: readonly TcyAnnotation[],
  existingClusterIds?: Uint32Array,
): TcyPreprocessResult {
  const len = text.length;
  const effectiveAdvances = new Float32Array(advances);

  let clusterIds: Uint32Array;
  let nextClusterId: number;
  if (existingClusterIds) {
    clusterIds = new Uint32Array(existingClusterIds);
    nextClusterId = 0;
    for (let i = 0; i < clusterIds.length; i++) {
      if (clusterIds[i] >= nextClusterId) nextClusterId = clusterIds[i] + 1;
    }
  } else {
    clusterIds = new Uint32Array(len);
    for (let i = 0; i < len; i++) clusterIds[i] = i;
    nextClusterId = len;
  }

  let appliedEnd = 0;
  for (const ann of sortedTcySpans(annotations, len)) {
    const { startIndex, endIndex, advance } = ann;
    if (startIndex < appliedEnd) continue;
    appliedEnd = endIndex;

    let baseWidth = 0;
    for (let i = startIndex; i < endIndex; i++) baseWidth += advances[i];

    const span = endIndex - startIndex;
    for (let i = startIndex; i < endIndex; i++) {
      effectiveAdvances[i] = baseWidth > 0 ? advance * (advances[i] / baseWidth) : advance / span;
    }

    const cid = nextClusterId++;
    for (let i = startIndex; i < endIndex; i++) clusterIds[i] = cid;
  }

  return { effectiveAdvances, clusterIds };
}

/**
 * Drops the spans {@link preprocessTcy} cannot honour and orders the rest so
 * the overlap rule ("earlier start wins, then the longer one") is a single
 * forward scan.
 */
function sortedTcySpans(
  annotations: readonly TcyAnnotation[],
  textLength: number,
): TcyAnnotation[] {
  return annotations
    .filter(
      (ann) =>
        Number.isInteger(ann.startIndex) &&
        Number.isInteger(ann.endIndex) &&
        ann.startIndex >= 0 &&
        ann.endIndex <= textLength &&
        ann.endIndex > ann.startIndex &&
        Number.isFinite(ann.advance) &&
        ann.advance >= 0,
    )
    .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
}
