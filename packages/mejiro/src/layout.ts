import { isClusterBreakAllowed } from './cluster.js';
import { isHangingTarget } from './hanging.js';
import { isLineEndProhibited, isLineStartProhibited, isUnbreakablePair } from './kinsoku.js';
import { preprocessRuby } from './ruby.js';
import { preprocessTcy } from './tcy.js';
import type { BreakResult, KinsokuMode, KinsokuRules, LayoutInput } from './types.js';

const LINE_FEED = 10;

/**
 * Computes line break positions for the given layout input.
 *
 * Uses a greedy O(n) algorithm with backtracking for kinsoku rules
 * and optional hanging punctuation support.
 *
 * The shape of the result depends only on the options: `hangingAdjustments` is
 * present exactly when `enableHanging` is true, and `lineWidths` exactly when
 * per-line `lineWidths` were passed. For empty text both are zero-length.
 *
 * A cluster wider than the available line width does not fit on any line; it is
 * split by the forced-break rule. That is the only case in which a break falls
 * between two characters sharing a cluster ID.
 *
 * @param input - Layout parameters including text, advances, and line width.
 * @returns Break points and optional hanging adjustments.
 */
export function computeBreaks(input: LayoutInput): BreakResult {
  validateLayoutInput(input);
  const {
    text,
    lineWidth: defaultLineWidth,
    lineWidths: perLineWidths,
    enableHanging = true,
    mode = 'strict',
    kinsokuRules,
  } = input;
  let { clusterIds } = input;

  // Normalize tokenBoundaries: accept both Uint32Array and number[]
  const rawBoundaries = input.tokenBoundaries;
  const tokenBoundaries =
    rawBoundaries && !(rawBoundaries instanceof Uint32Array)
      ? new Uint32Array(rawBoundaries)
      : rawBoundaries;

  // Build token boundary lookup set for O(1) access
  const tokenBoundarySet = tokenBoundaries?.length ? new Set<number>(tokenBoundaries) : undefined;
  const len = text.length;

  if (len === 0) {
    // Empty text has no lines, but the shape of the result must not depend on
    // the input length: the optional fields are present on every exit path.
    return {
      breakPoints: new Uint32Array(0),
      hangingAdjustments: enableHanging ? new Float32Array(0) : undefined,
      lineWidths: perLineWidths ? new Float32Array(0) : undefined,
    };
  }

  // Annotation pre-processing. Tate-chu-yoko runs first so a ruby span over a
  // combined box distributes its excess over the collapsed width, not over the
  // measured widths the box has already replaced.
  let effectiveAdvances: Float32Array | undefined;
  if (input.tcyAnnotations?.length) {
    const tcy = preprocessTcy(text, input.advances, input.tcyAnnotations, clusterIds);
    effectiveAdvances = tcy.effectiveAdvances;
    clusterIds = tcy.clusterIds;
  }
  if (input.rubyAnnotations?.length) {
    const ruby = preprocessRuby(
      text,
      effectiveAdvances ?? input.advances,
      input.rubyAnnotations,
      clusterIds,
    );
    effectiveAdvances = ruby.effectiveAdvances;
    clusterIds = ruby.clusterIds;
  }

  const adv = effectiveAdvances ?? input.advances;

  const breaks: number[] = [];
  const hangingAdj: number[] = [];
  const usedLineWidths: number[] = [];

  let lineStart = 0;
  let accWidth = 0;
  let lineIndex = 0;

  /** Returns the effective width for the current line. */
  const getLineWidth = (): number =>
    perLineWidths && lineIndex < perLineWidths.length ? perLineWidths[lineIndex] : defaultLineWidth;

  for (let i = 0; i < len; i++) {
    accWidth += adv[i];

    if (text[i] === LINE_FEED) {
      if (i < len - 1) {
        breaks.push(i);
        hangingAdj.push(0);
        usedLineWidths.push(getLineWidth());
        lineIndex++;
      }
      lineStart = i + 1;
      accWidth = 0;
      continue;
    }

    const lineWidth = getLineWidth();

    if (accWidth > lineWidth && i > lineStart) {
      // Allow hanging punctuation to protrude beyond line width
      if (
        enableHanging &&
        isHangingTarget(text[i]) &&
        accWidth - adv[i] <= lineWidth &&
        canBreakAt(text, i, clusterIds, mode, kinsokuRules)
      ) {
        // Skip break at the very last character — no content follows it
        if (i < len - 1) {
          breaks.push(i);
          hangingAdj.push(accWidth - lineWidth);
          usedLineWidths.push(lineWidth);
          lineIndex++;
        }
        lineStart = i + 1;
        accWidth = 0;
        continue;
      }

      // Search backwards for a valid break position.
      // When token boundaries are provided, prefer breaking at token edges.
      let breakPos = i - 1;
      let fallbackPos = -1;
      let whitespacePos = -1;
      let clusterSafePos = -1;
      let foundTokenBoundary = false;
      if (tokenBoundarySet) {
        while (breakPos > lineStart) {
          if (clusterSafePos < 0 && isClusterBreakAllowed(clusterIds, breakPos, text.length)) {
            clusterSafePos = breakPos;
          }
          if (canBreakAt(text, breakPos, clusterIds, mode, kinsokuRules)) {
            if (tokenBoundarySet.has(breakPos)) {
              foundTokenBoundary = true;
              break;
            }
            if (whitespacePos < 0 && isWhitespace(text[breakPos])) whitespacePos = breakPos;
            if (fallbackPos < 0) fallbackPos = breakPos;
          }
          breakPos--;
        }
        // No token boundary found — use the nearest kinsoku-valid position
        if (!foundTokenBoundary) {
          const chosen = preferredBreakPos(text, fallbackPos, whitespacePos);
          if (chosen >= 0) breakPos = chosen;
        }
      } else {
        while (breakPos > lineStart) {
          if (clusterSafePos < 0 && isClusterBreakAllowed(clusterIds, breakPos, text.length)) {
            clusterSafePos = breakPos;
          }
          if (canBreakAt(text, breakPos, clusterIds, mode, kinsokuRules)) {
            if (isWhitespace(text[breakPos])) {
              whitespacePos = breakPos;
              break;
            }
            if (fallbackPos < 0) fallbackPos = breakPos;
          }
          breakPos--;
        }
        const chosen = preferredBreakPos(text, fallbackPos, whitespacePos);
        if (chosen >= 0) breakPos = chosen;
      }

      // Force break if no valid candidate was found. A cluster boundary is
      // preferred over kinsoku here: splitting a cluster is only acceptable
      // when the cluster covers the whole line and therefore fits nowhere.
      // The backward search stops above `lineStart`, so that position is the
      // one cluster boundary it can never have recorded.
      if (
        breakPos < 0 ||
        (breakPos === lineStart && !canBreakAt(text, breakPos, clusterIds, mode, kinsokuRules))
      ) {
        if (
          clusterSafePos < lineStart &&
          isClusterBreakAllowed(clusterIds, lineStart, text.length)
        ) {
          clusterSafePos = lineStart;
        }
        breakPos = clusterSafePos >= lineStart ? clusterSafePos : i - 1;
      }

      breaks.push(breakPos);
      hangingAdj.push(0);
      usedLineWidths.push(lineWidth);
      lineIndex++;
      lineStart = breakPos + 1;

      // Recalculate accumulated width for the new line
      accWidth = 0;
      for (let j = lineStart; j <= i; j++) {
        accWidth += adv[j];
      }
    }
  }

  // Record width for the final line (after the last break)
  if (perLineWidths) {
    usedLineWidths.push(getLineWidth());
  }

  return {
    breakPoints: new Uint32Array(breaks),
    hangingAdjustments: enableHanging ? new Float32Array(hangingAdj) : undefined,
    effectiveAdvances,
    lineWidths: perLineWidths ? new Float32Array(usedLineWidths) : undefined,
  };
}

