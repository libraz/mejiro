import type { RubyAnnotation } from './ruby.js';
import type { TcyAnnotation } from './tcy.js';

/**
 * Input parameters for the line breaking algorithm.
 */
export interface LayoutInput {
  /** Text as an array of Unicode codepoints. */
  text: Uint32Array;
  /** Advance width of each character in pixels. */
  advances: Float32Array;
  /**
   * Available line width in pixels.
   * Used as the uniform width for all lines, unless `lineWidths` is provided.
   */
  lineWidth: number;
  /**
   * Per-line widths in pixels, overriding `lineWidth` for individual lines.
   * When provided, the i-th line uses `lineWidths[i]` as its width.
   * Lines beyond the array length fall back to `lineWidth`.
   */
  lineWidths?: Float32Array;
  /** Kinsoku (line break prohibition) mode. @defaultValue 'strict' */
  mode?: KinsokuMode;
  /** Whether to enable hanging punctuation. @defaultValue true */
  enableHanging?: boolean;
  /** Cluster IDs — characters sharing the same ID cannot be split across lines. */
  clusterIds?: Uint32Array;
  /** Ruby annotations for furigana support. */
  rubyAnnotations?: RubyAnnotation[];
  /**
   * Tate-chu-yoko spans. Each one is collapsed to a single indivisible box of
   * its own width before breaking, so a combined run is never split across a
   * column boundary and reserves one em instead of the sum of its characters.
   */
  tcyAnnotations?: readonly TcyAnnotation[];
  /**
   * Sorted array of codepoint indices representing token boundaries.
   * Each value is the index of the last codepoint in a token.
   * The algorithm prefers breaking at these positions over mid-token positions.
   * Use {@link tokenLengthsToBoundaries} to convert morphological analyzer output.
   */
  tokenBoundaries?: Uint32Array | readonly number[];
  /**
   * Per-position break penalties, one entry per code point. `breakPenalties[i]`
   * is the cost of breaking *after* index `i` — the same position convention as
   * {@link BreakResult.breakPoints}. `0` means unpenalised; larger values are
   * avoided more strongly.
   *
   * When present, the backward search picks the lowest-cost position within
   * {@link BreakCostOptions.maxBacktrackChars} instead of the nearest valid one,
   * and supersedes both `tokenBoundaries` and the whitespace preference. Use
   * {@link deriveTypographyHints} to produce it from a morphological analysis.
   */
  breakPenalties?: Uint8Array;
  /** Weights for the penalty search. Ignored unless `breakPenalties` is given. */
  breakCost?: BreakCostOptions;
  /** Custom kinsoku rules. When provided, overrides the default rules. */
  kinsokuRules?: KinsokuRules;
}

/**
 * Weights controlling how {@link LayoutInput.breakPenalties} trades a penalised
 * break position against the line it leaves behind.
 *
 * The cost of breaking after position `p` is
 * `penaltyWeight * breakPenalties[p] + shortfallWeight * shortfall(p)`, where
 * `shortfall(p)` is how far short of the line width the line ends, measured in
 * em. At the default weights a penalty of `P` is given up only while the
 * alternative leaves the line less than `P / 1.5` em short: 1.33 em for a break
 * inside a morpheme, 2 em for one that cuts a base off the particle following
 * it, and 2.67 em for one inside a word the rules keep whole.
 *
 * Only the ratio of the two weights decides anything. Scaling both by the same
 * factor scales every cost by that factor and leaves their order untouched, so
 * `{ penaltyWeight: 0.5, shortfallWeight: 1 }` and `{ penaltyWeight: 1,
 * shortfallWeight: 2 }` produce the same breaks. Move one weight and leave the
 * other at its default rather than tuning both.
 */
