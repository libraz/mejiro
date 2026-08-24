import { toCodepoints } from './text.js';
import type {
  MorphemeLike,
  TcyCandidate,
  TextAnalysis,
  TypographyHintOptions,
  TypographyHints,
} from './types.js';

/** Longest run of characters a single hard cluster may cover by default. */
const DEFAULT_MAX_HARD_CLUSTER_CHARS = 6;

/** ASCII and full-width digits — the class a numeral is recognised by. */
const DIGIT_RUN = /^[0-9０-９]+$/u;

/** ASCII letters — the class a Latin word inside Japanese text is recognised by. */
const LATIN_WORD = /^[A-Za-z]+$/u;

/** Extended POS code of a prefix, which binds rightwards onto a content word. */
const POS_PREFIX = 'PREFIX';
/** Extended POS code of a suffix, which binds leftwards onto its base. */
const POS_SUFFIX = 'SUFFIX';
/** Extended POS code of a symbol, which is a word of its own. */
const POS_SYMBOL = 'SYMBOL';

/** Extended POS prefixes of the two function-word families that follow a base. */
const PARTICLE_PREFIX = 'PART_';
const AUXILIARY_PREFIX = 'AUX_';

/** Break after the last morpheme of a bunsetsu — the position to prefer. */
const PENALTY_BUNSETSU = 0;
/** Break at a morpheme boundary that does not close a bunsetsu. */
const PENALTY_MORPHEME = 1;
/** Break inside a morpheme, which is where the character-class rules would cut. */
const PENALTY_INSIDE_MORPHEME = 2;
/** Break that cuts a base off the particle or auxiliary that follows it. */
const PENALTY_BEFORE_FUNCTION_WORD = 3;

/** Space and tab, the two characters the engine treats as a break opportunity. */
const SPACE = 0x20;
const TAB = 0x09;

/** A half-open code point range, used while collecting and merging clusters. */
interface Span {
  /** Inclusive start index in code points. */
  start: number;
  /** Exclusive end index in code points. */
  end: number;
}

/**
 * Derives line breaking hints from a morphological analysis of one paragraph.
 *
 * The rules are deliberately few. A unit is made indivisible only when splitting
 * it is a clear typesetting error *and* the decision does not depend on whether
 * the analyzer's dictionary happened to know the word — so the character class
 * of a morpheme's surface, not its part of speech, is what ultimately decides.
 * A morpheme the analyzer could not tag qualifies on exactly the same terms as a
 * confidently tagged one, which keeps the output stable across analyzers and
 * across dictionary versions.
 *
 * `clusterIds` is emitted by default; everything else is opt-in. `breakPenalties`
 * changes which position the engine picks and so changes existing layouts, and
 * `tokenBoundaries` on its own makes the engine break at word edges, which is
 * not how Japanese body text is set — it is useful next to penalties, not
 * instead of them.
 *
 * @param text - The paragraph, NFC-normalized, as handed to the layout engine.
 * @param analysis - Morphemes aligned to `text` in code point offsets.
 * @param options - Which hints to emit and how far the cluster rules reach.
 * @returns The requested hints. Fields whose rules never fired are omitted, so a
 *   caller keeps its "no hints, no preprocessing" fast path. An analysis whose
 *   `text` differs from `text` yields no hints at all rather than an error: its
 *   offsets address a different string, and breaking on character classes alone
 *   is a correct, if less informed, fallback.
 */
export function deriveTypographyHints(
  text: string,
  analysis: TextAnalysis,
  options: TypographyHintOptions = {},
): TypographyHints {
  if (analysis.text !== text) return {};

  const codepoints = toCodepoints(text);
  const morphemes = analysis.morphemes;
  const hints: TypographyHints = {};

  if (options.clusters !== false) {
    const maxChars = options.maxHardClusterChars ?? DEFAULT_MAX_HARD_CLUSTER_CHARS;
    const clusterIds = buildClusterIds(morphemes, codepoints.length, maxChars);
    if (clusterIds) hints.clusterIds = clusterIds;
  }

  if (options.penalties === true) {
    hints.breakPenalties = buildBreakPenalties(morphemes, codepoints);
  }

  if (options.tokenBoundaries === true) {
    hints.tokenBoundaries = buildTokenBoundaries(morphemes);
  }

  if (options.tcy === true) {
    const tcyCandidates = collectTcyCandidates(morphemes);
    if (tcyCandidates.length > 0) hints.tcyCandidates = tcyCandidates;
  }

  return hints;
}

