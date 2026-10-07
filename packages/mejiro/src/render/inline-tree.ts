import type { InlineAnnotation } from '../browser/types.js';
import { resolveJukugoAggregates } from '../ruby.js';

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
  | {
      type: 'ruby';
      rubyText: string;
      base: string;
      children: InlineNode[];
      /**
       * Set on every segment of a jukugo word after the first: the segment
       * shares one `<ruby>` element with the ruby sibling before it, which is
       * how a serializer writes the word's split points back.
       */
      continuesJukugo?: true;
    }
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
 * Which annotations survive (see {@link partiallyOverlaps}) is decided on the
 * whole paragraph before any clamping, so the result never depends on where a
 * caller slices it. That per-paragraph pass is cached per `annotations` array,
 * which is therefore treated as immutable; a slice then only visits the
 * annotations intersecting it.
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
  const prepared = prepareAnnotations(annotations, chars.length);
  const slice = sliceAnnotations(prepared, start, end);
  return buildRange(chars, start, end, slice, 0, slice.length, prepared.continuations);
}

/**
 * Returns the content an element node renders inside itself: its `children`
 * when an annotation is nested in the span, otherwise its flattened text as a
 * single `text` leaf. Every consumer of the tree resolves element content here,
 * so no renderer flattens a span another one descends into.
 *
 * @param node - Element node of a tree built by {@link buildInlineNodes}.
 * @returns Nodes covering the element's characters exactly once.
 */
export function inlineNodeContent(
  node: Exclude<InlineNode, { type: 'text' }>,
): readonly InlineNode[] {
  if (node.children.length > 0) return node.children;
  return [{ type: 'text', text: node.type === 'ruby' ? node.base : node.text }];
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

/** Paragraph-level annotation state shared by every slice of one paragraph. */
interface PreparedAnnotations {
  readonly charCount: number;
  /** Surviving annotations, sorted by {@link compareAnnotations}; a laminar family. */
  readonly sorted: readonly InlineAnnotation[];
  /** Index in `sorted` of each annotation's innermost container, or -1. */
  readonly parent: Int32Array;
  /** Per-segment ruby annotations continuing a jukugo word. */
  readonly continuations: ReadonlySet<InlineAnnotation>;
}

const preparedCache = new WeakMap<readonly InlineAnnotation[], PreparedAnnotations>();

function compareAnnotations(a: InlineAnnotation, b: InlineAnnotation): number {
  return (
    a.startIndex - b.startIndex ||
    b.endIndex - a.endIndex ||
    annotationNestingRank(a) - annotationNestingRank(b)
  );
}

function prepareAnnotations(
  annotations: readonly InlineAnnotation[],
  charCount: number,
): PreparedAnnotations {
  const cached = preparedCache.get(annotations);
  if (cached && cached.charCount === charCount) return cached;

  const resolved = resolveJukugoAggregates(annotations.filter((ann) => ann.kind === 'ruby'));
  const covered: ReadonlySet<InlineAnnotation> = resolved.aggregates;
  const continuations: ReadonlySet<InlineAnnotation> = resolved.continuations;
  const valid = annotations
    .filter(
      (ann) =>
        !covered.has(ann) &&
        ann.startIndex >= 0 &&
        ann.endIndex <= charCount &&
        ann.endIndex > ann.startIndex,
    )
    .sort(compareAnnotations);

  // Both members of every interleaving pair are dropped. Sorted by start, a
  // pair can only interleave while the earlier one is still open.
  const dropped = new Set<InlineAnnotation>();
  let open: InlineAnnotation[] = [];
  for (const ann of valid) {
    open = open.filter((other) => other.endIndex > ann.startIndex);
    for (const other of open) {
      if (partiallyOverlaps(ann, other)) {
        dropped.add(ann);
        dropped.add(other);
      }
    }
    open.push(ann);
  }
  const sorted = dropped.size > 0 ? valid.filter((ann) => !dropped.has(ann)) : valid;

  const parent = new Int32Array(sorted.length);
  const stack: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    while (stack.length > 0 && sorted[stack[stack.length - 1]].endIndex <= sorted[i].startIndex) {
      stack.pop();
    }
    parent[i] = stack.length > 0 ? stack[stack.length - 1] : -1;
    stack.push(i);
  }

  const prepared = { charCount, sorted, parent, continuations };
  preparedCache.set(annotations, prepared);
  return prepared;
}

/** Index of the first annotation in `sorted` whose start is at or after `index`. */
function lowerBound(sorted: readonly InlineAnnotation[], index: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].startIndex < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Collects the annotations intersecting `[start, end)`, clamped to it: the
 * containers still open at `start` (an ancestor chain, outermost first) plus
 * those starting inside the slice in paragraph order, so the cost follows the
 * slice rather than the paragraph and the whole-paragraph nesting is kept.
 */
function sliceAnnotations(
  prepared: PreparedAnnotations,
  start: number,
  end: number,
): InlineAnnotation[] {
  const { sorted, parent } = prepared;
  const first = lowerBound(sorted, start);
  const open: InlineAnnotation[] = [];
  for (let k = first - 1; k >= 0; k = parent[k]) {
    if (sorted[k].endIndex > start) open.push(sorted[k]);
  }
  const result: InlineAnnotation[] = [];
  for (let k = open.length - 1; k >= 0; k--) {
    const clamped = clampAnnotation(open[k], start, end);
    if (clamped) result.push(clamped);
  }
  for (let k = first; k < sorted.length && sorted[k].startIndex < end; k++) {
    const clamped = clampAnnotation(sorted[k], start, end);
    if (clamped) result.push(clamped);
  }
  // Ancestors stay ahead of what they contain even when clamping ties their ranges.
  return result;
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

/**
 * Builds nodes for `annotations[from..to)`, a sorted laminar run covering
 * `[start, end)`: an annotation's descendants are the contiguous run after it
 * that starts before it ends.
 */
function buildRange(
  chars: readonly string[],
  start: number,
  end: number,
  annotations: readonly InlineAnnotation[],
  from: number,
  to: number,
  continuations: ReadonlySet<InlineAnnotation>,
): InlineNode[] {
  const nodes: InlineNode[] = [];
  let pos = start;
  let i = from;
  while (i < to) {
    const ann = annotations[i];
    let next = i + 1;
    while (next < to && annotations[next].startIndex < ann.endIndex) next++;

    if (ann.startIndex > pos) {
      pushText(nodes, chars.slice(pos, ann.startIndex).join(''));
    }
    const text = chars.slice(ann.startIndex, ann.endIndex).join('');
    const children =
      next > i + 1
        ? buildRange(chars, ann.startIndex, ann.endIndex, annotations, i + 1, next, continuations)
        : [];
    const node = toNode(ann, text, children);
    if (node.type === 'ruby' && ann.startIndex > start && continuations.has(ann)) {
      node.continuesJukugo = true;
    }
    nodes.push(node);
    pos = ann.endIndex;
    i = next;
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
