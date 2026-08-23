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
  /** Adjusted advance widths accounting for the width ruby text reserves. */
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
 * When ruby text is wider than its base text, the excess is distributed
 * proportionally across the base characters, so an annotated span reserves the
 * larger of its base width and its ruby width. Ruby is never charged to a
 * neighbouring character: the render layer draws each annotation inside its own
 * span, so the sum of the effective advances on a line is an upper bound for
 * the inline extent that rendering produces and ruby is never clipped.
 *
 * Clustering prevents line breaks within ruby groups:
 * - `group`: all base characters share one cluster ID (no internal breaks).
 * - `jukugo`: sub-groups between split points share cluster IDs.
 * - `mono`: single base character, no clustering needed.
 *
 * A `jukugo` annotation that fully covers other annotations is an aggregate:
 * it only contributes split points, while the covered annotations own the
 * ruby text and therefore the width. Annotations must not otherwise overlap.
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
  // Sort annotations (outermost first) for consistent processing
  const sorted = normalizeRubyAnnotations(annotations);
  const aggregates = new Set(sorted.filter((ann) => isAggregateJukugo(ann, sorted)));
  validateRubyInput(text, advances, sorted, aggregates, existingClusterIds);
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

  // Aggregate jukugo annotations carry no width of their own: the covered
  // annotations already reserve room for the same ruby text.
  const sized = sorted.filter((ann) => !aggregates.has(ann));

  for (const ann of sized) {
    const { startIndex, endIndex, rubyAdvances } = ann;

    // Calculate base and ruby widths
    let baseWidth = 0;
    for (let i = startIndex; i < endIndex; i++) {
      baseWidth += advances[i];
    }

    let rubyWidth = 0;
    for (let i = 0; i < rubyAdvances.length; i++) {
      rubyWidth += rubyAdvances[i];
    }

    // Ruby wider than its base reserves the whole difference on the base
    // characters, distributed proportionally.
    const excess = rubyWidth - baseWidth;
    if (excess > 0 && baseWidth > 0) {
      for (let i = startIndex; i < endIndex; i++) {
        effectiveAdvances[i] += excess * (advances[i] / baseWidth);
      }
    }
  }

  // Clustering runs over every annotation, outermost first, so a covered
  // annotation's stronger constraint wins over the aggregate's split points.
  for (const ann of sorted) {
    const { startIndex, endIndex } = ann;
    const type = ann.type ?? 'mono';

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

function validateRubyInput(
  text: Uint32Array,
  advances: Float32Array,
  sorted: readonly RubyAnnotation[],
  aggregates: ReadonlySet<RubyAnnotation>,
  existingClusterIds?: Uint32Array,
): void {
  const len = text.length;
  if (advances.length !== len) {
    throw new RangeError(
      `preprocessRuby: advances length (${advances.length}) must match text length (${len})`,
    );
  }
  if (existingClusterIds && existingClusterIds.length !== len) {
    throw new RangeError(
      `preprocessRuby: existingClusterIds length (${existingClusterIds.length}) must match text length (${len})`,
    );
  }
  for (let i = 0; i < advances.length; i++) {
    if (!Number.isFinite(advances[i]) || advances[i] < 0) {
      throw new RangeError(`preprocessRuby: advances[${i}] must be a finite non-negative number`);
    }
  }

  // Aggregate jukugo annotations open a nesting level: the annotations they
  // cover must be disjoint among themselves and stay inside the aggregate.
  const levels: { end: number; previousEnd: number }[] = [{ end: len, previousEnd: -1 }];
  for (const ann of sorted) {
    if (!(Number.isInteger(ann.startIndex) && Number.isInteger(ann.endIndex))) {
      throw new RangeError('preprocessRuby: annotation indices must be integers');
    }
    if (ann.startIndex < 0 || ann.endIndex > len || ann.endIndex <= ann.startIndex) {
      throw new RangeError(
        `preprocessRuby: annotation range [${ann.startIndex}, ${ann.endIndex}) is outside text length ${len}`,
      );
    }
    while (levels.length > 1 && ann.startIndex >= levels[levels.length - 1].end) {
      levels.pop();
    }
    const level = levels[levels.length - 1];
    if (ann.startIndex < level.previousEnd || ann.endIndex > level.end) {
      throw new RangeError('preprocessRuby: overlapping ruby annotations are not supported');
    }
    level.previousEnd = ann.endIndex;
    if (aggregates.has(ann)) {
      levels.push({ end: ann.endIndex, previousEnd: -1 });
    }

    if (ann.rubyAdvances.length !== ann.rubyText.length) {
      throw new RangeError(
        `preprocessRuby: rubyAdvances length (${ann.rubyAdvances.length}) must match rubyText length (${ann.rubyText.length})`,
      );
    }
    for (let i = 0; i < ann.rubyAdvances.length; i++) {
      if (!Number.isFinite(ann.rubyAdvances[i]) || ann.rubyAdvances[i] < 0) {
        throw new RangeError(
          `preprocessRuby: rubyAdvances[${i}] must be a finite non-negative number`,
        );
      }
    }
    if ((ann.type ?? 'mono') === 'mono' && ann.endIndex - ann.startIndex !== 1) {
      throw new RangeError(
        'preprocessRuby: mono ruby annotations must cover exactly one base char',
      );
    }
  }
}

/**
 * Returns true when `ann` is a jukugo annotation that fully covers at least one
 * other annotation — i.e. it aggregates per-segment ruby and only supplies
 * split points.
 */
function isAggregateJukugo(ann: RubyAnnotation, annotations: readonly RubyAnnotation[]): boolean {
  if ((ann.type ?? 'mono') !== 'jukugo') return false;
  const span = ann.endIndex - ann.startIndex;
  return annotations.some(
    (other) =>
      other !== ann &&
      other.startIndex >= ann.startIndex &&
      other.endIndex <= ann.endIndex &&
      (other.endIndex - other.startIndex < span || (other.type ?? 'mono') !== 'jukugo'),
  );
}

function normalizeRubyAnnotations(annotations: readonly RubyAnnotation[]): RubyAnnotation[] {
  return [...annotations]
    .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex)
    .map((ann) => {
      if ((ann.type ?? 'mono') !== 'jukugo') return ann;
      const span = ann.endIndex - ann.startIndex;
      const splitPoints = Array.from(
        new Set(
          (ann.jukugoSplitPoints ?? [])
            .map((point) => Math.trunc(point))
            .map((point) => Math.max(1, Math.min(span - 1, point))),
        ),
      ).sort((a, b) => a - b);
      return { ...ann, jukugoSplitPoints: splitPoints };
    });
}