/**
 * Combines two cluster ID arrays over the same text into their transitive closure.
 *
 * Positions joined in either input are joined in the output, and a chain joined
 * across the two — `a` binding 0 to 1 and `b` binding 1 to 2 — comes out as one
 * cluster. This is what lets typography hints ride alongside ruby or
 * tate-chu-yoko clustering without either side having to know about the other.
 *
 * @param length - Text length in code points, and the length of the result.
 * @param a - First cluster ID array, or `undefined`.
 * @param b - Second cluster ID array, or `undefined`.
 * @returns A fresh array — never one of the inputs — or `undefined` when neither
 *   input is usable. An input whose length does not match `length` describes
 *   different text and is ignored rather than rejected, because dropping a hint
 *   costs a suboptimal break while throwing costs the whole paragraph.
 */
export function mergeClusterIds(
  length: number,
  a?: Uint32Array,
  b?: Uint32Array,
): Uint32Array | undefined {
  const first = usableIds(a, length);
  const second = usableIds(b, length);
  if (!first) return second ? new Uint32Array(second) : undefined;
  if (!second) return new Uint32Array(first);

  const parent = new Uint32Array(length);
  for (let i = 0; i < length; i++) parent[i] = i;
  joinSharedIds(parent, first);
  joinSharedIds(parent, second);

  const merged = new Uint32Array(length);
  for (let i = 0; i < length; i++) merged[i] = findRoot(parent, i);
  return merged;
}

/** Returns the array only when it describes text of exactly `length` code points. */
function usableIds(ids: Uint32Array | undefined, length: number): Uint32Array | undefined {
  return ids !== undefined && ids.length === length ? ids : undefined;
}

/** Unions every position sharing a cluster ID with the first position holding it. */
function joinSharedIds(parent: Uint32Array, ids: Uint32Array): void {
  const firstOfId = new Map<number, number>();
  for (let i = 0; i < ids.length; i++) {
    const seen = firstOfId.get(ids[i]);
    if (seen === undefined) firstOfId.set(ids[i], i);
    else union(parent, seen, i);
  }
}

/** Finds the representative of `index`, compressing the path it walked. */
function findRoot(parent: Uint32Array, index: number): number {
  let root = index;
  while (parent[root] !== root) root = parent[root];
  let node = index;
  while (parent[node] !== root) {
    const next = parent[node];
    parent[node] = root;
    node = next;
  }
  return root;
}

/**
 * Merges two positions, keeping the smaller index as the representative.
 *
 * The smaller index wins so a singleton keeps its own index as its ID, which is
 * the identity seeding the rest of the engine assumes.
 */
function union(parent: Uint32Array, x: number, y: number): void {
  const rootX = findRoot(parent, x);
  const rootY = findRoot(parent, y);
  if (rootX === rootY) return;
  if (rootX < rootY) parent[rootY] = rootX;
  else parent[rootX] = rootY;
}

/**
 * Builds cluster IDs for the indivisible units the hint rules recognise.
 *
 * @returns `undefined` when no rule fired, so the caller can skip clustering
 *   entirely instead of carrying an identity array through the layout path.
 */
function buildClusterIds(
  morphemes: readonly MorphemeLike[],
  textLength: number,
  maxChars: number,
): Uint32Array | undefined {
  const spans = mergeSpans(collectClusterSpans(morphemes, textLength), maxChars);
  if (spans.length === 0) return undefined;

  const clusterIds = new Uint32Array(textLength);
  for (let i = 0; i < textLength; i++) clusterIds[i] = i;
  for (const span of spans) {
    for (let i = span.start; i < span.end; i++) clusterIds[i] = span.start;
  }
  return clusterIds;
}

