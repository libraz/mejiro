import type { MorphemeLike } from '../types.js';

/**
 * Format controls a morphological analyzer's normalizer drops outright.
 *
 * They carry no width and no meaning for line breaking, so an analyzer removes
 * them before tokenizing and its offsets no longer count them. Everything listed
 * here is default-ignorable, as are the bidi controls and variation selectors
 * that {@link isTransparentFormatControl} adds by range.
 */
const TRANSPARENT_FORMAT_CONTROLS = new Set([
  0x00ad, // SOFT HYPHEN
  0x180e, // MONGOLIAN VOWEL SEPARATOR
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x200e, // LEFT-TO-RIGHT MARK
  0x200f, // RIGHT-TO-LEFT MARK
  0x2060, // WORD JOINER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE
]);

/** KATAKANA-HIRAGANA PROLONGED SOUND MARK. */
const PROLONGED_SOUND_MARK = 0x30fc;

/**
 * Voiced and semi-voiced sound marks that compose onto the preceding kana.
 *
 * Both the combining forms and the half-width forms are here: a normalizer folds
 * half-width katakana to full width, which turns a kana plus a half-width mark
 * into a single composed character just as the combining forms do.
 */
const SOUND_MARKS = new Set([
  0x3099, // COMBINING KATAKANA-HIRAGANA VOICED SOUND MARK
  0x309a, // COMBINING KATAKANA-HIRAGANA SEMI-VOICED SOUND MARK
  0x309b, // KATAKANA-HIRAGANA VOICED SOUND MARK
  0x309c, // KATAKANA-HIRAGANA SEMI-VOICED SOUND MARK
  0xff9e, // HALFWIDTH KATAKANA VOICED SOUND MARK
  0xff9f, // HALFWIDTH KATAKANA SEMI-VOICED SOUND MARK
]);

/**
 * Maps morpheme offsets from an analyzer's normalized text back onto `text`.
 *
 * A morphological analyzer indexes its output against the text its own
 * normalizer produced, which is not the text the layout engine is given. That
 * normalizer can only ever *shorten* the input — it never inserts — and it does
 * so in three ways: it removes transparent format controls, it composes a kana
 * with a following sound mark into one character, and it collapses a run of
 * repeated prolonged sound marks sitting immediately before a kanji down to one.
 * Everything else it does is a same-length substitution (width folding, kana
 * folding), which leaves offsets where they are.
 *
 * Alignment is therefore either free or a single monotone walk, and it either
 * succeeds completely or not at all: a partial mapping would silently move hints
 * onto the wrong characters, which is worse than having no hints, so a walk that
 * cannot consume both strings reports failure instead. Each mapped span is then
 * made to prove itself against its own surface, because the walk's totals alone
 * do not pin down *which* characters it decided were deleted.
 *
 * @param text - The original text the layout engine will break.
 * @param normalizedText - The text the analyzer's offsets address.
 * @param morphemes - Morphemes indexed against `normalizedText`.
 * @returns The morphemes indexed against `text`, together with any diagnostics,
 *   or `null` when the two strings cannot be reconciled. Morphemes whose mapped
 *   span falls outside `text` or fails to describe its own surface are dropped
 *   and reported in `warnings`.
 */
export function alignMorphemeOffsets(
  text: string,
  normalizedText: string,
  morphemes: readonly MorphemeLike[],
): { morphemes: MorphemeLike[]; warnings: string[] } | null {
  const textLength = codePointLength(text);

  // Equal lengths mean the mapping is the identity, and that is a proof rather
  // than an approximation: the normalizer only ever deletes, so a normalized
  // text as long as its input had nothing deleted from it and every offset
  // still addresses the character it did before. Real prose takes this path.
  if (codePointLength(normalizedText) === textLength) {
    return collect([...morphemes], textLength, 0);
  }

  const source = [...text];
  const target = [...normalizedText];
  // Longer output cannot come out of a normalizer that never inserts, so the
  // two strings are not a normalization pair and there is nothing to walk.
  if (target.length > source.length) return null;

  // Where in `source` each normalized character begins and ends. Characters the
  // normalizer removed are attributed to the step that follows them, so they
  // fall outside both ends of a morpheme rather than extending one.
  const spanStart = new Array<number>(target.length);
  const spanEnd = new Array<number>(target.length);
  // Which characters the walk decided the normalizer had removed. The decision
  // is a guess, so it is recorded rather than trusted: the verification below
  // reads it back to rebuild what each span says and compare that to the surface.
  const removed = new Uint8Array(source.length);

  let read = 0;
  for (let write = 0; write < target.length; write++) {
    while (read < source.length && source[read] !== target[write] && isAbsorbed(source, read)) {
      removed[read] = 1;
      read++;
    }
    if (read >= source.length) return null;
    spanStart[write] = read;
    if (source[read] === target[write]) {
      read += 1;
    } else if (composesWithSoundMark(source, read, target[write])) {
      read += 2;
    } else {
      // A same-length substitution. Width and kana folding change the character
      // without changing the length, so differing characters at corresponding
      // positions are ordinary and must not fail the walk. Accepting them
      // unconditionally is also why {@link describesSurface} has to check the
      // spans afterwards: nothing here can tell a fold from a misstep.
      read += 1;
    }
    spanEnd[write] = read;
  }
  while (read < source.length && isAbsorbed(source, read)) {
    removed[read] = 1;
    read++;
  }
  if (read !== source.length) return null;

  const aligned: MorphemeLike[] = [];
  let dropped = 0;
  for (const morpheme of morphemes) {
    if (!isSpan(morpheme.start, morpheme.end, target.length)) {
      dropped++;
      continue;
    }
    const start = morpheme.start < target.length ? spanStart[morpheme.start] : source.length;
    const end = morpheme.end > 0 ? spanEnd[morpheme.end - 1] : 0;
    if (!describesSurface(source, removed, start, end, morpheme.surface)) {
      dropped++;
      continue;
    }
    aligned.push({ ...morpheme, start, end });
  }
  return collect(aligned, textLength, dropped);
}