export interface BreakCostOptions {
  /**
   * Multiplier applied to the penalty value. Raise it to follow the analysis
   * more strictly; only its ratio to `shortfallWeight` has any effect.
   * @defaultValue 1
   */
  penaltyWeight?: number;
  /**
   * Multiplier applied to the em-measured shortfall.
   *
   * This weight fixes the worst trade the search can make. Escaping a position
   * carrying penalty `P` buys at most `P / shortfallWeight` em of empty line,
   * and {@link deriveTypographyHints} emits at most
   * {@link TypographyHintOptions.keepWholePenalty}, 4 by default.
   *
   * Vertical Japanese is set on a character grid where standard kinsoku shifts
   * one character and occasionally two. At `1` the heaviest penalty buys four
   * character cells, well past what the convention allows: measured over a 20k
   * character corpus, weight `1` against the structural penalties alone leaves
   * 30.2% of lines ending 1.5 em or more short, worst case 2.5 em. The default
   * cuts those lines to 12.1% while still moving 26.9% of the lines where a
   * penalty and the shortfall disagree. At `2` only 8.6% move and the penalties
   * barely reach the layout at all.
   *
   * @defaultValue 1.5
   */
  shortfallWeight?: number;
  /**
   * How many positions the cost search may walk back from the overflowing
   * character. Bounding it keeps line breaking linear in the text length.
   *
   * The default is set where a candidate stops being able to win, so widening
   * it only costs search time. A position `k` steps further back gives up at
   * least `0.5k` em of line, a half-width character being the narrowest thing
   * that can sit between the two, so it pays at least `shortfallWeight * 0.5k`
   * more in shortfall to save at most `penaltyWeight * P`, where `P` is the
   * largest penalty in the array. It can win only while
   * `k < 2 * penaltyWeight * P / shortfallWeight`.
   *
   * At the default weights and the penalties {@link deriveTypographyHints}
   * emits — `P` of 4 — that is `k < 5.33`, so six covers the search completely
   * and windows of 6, 8, 12, 16, 24 and 32 all choose the same positions. A
   * caller that both flattens the weights towards `1` and raises
   * {@link TypographyHintOptions.keepWholePenalty} pushes the bound past six and
   * should widen this to match, or the search will not reach the position its
   * own settings say should win.
   *
   * @defaultValue 6
   */
  maxBacktrackChars?: number;
  /**
   * Pixel size of one em, used to express the shortfall in em.
   * @defaultValue the largest measured advance in the paragraph, which is one
   *   em for any text containing a full-width character.
   */
  emSize?: number;
}

/**
 * A morpheme as the layout engine consumes it, independent of which analyzer
 * produced it. Offsets are code point indices into the same NFC text the layout
 * engine is given, so an analyzer working in its own normalized coordinate
 * system has to map them back before constructing this.
 */
export interface MorphemeLike {
  /** Surface form. Used to verify character classes, not to re-locate the span. */
  surface: string;
  /** Inclusive start index in code points. */
  start: number;
  /** Exclusive end index in code points. */
  end: number;
  /** Coarse part-of-speech code. */
  pos: string;
  /** Fine-grained part-of-speech code, the main input to the hint rules. */
  extendedPos: string;
}

/**
 * Name and version identifying one analyzer, for cache keys and snapshot
 * validation. Two identities that compare equal field by field stand for
 * analyzers whose findings are interchangeable.
 */
export interface AnalyzerIdentity {
  /** Stable name of the analyzer, the same across all of its versions. */
  name: string;
  /** Version of the analyzer, changed whenever its findings can change. */
  version: string;
}

/** One paragraph's morphological analysis, already aligned to `text`. */
export interface TextAnalysis {
  /** The exact NFC text the offsets address. */
  text: string;
  /** Morphemes in document order, non-overlapping. */
  morphemes: readonly MorphemeLike[];
  /** Which analyzer produced this, for cache keys and snapshot validation. */
  analyzer: AnalyzerIdentity;
  /** Diagnostics raised while analysing or aligning. Empty when clean. */
  warnings: readonly string[];
}

/**
 * Produces {@link TextAnalysis} for a paragraph of text.
 *
 * Implementations are synchronous by design: line breaking runs synchronously,
 * so any asynchronous setup (loading a WebAssembly analyzer, for instance)
 * belongs in the factory that returns the analyzer, not in `analyze`.
 */
export interface TextAnalyzer {
  /**
   * Who this analyzer is. It must equal the {@link TextAnalysis.analyzer} of
   * every analysis this analyzer returns: the field exists so that a caller
   * holding hints of unknown provenance — restoring a snapshot, say — can tell
   * whether they came from this analyzer without analysing anything.
   */
  readonly identity: AnalyzerIdentity;
  /** Analyses one paragraph of NFC text. */
  analyze(text: string): TextAnalysis;
  /** Releases any native resources held by the analyzer. */
  dispose(): void;
}

/** A run of characters a renderer may set as tate-chu-yoko. */
export interface TcyCandidate {
  /** Inclusive start index in code points. */
  startIndex: number;
  /** Exclusive end index in code points. */
  endIndex: number;
}

/**
 * Line breaking hints derived from a {@link TextAnalysis}.
 *
 * The fields are independent: a caller wanting only the indivisible units it
 * would be a typesetting error to split can take `clusterIds` and leave
 * `breakPenalties` off, which keeps break positions where the character-class
 * rules alone would put them except where a break would have split one of those
 * units. Withdrawing those break opportunities is the whole point of the
 * clusters, so the breaks that fell on them do move — on ordinary prose that is
 * a few per cent of all breaks.
 */
export interface TypographyHints {
  /** Indivisible units, to be merged into {@link LayoutInput.clusterIds}. */
  clusterIds?: Uint32Array;
  /** Per-position break penalties for {@link LayoutInput.breakPenalties}. */
  breakPenalties?: Uint8Array;
  /**
   * Morpheme end positions, for {@link LayoutInput.tokenBoundaries}.
   *
   * Emitted only on request: passing token boundaries alone makes the engine
   * break at word edges, which is not how Japanese body text is set.
   */
  tokenBoundaries?: Uint32Array;
  /** Automatic tate-chu-yoko candidates. Whether to set them is the caller's call. */
  tcyCandidates?: readonly TcyCandidate[];
}