/**
 * Collects the spans the four cluster rules propose, in no particular order.
 *
 * The rules are: a numeral and the counter that follows it (`3人`), a prefix and
 * the word it binds to (`お名前`), the interior of a numeral (`１２３`, which the
 * full-width block otherwise leaves freely breakable), and the interior of a
 * Latin word inside Japanese text.
 */
function collectClusterSpans(morphemes: readonly MorphemeLike[], textLength: number): Span[] {
  const spans: Span[] = [];

  for (let k = 0; k < morphemes.length; k++) {
    const morpheme = morphemes[k];
    if (!coversSpan(morpheme, textLength)) continue;

    const next = morphemes[k + 1];
    const bindsRight =
      next !== undefined && next.start === morpheme.end && coversSpan(next, textLength);

    if (bindsRight && isNumeral(morpheme) && next.extendedPos === POS_SUFFIX) {
      spans.push({ start: morpheme.start, end: next.end });
    }

    if (bindsRight && morpheme.extendedPos === POS_PREFIX && attachesToPrefix(next.extendedPos)) {
      spans.push({ start: morpheme.start, end: next.end });
    }

    if (morpheme.end - morpheme.start >= 2 && (isNumeral(morpheme) || isLatinWord(morpheme))) {
      spans.push({ start: morpheme.start, end: morpheme.end });
    }
  }

  return spans;
}

/**
 * Merges overlapping spans and drops the ones that grew too wide.
 *
 * Overlapping rules describe one unit — `第` + `1` and `1` + `章` are both about
 * `第1章` — so they become a single cluster. Spans that merely touch stay apart:
 * `3人5歳` is two units, not one.
 *
 * A cluster wider than `maxChars` is dropped rather than shortened. A cluster
 * that cannot fit a line is split by the forced-break rule, which disregards
 * kinsoku, so keeping an over-long one trades a small win for a worse failure.
 */
function mergeSpans(spans: Span[], maxChars: number): Span[] {
  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start < last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    merged.push({ start: span.start, end: span.end });
  }

  return merged.filter((span) => span.end - span.start <= maxChars);
}

/**
 * Builds one break penalty per code point, `breakPenalties[i]` being the cost of
 * breaking after index `i`.
 *
 * Rule values are collected separately from the default so that "the larger
 * value wins" applies between rules only: a position no rule covers is inside a
 * morpheme, which is neither the best nor the worst place to cut.
 */
function buildBreakPenalties(
  morphemes: readonly MorphemeLike[],
  codepoints: Uint32Array,
): Uint8Array {
  const length = codepoints.length;
  const applied = new Int8Array(length).fill(-1);
  const raise = (index: number, value: number): void => {
    if (index >= 0 && index < length && value > applied[index]) applied[index] = value;
  };

  for (let i = 0; i < length; i++) {
    if (codepoints[i] === SPACE || codepoints[i] === TAB) raise(i, PENALTY_BUNSETSU);
  }

  // A bunsetsu is one content word plus the function words trailing it, so the
  // run closes at the last morpheme before a non-function word. A run that never
  // saw a content word is not a bunsetsu and only rates as a morpheme boundary.
  let runHasContent = false;
  for (let k = 0; k < morphemes.length; k++) {
    const morpheme = morphemes[k];
    const isFunction = isFunctionWord(morpheme.extendedPos);
    if (!isFunction) runHasContent = true;

    const next = morphemes[k + 1];
    const closesRun = next === undefined || !isFunctionWord(next.extendedPos);
    raise(morpheme.end - 1, closesRun && runHasContent ? PENALTY_BUNSETSU : PENALTY_MORPHEME);
    if (isFunction) raise(morpheme.start - 1, PENALTY_BEFORE_FUNCTION_WORD);
    if (closesRun) runHasContent = false;
  }

  const penalties = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    penalties[i] = applied[i] < 0 ? PENALTY_INSIDE_MORPHEME : applied[i];
  }
  return penalties;
}

