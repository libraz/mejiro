import type { InlineAnnotation } from '../browser/types.js';

/**
 * Node of the nested inline tree {@link buildInlineNodes} produces — one variant
 * per {@link InlineAnnotation} kind, plus the `text` leaf.
 *
 * Every element variant carries both its own flattened content (`text`, or
 * `base` for ruby) and its `children`. `children` is empty when nothing is
 * nested inside the span, in which case consumers render the flattened string;
 * when it is non-empty it covers exactly the same character range, so rendering
 * both would duplicate the text.
 */
export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'ruby'; rubyText: string; base: string; children: InlineNode[] }
  | { type: 'emphasis'; style: 'sesame' | 'dot' | 'circle'; text: string; children: InlineNode[] }
  | { type: 'tcy'; text: string; children: InlineNode[] }
  | { type: 'em'; text: string; children: InlineNode[] }
  | { type: 'strong'; text: string; children: InlineNode[] }
  | { type: 'link'; text: string; href: string; title?: string; children: InlineNode[] }
  | { type: 'footnote-ref'; text: string; noteId: string; children: InlineNode[] };

/**
 * Builds the inline node tree for the `[start, end)` slice of a paragraph.
 *
 * Annotations that cross the slice boundary are clamped to it — the same way a
 * CSS inline box is split across line boxes — so a span covering `[5, 10)` of a
 * paragraph broken at 8 contributes `[5, 8)` to one slice and `[8, 10)` to the
 * next, keeping its type and metadata (`href`, `noteId`, emphasis style) on both
 * halves. Ruby is the one exception: a reading cannot be repeated over two
 * halves of its base, so a ruby annotation whose base starts before `start`
 * contributes plain text and the reading stays on the slice that owns its start.
 *
 * @param chars - Character array of the whole paragraph.
 * @param annotations - Inline annotations addressed in paragraph coordinates.
 * @param start - Start index of the slice (inclusive).
 * @param end - End index of the slice (exclusive).
 * @returns Inline nodes covering exactly `chars[start..end)`.
 */
export function buildInlineNodes(
  chars: readonly string[],
  annotations: readonly InlineAnnotation[],
  start = 0,
  end = chars.length,
): InlineNode[] {
  return buildRange(
    chars,
    start,
    end,
    serializableAnnotations(annotations, chars.length, start, end),
  );
}

/**
 * Nesting depth an annotation kind occupies when several cover the same range.
 *
 * Lower ranks become outer elements: links and footnote references wrap
 * emphasis, which wraps tate-chu-yoko, which wraps ruby. The order matches the
 * markup HTML expects — a `<ruby>` inside an `<a>` rather than the reverse —
 * and is the last tiebreaker when sorting equally positioned annotations.
 *
 * @returns Rank from 0 (outermost) to 3 (innermost).
 */
export function annotationNestingRank(ann: InlineAnnotation): number {
  switch (ann.kind) {
    case 'link':
    case 'footnote':
      return 0;
    case 'emphasis':
    case 'em':
    case 'strong':
      return 1;
    case 'tcy':
      return 2;
    case 'ruby':
      return 3;
  }
}

/**
 * Reports whether two annotations interleave rather than nest.
 *
 * Ranges that are disjoint, identical, or fully contained one in the other are
 * expressible as a tree and return `false`; only a straddling pair such as
 * `[0, 4)` and `[2, 6)` returns `true`. {@link buildInlineNodes} drops both
 * members of such a pair, since no well-formed markup can express them, and
 * comparing an annotation with itself is therefore not an overlap.
 */
export function partiallyOverlaps(a: InlineAnnotation, b: InlineAnnotation): boolean {
  if (a === b) return false;
  const overlaps = a.startIndex < b.endIndex && b.startIndex < a.endIndex;
  const aContainsB = a.startIndex <= b.startIndex && a.endIndex >= b.endIndex;
  const bContainsA = b.startIndex <= a.startIndex && b.endIndex >= a.endIndex;
  return overlaps && !aContainsB && !bContainsA;
}

/**
 * Returns true when `ann` is a jukugo ruby annotation whose ruby text is
 * already rendered by the per-segment ruby annotations it covers. Such an
 * aggregate exists only to carry split points for the line breaker.
 */
