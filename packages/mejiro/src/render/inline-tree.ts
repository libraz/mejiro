import type { InlineAnnotation } from '../browser/types.js';

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'ruby'; rubyText: string; base: string; children: InlineNode[] }
  | { type: 'emphasis'; style: 'sesame' | 'dot' | 'circle'; text: string; children: InlineNode[] }
  | { type: 'tcy'; text: string; children: InlineNode[] }
  | { type: 'em'; text: string; children: InlineNode[] }
  | { type: 'strong'; text: string; children: InlineNode[] }
  | { type: 'link'; text: string; href: string; title?: string; children: InlineNode[] }
  | { type: 'footnote-ref'; text: string; noteId: string; children: InlineNode[] };

export function buildInlineNodes(
  chars: readonly string[],
  annotations: readonly InlineAnnotation[],
  start = 0,
  end = chars.length,
): InlineNode[] {
  const normalized = serializableAnnotations(annotations, chars.length).filter(
    (ann) => ann.startIndex < end && ann.endIndex > start,
  );
  return buildRange(chars, start, end, normalized);
}

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

export function partiallyOverlaps(a: InlineAnnotation, b: InlineAnnotation): boolean {
  if (a === b) return false;
  const overlaps = a.startIndex < b.endIndex && b.startIndex < a.endIndex;
  const aContainsB = a.startIndex <= b.startIndex && a.endIndex >= b.endIndex;
  const bContainsA = b.startIndex <= a.startIndex && b.endIndex >= a.endIndex;
  return overlaps && !aContainsB && !bContainsA;
}

function serializableAnnotations(
  inlineAnnotations: readonly InlineAnnotation[],
  charCount: number,
): InlineAnnotation[] {
  return inlineAnnotations
    .filter((ann) => ann.kind !== 'ruby' || ann.type !== 'jukugo')
    .filter(
      (ann) => ann.startIndex >= 0 && ann.endIndex <= charCount && ann.endIndex > ann.startIndex,
    )
    .slice()
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