/**
 * Keeps the morphemes whose span addresses `textLength` code points, counting
 * the rest into a single diagnostic.
 *
 * A span that stays within bounds covers exactly `end - start` code points of
 * the text, so the bounds check is the whole verification: no morpheme leaves
 * here whose offsets a caller could slice out of range.
 */
function collect(
  morphemes: MorphemeLike[],
  textLength: number,
  dropped: number,
): { morphemes: MorphemeLike[]; warnings: string[] } {
  const kept: MorphemeLike[] = [];
  let outside = dropped;
  for (const morpheme of morphemes) {
    if (isSpan(morpheme.start, morpheme.end, textLength)) kept.push(morpheme);
    else outside++;
  }
  const warnings =
    outside > 0 ? [`dropped ${outside} morpheme(s) whose offsets fall outside the text`] : [];
  return { morphemes: kept, warnings };
}

/**
 * Whether the span `[start, end)` of `source` really holds the characters
 * `surface` names, ignoring the ones the walk decided were removed.
 *
 * The walk needs this because it cannot fail on content: a mismatched pair that
 * is neither removable nor a composition is accepted as a substitution, so the
 * only thing that can stop the walk is running out of characters. Its totals —
 * removals plus compositions must equal the length difference — say how many
 * characters disappeared, never which ones. A removal the predicate does not
 * recognise is therefore taken for a substitution and paid for by removing a
 * character further on that the normalizer had in fact kept; the walk still
 * finishes, and every span between the two errors sits one character off. Making
 * each span restate its own surface is what turns that into a dropped morpheme
 * instead of a hint placed on the wrong characters.
 *
 * Both sides are compared through NFKC so that a width fold or a sound-mark
 * composition reads as the match it is, and so that a compatibility character
 * the analyzer passes through unchanged compares equal to itself.
 *
 * Only the walk needs this. The identity path is proven, and paragraph text
 * takes it, so the cost stays off the common path.
 */
function describesSurface(
  source: readonly string[],
  removed: Uint8Array,
  start: number,
  end: number,
  surface: string,
): boolean {
  let kept = '';
  for (let index = start; index < end; index++) {
    if (removed[index] === 0) kept += source[index];
  }
  return kept.normalize('NFKC') === surface.normalize('NFKC');
}

/** Whether `[start, end)` is an integer span inside `[0, limit]`. */
function isSpan(start: number, end: number, limit: number): boolean {
  if (!(Number.isInteger(start) && Number.isInteger(end))) return false;
  return start >= 0 && start <= end && end <= limit;
}

/**
 * Whether the character at `index` is one the normalizer removes.
 *
 * A prolonged sound mark counts only when it sits in a repeated run, because a
 * collapsed run keeps one of its marks and the surplus ones are exactly those
 * with a prolonged sound mark next to them.
 */
function isAbsorbed(source: readonly string[], index: number): boolean {
  const cp = source[index].codePointAt(0) ?? 0;
  if (isTransparentFormatControl(cp)) return true;
  if (cp !== PROLONGED_SOUND_MARK) return false;
  return isProlongedSoundMark(source[index - 1]) || isProlongedSoundMark(source[index + 1]);
}

/** Whether `cp` is a format control the normalizer is free to remove. */
function isTransparentFormatControl(cp: number): boolean {
  if (TRANSPARENT_FORMAT_CONTROLS.has(cp)) return true;
  if (cp >= 0x2061 && cp <= 0x2064) return true; // invisible mathematical operators
  if (cp >= 0x202a && cp <= 0x202e) return true; // bidi embedding and override
  if (cp >= 0x2066 && cp <= 0x2069) return true; // bidi isolates
  return cp >= 0xfe00 && cp <= 0xfe0f; // variation selectors
}

/** Whether `char` is a prolonged sound mark, tolerating an out-of-range read. */
function isProlongedSoundMark(char: string | undefined): boolean {
  return char !== undefined && char.codePointAt(0) === PROLONGED_SOUND_MARK;
}

/**
 * Whether the character at `index` and the sound mark after it compose into
 * `composed`.
 *
 * The comparison runs through NFKC, which is what makes the half-width case work
 * as well as the combining one: folding both sides to their compatibility
 * composition collapses the width difference before the characters are compared,
 * so a wrong guess here cannot consume a character that stands on its own.
 */
function composesWithSoundMark(
  source: readonly string[],
  index: number,
  composed: string,
): boolean {
  const mark = source[index + 1];
  if (mark === undefined) return false;
  if (!SOUND_MARKS.has(mark.codePointAt(0) ?? 0)) return false;
  return (source[index] + mark).normalize('NFKC') === composed.normalize('NFKC');
}

/** Counts the code points in `str` without materialising them. */
function codePointLength(str: string): number {
  let count = 0;
  for (const _ of str) count++;
  return count;
}
