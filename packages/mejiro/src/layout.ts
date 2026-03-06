import { isClusterBreakAllowed } from './cluster.js';
import { isHangingTarget } from './hanging.js';
import { isLineEndProhibited, isLineStartProhibited } from './kinsoku.js';
import { preprocessRuby } from './ruby.js';
import type { BreakResult, KinsokuMode, LayoutInput } from './types.js';

/**
 * Computes line break positions for the given layout input.
 *
 * Uses a greedy O(n) algorithm with backtracking for kinsoku rules
 * and optional hanging punctuation support.
 *
 * @param input - Layout parameters including text, advances, and line width.
 * @returns Break points and optional hanging adjustments.
 */
export function computeBreaks(input: LayoutInput): BreakResult {
  const { text, lineWidth, enableHanging = true, mode = 'strict' } = input;
  let { clusterIds } = input;
  const len = text.length;

  if (len === 0) {
    return { breakPoints: new Uint32Array(0) };
  }

  // Ruby pre-processing
  let effectiveAdvances: Float32Array | undefined;
  if (input.rubyAnnotations?.length) {
    const ruby = preprocessRuby(text, input.advances, input.rubyAnnotations, clusterIds);
    effectiveAdvances = ruby.effectiveAdvances;
    clusterIds = ruby.clusterIds;
  }

  const adv = effectiveAdvances ?? input.advances;

  const breaks: number[] = [];
  const hangingAdj: number[] = [];

  let lineStart = 0;
  let accWidth = 0;

  for (let i = 0; i < len; i++) {
    accWidth += adv[i];

    if (accWidth > lineWidth && i > lineStart) {
      // Allow hanging punctuation to protrude beyond line width
      if (enableHanging && isHangingTarget(text[i]) && accWidth - adv[i] <= lineWidth) {
        // Skip break at the very last character — no content follows it
        if (i < len - 1) {
          breaks.push(i);
          hangingAdj.push(accWidth - lineWidth);
        }
        lineStart = i + 1;
        accWidth = 0;
        continue;
      }

      // Search backwards for a valid break position
      let breakPos = i - 1;
      while (breakPos > lineStart) {
        if (canBreakAt(text, breakPos, clusterIds, mode)) {
          break;
        }
        breakPos--;
      }

      // Force break if no valid candidate was found
      if (breakPos === lineStart && !canBreakAt(text, breakPos, clusterIds, mode)) {
        breakPos = i - 1;
      }

      breaks.push(breakPos);
      hangingAdj.push(0);
      lineStart = breakPos + 1;

      // Recalculate accumulated width for the new line
      accWidth = 0;
      for (let j = lineStart; j <= i; j++) {
        accWidth += adv[j];
      }
    }
  }

  return {
    breakPoints: new Uint32Array(breaks),
    hangingAdjustments: enableHanging ? new Float32Array(hangingAdj) : undefined,
    effectiveAdvances,
  };
}

/**
 * Determines whether a line break is allowed after position `pos`.
 *
 * @param text - Unicode codepoint array.
 * @param pos - Position to check (break would occur after this index).
 * @param clusterIds - Optional cluster IDs for indivisible units.
 * @param mode - Kinsoku mode.
 * @returns `true` if a break is allowed at this position.
 */
export function canBreakAt(
  text: Uint32Array,
  pos: number,
  clusterIds?: Uint32Array,
  mode: KinsokuMode = 'strict',
): boolean {
  // Cannot break within a cluster
  if (!isClusterBreakAllowed(clusterIds, pos, text.length)) {
    return false;
  }
  // Line-end prohibition: cannot break if current char is prohibited at line end
  if (isLineEndProhibited(text[pos])) {
    return false;
  }
  // Line-start prohibition: cannot break if next char is prohibited at line start
  if (pos + 1 < text.length && isLineStartProhibited(text[pos + 1], mode)) {
    return false;
  }
  return true;
}