/** Which hints {@link deriveTypographyHints} emits, and how far its rules reach. */
export interface TypographyHintOptions {
  /** Emit `clusterIds` for indivisible units. @defaultValue true */
  clusters?: boolean;
  /** Emit `breakPenalties`. @defaultValue false */
  penalties?: boolean;
  /** Emit `tokenBoundaries`. @defaultValue false */
  tokenBoundaries?: boolean;
  /** Emit `tcyCandidates`. @defaultValue false */
  tcy?: boolean;
  /**
   * Longest run of characters a single hard cluster may cover. A longer unit is
   * left breakable, because a cluster that cannot fit a line is split by the
   * forced-break rule, which disregards kinsoku.
   * @defaultValue 6
   */
  maxHardClusterChars?: number;
  /**
   * Parts of speech whose morphemes a break should avoid landing inside.
   *
   * A code matches a morpheme when it equals either its
   * {@link MorphemeLike.extendedPos} or its {@link MorphemeLike.pos}, so
   * `'VERB'` selects every verb while `'VERB_連用'` selects one conjugation.
   *
   * The default is the closed-class independent words — conjunctions, adverbs,
   * adnominals, pronouns and interjections. They are short, mostly written in
   * kana and read as a single unit, so a break inside one is conspicuous in a
   * way that a break inside a kanji compound is not: `国際|連合` still reads,
   * `した|がって` does not. Being closed classes, they are also the words an
   * analyzer's dictionary is most likely to know.
   *
   * Pass `[]` to switch the rule off, or spread
   * {@link DEFAULT_KEEP_WHOLE_POS} to extend the default rather than replace
   * it. Formal nouns (`NOUN_形式` in suzume's vocabulary) are the usual
   * addition.
   *
   * Unlike the cluster rules this one does consult the part of speech, so what
   * it does depends on the analyzer's dictionary. That is safe here in a way it
   * is not for clusters: a word the dictionary does not know keeps the ordinary
   * inside-a-morpheme penalty, which is what it would have had anyway, so the
   * worst outcome is no improvement rather than a different layout.
   *
   * @defaultValue {@link DEFAULT_KEEP_WHOLE_POS}
   */
  keepWholePos?: readonly string[];
  /**
   * Penalty given to a break inside a {@link TypographyHintOptions.keepWholePos}
   * morpheme, in place of the ordinary inside-a-morpheme penalty of 2.
   *
   * This is a preference, not a prohibition, and the value sets its price. The
   * cost search gives up at most `keepWholePenalty / shortfallWeight` em of line
   * to escape the morpheme, so the default buys 2.67 em at the default weights:
   * enough to step out of a break one or two characters into a word, not enough
   * to leave a hole where the only escape is back past the whole of it. Raising
   * it much further asks for that hole, and needs
   * {@link BreakCostOptions.maxBacktrackChars} widened to match before the
   * search can even reach the position that would win.
   *
   * There is deliberately no length cap of the kind
   * {@link TypographyHintOptions.maxHardClusterChars} puts on clusters. A long
   * morpheme needs no guard because an escape it cannot afford is simply not
   * taken.
   *
   * The value is read literally, so `0` does not switch the rule off — it makes
   * the inside of these words the *cheapest* place on the line to break, which
   * is the opposite of the intent. Switch the rule off with
   * `keepWholePos: []`.
   *
   * @defaultValue 4
   */
  keepWholePenalty?: number;
}

/**
 * Result of the line breaking computation.
 */
export interface BreakResult {
  /** Array of break point indices (index of the last character before each break). */
  breakPoints: Uint32Array;
  /** Hanging adjustment amount in pixels for each line. 0 if no hanging occurs. */
  hangingAdjustments?: Float32Array;
  /**
   * Per-character effective advances after tate-chu-yoko collapsing and ruby
   * width distribution. Present when either kind of annotation was provided.
   */
  effectiveAdvances?: Float32Array;
  /** Actual line width used for each line. Present when per-line `lineWidths` was provided. */
  lineWidths?: Float32Array;
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
  /** Adjacent codepoint pairs that must not be split across lines. */
  unbreakablePairs: Array<readonly [number, number]>;
  /** Pre-computed lookup set for lineStartProhibited. */
  lineStartProhibitedSet: Set<number>;
  /** Pre-computed lookup set for lineEndProhibited. */
  lineEndProhibitedSet: Set<number>;
  /** Pre-computed lookup set for unbreakablePairs. */
  unbreakablePairSet: Set<string>;
}