function isWhitespace(codepoint: number): boolean {
  return codepoint === 0x20 || codepoint === 0x09;
}

/**
 * Returns whether a break between this codepoint and its neighbour is allowed
 * without a separating space. True for CJK ideographs, kana and the CJK
 * punctuation/fullwidth blocks, where breaks are legal between any two
 * characters (subject to kinsoku).
 */
function breaksBetweenChars(codepoint: number): boolean {
  return (
    (codepoint >= 0x2e80 && codepoint <= 0x303f) ||
    (codepoint >= 0x3040 && codepoint <= 0x9fff) ||
    (codepoint >= 0xf900 && codepoint <= 0xfaff) ||
    (codepoint >= 0xfe30 && codepoint <= 0xfe4f) ||
    (codepoint >= 0xff00 && codepoint <= 0xff9f) ||
    (codepoint >= 0x20000 && codepoint <= 0x3ffff)
  );
}

/** Returns whether a break after `pos` would fall inside a word. */
function splitsWord(text: Uint32Array, pos: number): boolean {
  if (pos + 1 >= text.length) return false;
  return isWordChar(text[pos]) && isWordChar(text[pos + 1]);
}

/** Returns whether the codepoint belongs to a space-delimited word. */
function isWordChar(codepoint: number): boolean {
  return !(isWhitespace(codepoint) || breaksBetweenChars(codepoint));
}

