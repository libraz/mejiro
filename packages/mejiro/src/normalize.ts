import type { InlineAnnotation, InlineRubyAnnotation } from './browser/types.js';
import { normalizeText } from './text.js';

/** Upper bound on the characters normalized as one canonical composition group. */
const MAX_COMPOSED_GROUP = 32;

/**
 * Character index mapping produced by a paragraph-level text transform.
 *
 * `start` and `end` only differ where several source characters collapse into
 * one: a span starting inside such a group starts at the group, and a span
 * ending inside it covers the whole group.
 */
export interface IndexMapping {
  /** Highest addressable source index (the source character count). */
  readonly last: number;
  /** Maps a span start index into the transformed text. */
  start(index: number): number;
  /** Maps a span end index into the transformed text. */
  end(index: number): number;
}

/** Text paired with the inline annotations that address it. */
export interface AnnotatedText {
  /** Base text. */
  text: string;
  /** Annotations indexed by code point offset into {@link AnnotatedText.text}. */
  inlineAnnotations: readonly InlineAnnotation[];
}

/**
 * Converts text to NFC and moves every annotation with it.
 *
 * Mejiro's public offsets are NFC code point offsets, so decomposed source such
 * as `が` has to collapse before the indices are consumed; otherwise the
 * layout engine (which normalizes on its own) would address other characters.
 * This is the single entry point every text-plus-annotation boundary uses —
 * EPUB extraction, the browser integration and the high-level book API — so
 * normalizing text and remapping its annotations cannot come apart.
 *
 * Already-NFC input is returned as-is, sharing the annotation array.
 *
 * @param text - Base text in any normalization form.
 * @param annotations - Annotations indexed against `text` as given.
 * @returns NFC text and the annotations moved onto it. Annotations whose
 *   characters all collapse away are dropped.
 */
export function normalizeAnnotatedText(
  text: string,
  annotations: readonly InlineAnnotation[],
): AnnotatedText {
  const normalized = normalizeText(text);
  if (normalized === text) return { text, inlineAnnotations: annotations };
  if (annotations.length === 0) return { text: normalized, inlineAnnotations: annotations };

  const chars = [...text];
  const starts = new Array<number>(chars.length + 1);
  const ends = new Array<number>(chars.length + 1);
  // Composed group by group, so the emitted text and the indices cannot drift.
  let composed = '';
  let out = 0;

  for (let i = 0; i < chars.length; ) {
    const length = composedGroupLength(chars, i);
    const group = normalizeText(chars.slice(i, i + length).join(''));
    const size = charCount(group);
    for (let k = 0; k < length; k++) {
      starts[i + k] = out;
      ends[i + k] = k === 0 ? out : out + size;
    }
    composed += group;
    out += size;
    i += length;
  }
  starts[chars.length] = out;
  ends[chars.length] = out;

  return {
    text: composed,
    inlineAnnotations: remapInlineAnnotations(annotations, {
      last: chars.length,
      start: (index) => starts[index],
      end: (index) => ends[index],
    }),
  };
}

/**
 * Moves every annotation through `mapping`, dropping the ones left empty.
 *
 * Jukugo split points travel with their base span, and the `mono` / `group`
 * distinction is re-derived from the mapped span length, because a transform
 * can shorten a span to a single character or widen it past one.
 *
 * @param annotations - Annotations indexed against the source text.
 * @param mapping - Index mapping produced by the text transform.
 * @returns Annotations indexed against the transformed text.
 */
export function remapInlineAnnotations(
  annotations: readonly InlineAnnotation[],
  mapping: IndexMapping,
): InlineAnnotation[] {
  const out: InlineAnnotation[] = [];
  for (const ann of annotations) {
    const moved = remapAnnotation(ann, mapping);
    if (moved) out.push(moved);
  }
  return out;
}

/**
 * Length of the canonical composition group starting at `from`.
 *
 * A following character joins the group when normalizing it together with the
 * group differs from normalizing both separately — that is exactly when NFC
 * composes or reorders across the boundary. The cap keeps pathological runs of
 * combining marks linear.
 */
function composedGroupLength(chars: readonly string[], from: number): number {
  const limit = Math.min(chars.length, from + MAX_COMPOSED_GROUP);
  let group = chars[from];
  let length = 1;
  while (from + length < limit) {
    const next = chars[from + length];
    if (normalizeText(group + next) === normalizeText(group) + normalizeText(next)) break;
    group += next;
    length++;
  }
  return length;
}

/** Moves one annotation through the mapping, or returns null if nothing survives. */
function remapAnnotation(ann: InlineAnnotation, mapping: IndexMapping): InlineAnnotation | null {
  const startIndex = mapping.start(clampIndex(ann.startIndex, mapping.last));
  const endIndex = mapping.end(clampIndex(ann.endIndex, mapping.last));
  if (endIndex <= startIndex) return null;
  if (ann.kind === 'ruby') {
    return {
      ...ann,
      startIndex,
      endIndex,
      // The mono/group distinction follows the base length, which the
      // transform may have shortened.
      ...(ann.type === 'mono' || ann.type === 'group'
        ? { type: endIndex - startIndex === 1 ? ('mono' as const) : ('group' as const) }
        : {}),
      ...(ann.jukugoSplitPoints
        ? { jukugoSplitPoints: remapSplitPoints(ann, mapping, startIndex, endIndex) }
        : {}),
    };
  }
  return { ...ann, startIndex, endIndex };
}

/** Moves jukugo split points through the same mapping as their base span. */
function remapSplitPoints(
  ann: InlineRubyAnnotation,
  mapping: IndexMapping,
  startIndex: number,
  endIndex: number,
): number[] {
  const span = endIndex - startIndex;
  const points = new Set<number>();
  for (const point of ann.jukugoSplitPoints ?? []) {
    const moved = mapping.start(clampIndex(ann.startIndex + point, mapping.last)) - startIndex;
    if (moved > 0 && moved < span) points.add(moved);
  }
  return [...points].sort((a, b) => a - b);
}

function clampIndex(index: number, last: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(last, Math.trunc(index)));
}

function charCount(str: string): number {
  let count = 0;
  for (const _ of str) count++;
  return count;
}