/** Collects each morpheme's last code point index, dropping the final one. */
function buildTokenBoundaries(morphemes: readonly MorphemeLike[]): Uint32Array {
  if (morphemes.length <= 1) return new Uint32Array(0);
  const boundaries = new Uint32Array(morphemes.length - 1);
  for (let k = 0; k < morphemes.length - 1; k++) boundaries[k] = morphemes[k].end - 1;
  return boundaries;
}

/**
 * Collects free-standing two-digit numbers, the safe case for tate-chu-yoko.
 *
 * A numeral bound to a counter is read as one word with it, and whether that
 * whole unit is better combined or set in vertical digits is a house-style call,
 * so those are left to the caller.
 */
function collectTcyCandidates(morphemes: readonly MorphemeLike[]): TcyCandidate[] {
  const candidates: TcyCandidate[] = [];
  for (let k = 0; k < morphemes.length; k++) {
    const morpheme = morphemes[k];
    if (morpheme.end - morpheme.start !== 2 || !isNumeral(morpheme)) continue;
    if (morphemes[k + 1]?.extendedPos === POS_SUFFIX) continue;
    candidates.push({ startIndex: morpheme.start, endIndex: morpheme.end });
  }
  return candidates;
}

/**
 * True when the morpheme is a run of digits.
 *
 * The part of speech is not consulted. `NOUN_数` is what an analyzer normally
 * calls this, but a digit run it failed to look up is just as indivisible, and
 * a `NOUN_数` spelled `三` is not a digit run at all.
 */
function isNumeral(morpheme: MorphemeLike): boolean {
  return matchesSurface(morpheme, DIGIT_RUN);
}

/** True when the morpheme is a run of ASCII letters. */
function isLatinWord(morpheme: MorphemeLike): boolean {
  return matchesSurface(morpheme, LATIN_WORD);
}

/**
 * Tests a morpheme's surface against a character class.
 *
 * The surface has to account for the whole span it claims: an analysis where the
 * two disagree is misaligned, and clustering a span its surface never described
 * would put the constraint somewhere else entirely.
 */
function matchesSurface(morpheme: MorphemeLike, pattern: RegExp): boolean {
  return (
    pattern.test(morpheme.surface) &&
    codepointLength(morpheme.surface) === morpheme.end - morpheme.start
  );
}

/** Length of a string in code points, which is the unit every offset here uses. */
function codepointLength(value: string): number {
  return [...value].length;
}

/** True when the morpheme's offsets address a real span of text of `textLength`. */
function coversSpan(morpheme: MorphemeLike, textLength: number): boolean {
  return (
    Number.isInteger(morpheme.start) &&
    Number.isInteger(morpheme.end) &&
    morpheme.start >= 0 &&
    morpheme.end <= textLength &&
    morpheme.end > morpheme.start
  );
}

/** True for a particle or an auxiliary verb — the words that trail a base. */
function isParticleOrAuxiliary(extendedPos: string): boolean {
  return extendedPos.startsWith(PARTICLE_PREFIX) || extendedPos.startsWith(AUXILIARY_PREFIX);
}

/** True for the function words a bunsetsu ends with: particles, auxiliaries, suffixes. */
function isFunctionWord(extendedPos: string): boolean {
  return isParticleOrAuxiliary(extendedPos) || extendedPos === POS_SUFFIX;
}

/**
 * True when a morpheme can serve as the base a prefix binds to.
 *
 * Narrower than "not a function word": a prefix needs a content word to attach
 * to, and neither a second prefix nor a symbol is one.
 */
function attachesToPrefix(extendedPos: string): boolean {
  return (
    !isParticleOrAuxiliary(extendedPos) && extendedPos !== POS_PREFIX && extendedPos !== POS_SYMBOL
  );
}