/**
 * Picks the break position from a backward search that found no token boundary.
 *
 * The nearest valid position wins, because it fills the line best. An earlier
 * whitespace is preferred only when the nearest position would split a word,
 * which is what a space-delimited script needs and what CJK text never does.
 *
 * @returns The chosen position, or -1 when the search found no candidate.
 */
function preferredBreakPos(text: Uint32Array, fallbackPos: number, whitespacePos: number): number {
  if (whitespacePos >= 0 && (fallbackPos < 0 || splitsWord(text, fallbackPos))) {
    return whitespacePos;
  }
  return fallbackPos;
}

function validateLayoutInput(input: LayoutInput): void {
  const len = input.text.length;
  if (input.advances.length !== len) {
    throw new RangeError(
      `computeBreaks: advances length (${input.advances.length}) must match text length (${len})`,
    );
  }
  if (input.clusterIds && input.clusterIds.length !== len) {
    throw new RangeError(
      `computeBreaks: clusterIds length (${input.clusterIds.length}) must match text length (${len})`,
    );
  }
  if (!Number.isFinite(input.lineWidth) || input.lineWidth <= 0) {
    throw new RangeError('computeBreaks: lineWidth must be a positive finite number');
  }
  if (input.lineWidths) {
    for (let i = 0; i < input.lineWidths.length; i++) {
      if (!Number.isFinite(input.lineWidths[i]) || input.lineWidths[i] <= 0) {
        throw new RangeError(`computeBreaks: lineWidths[${i}] must be a positive finite number`);
      }
    }
  }
  for (let i = 0; i < input.advances.length; i++) {
    if (!Number.isFinite(input.advances[i]) || input.advances[i] < 0) {
      throw new RangeError(`computeBreaks: advances[${i}] must be a finite non-negative number`);
    }
  }
}

/**
 * Determines whether a line break is allowed after position `pos`.
 *
 * @param text - Unicode codepoint array.
 * @param pos - Position to check (break would occur after this index).
 * @param clusterIds - Optional cluster IDs for indivisible units.
 * @param mode - Kinsoku mode.
 * @param rules - Optional custom kinsoku rules.
 * @returns `true` if a break is allowed at this position.
 */
export function canBreakAt(
  text: Uint32Array,
  pos: number,
  clusterIds?: Uint32Array,
  mode: KinsokuMode = 'strict',
  rules?: KinsokuRules,
): boolean {
  // Cannot break within a cluster
  if (!isClusterBreakAllowed(clusterIds, pos, text.length)) {
    return false;
  }
  // Line-end prohibition: cannot break if current char is prohibited at line end
  if (isLineEndProhibited(text[pos], rules)) {
    return false;
  }
  // Line-start prohibition: cannot break if next char is prohibited at line start
  if (pos + 1 < text.length && isLineStartProhibited(text[pos + 1], mode, rules)) {
    return false;
  }
  // Pair prohibition: cannot split inseparable adjacent punctuation pairs
  if (pos + 1 < text.length && isUnbreakablePair(text[pos], text[pos + 1], rules)) {
    return false;
  }
  return true;
}
