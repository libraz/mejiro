import type { RubyAnnotation } from './ruby.js';

/**
 * Input parameters for the line breaking algorithm.
 */
export interface LayoutInput {
  /** Text as an array of Unicode codepoints. */
  text: Uint32Array;
  /** Advance width of each character in pixels. */
  advances: Float32Array;
  /** Available line width in pixels. */
  lineWidth: number;
  /** Kinsoku (line break prohibition) mode. @defaultValue 'strict' */
  mode?: KinsokuMode;
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /** Cluster IDs — characters sharing the same ID cannot be split across lines. */
  clusterIds?: Uint32Array;
  /** Ruby annotations for furigana support. */
  rubyAnnotations?: RubyAnnotation[];
  /**
   * Sorted array of codepoint indices representing token boundaries.
   * Each value is the index of the last codepoint in a token.
   * The algorithm prefers breaking at these positions over mid-token positions.
   * Use {@link tokenLengthsToBoundaries} to convert morphological analyzer output.
   */
  tokenBoundaries?: Uint32Array | readonly number[];
  /** Custom kinsoku rules. When provided, overrides the default rules. */
  kinsokuRules?: KinsokuRules;
}

/**
 * Result of the line breaking computation.
 */
export interface BreakResult {
  /** Array of break point indices (index of the last character before each break). */
  breakPoints: Uint32Array;
  /** Hanging adjustment amount in pixels for each line. 0 if no hanging occurs. */
  hangingAdjustments?: Float32Array;
  /** Per-character effective advances after ruby width distribution. Present when ruby was provided. */
  effectiveAdvances?: Float32Array;
}

/**
 * Kinsoku processing mode.
 * - `'strict'`: Full prohibition including small kana and long vowel mark.
 * - `'loose'`: Allows small kana and long vowel mark at line start.
 */
export type KinsokuMode = 'strict' | 'loose';

/**
 * Custom kinsoku (line break prohibition) rules.
 *
 * Use {@link buildKinsokuRules} to create an instance from raw codepoint arrays.
 */
export interface KinsokuRules {
  /** Codepoints prohibited at the start of a line. */
  lineStartProhibited: number[];
  /** Codepoints prohibited at the end of a line. */
  lineEndProhibited: number[];
  /** Pre-computed lookup set for lineStartProhibited. */
  lineStartProhibitedSet: Set<number>;
  /** Pre-computed lookup set for lineEndProhibited. */
  lineEndProhibitedSet: Set<number>;
}