function isCoveredJukugo(
  ann: InlineAnnotation,
  inlineAnnotations: readonly InlineAnnotation[],
): boolean {
  if (ann.kind !== 'ruby' || ann.type !== 'jukugo') return false;
  const span = ann.endIndex - ann.startIndex;
  return inlineAnnotations.some(
    (other) =>
      other !== ann &&
      other.kind === 'ruby' &&
      other.startIndex >= ann.startIndex &&
      other.endIndex <= ann.endIndex &&
      (other.endIndex - other.startIndex < span || other.type !== 'jukugo'),
  );
}

/**
 * Restricts an annotation to `[start, end)`, or returns `undefined` when nothing
 * of it survives. Ruby readings are not repeatable, so a ruby whose base is cut
 * at the head is dropped and its base renders as plain text on that slice.
 */
function clampAnnotation(
  ann: InlineAnnotation,
  start: number,
  end: number,
): InlineAnnotation | undefined {
  const startIndex = Math.max(ann.startIndex, start);
  const endIndex = Math.min(ann.endIndex, end);
  if (endIndex <= startIndex) return undefined;
  if (startIndex === ann.startIndex && endIndex === ann.endIndex) return ann;
  if (ann.kind === 'ruby' && ann.startIndex < start) return undefined;
  return { ...ann, startIndex, endIndex };
}

function serializableAnnotations(
  inlineAnnotations: readonly InlineAnnotation[],
  charCount: number,
  start: number,
  end: number,
): InlineAnnotation[] {
  return inlineAnnotations
    .filter((ann) => !isCoveredJukugo(ann, inlineAnnotations))
    .filter(
      (ann) => ann.startIndex >= 0 && ann.endIndex <= charCount && ann.endIndex > ann.startIndex,
    )
    .map((ann) => clampAnnotation(ann, start, end))
    .filter((ann): ann is InlineAnnotation => ann !== undefined)
    .sort(
      (a, b) =>
        a.startIndex - b.startIndex ||
        b.endIndex - a.endIndex ||
        annotationNestingRank(a) - annotationNestingRank(b),
    );
}

function buildRange(
  chars: readonly string[],
  start: number,
  end: number,
  annotations: readonly InlineAnnotation[],
): InlineNode[] {
  const nodes: InlineNode[] = [];
  let pos = start;
  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    if (ann.startIndex < pos || ann.startIndex < start || ann.endIndex > end) continue;
    if (annotations.some((other) => partiallyOverlaps(ann, other))) continue;

    if (ann.startIndex > pos) {
      pushText(nodes, chars.slice(pos, ann.startIndex).join(''));
    }

    const children = annotations.filter(
      (child, childIndex) =>
        childIndex > i && child.startIndex >= ann.startIndex && child.endIndex <= ann.endIndex,
    );
    const text = chars.slice(ann.startIndex, ann.endIndex).join('');
    nodes.push(
      toNode(
        ann,
        text,
        children.length > 0 ? buildRange(chars, ann.startIndex, ann.endIndex, children) : [],
      ),
    );
    pos = ann.endIndex;
  }
  if (pos < end) {
    pushText(nodes, chars.slice(pos, end).join(''));
  }
  return nodes;
}

function pushText(nodes: InlineNode[], text: string): void {
  if (text) nodes.push({ type: 'text', text });
}

function toNode(ann: InlineAnnotation, text: string, children: InlineNode[]): InlineNode {
  switch (ann.kind) {
    case 'ruby':
      return { type: 'ruby', base: text, rubyText: ann.rubyText, children };
    case 'emphasis':
      return { type: 'emphasis', text, style: ann.style ?? 'sesame', children };
    case 'tcy':
      return { type: 'tcy', text, children };
    case 'em':
      return { type: 'em', text, children };
    case 'strong':
      return { type: 'strong', text, children };
    case 'link':
      return ann.title != null
        ? { type: 'link', text, href: ann.href, title: ann.title, children }
        : { type: 'link', text, href: ann.href, children };
    case 'footnote':
      return { type: 'footnote-ref', text, noteId: ann.noteId, children };
  }
}
