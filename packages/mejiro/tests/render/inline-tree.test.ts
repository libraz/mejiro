import { describe, expect, it } from 'vitest';
import type { InlineAnnotation } from '../../src/browser/types.js';
import { buildInlineNodes, type InlineNode } from '../../src/render/inline-tree.js';
import { segmentToInlineNode } from '../../src/render/segment-descriptor.js';

const chars = [...'abcdefghijklmnop'];

/** Kinds of the element nodes in a tree, depth first. */
function elementKinds(nodes: readonly InlineNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'text' ? [] : [node.type, ...elementKinds(node.children)],
  );
}

describe('buildInlineNodes', () => {
  it('drops a partially overlapping pair however the paragraph is sliced', () => {
    const annotations: InlineAnnotation[] = [
      { kind: 'em', startIndex: 2, endIndex: 8 },
      { kind: 'strong', startIndex: 5, endIndex: 12 },
    ];

    expect(elementKinds(buildInlineNodes(chars, annotations))).toEqual([]);
    expect(elementKinds(buildInlineNodes(chars, annotations, 0, 7))).toEqual([]);
    expect(elementKinds(buildInlineNodes(chars, annotations, 7, 15))).toEqual([]);
  });

  it('keeps the survivors of an overlap check nested identically on every slice', () => {
    const annotations: InlineAnnotation[] = [
      { kind: 'link', startIndex: 1, endIndex: 12, href: 'https://example.test' },
      { kind: 'em', startIndex: 2, endIndex: 8 },
      { kind: 'strong', startIndex: 5, endIndex: 12 },
      { kind: 'tcy', startIndex: 9, endIndex: 11 },
    ];
    const whole = buildInlineNodes(chars, annotations);
    const lines = [0, 4, 7, 10, 16].slice(1).map((end, i, ends) => {
      const start = i === 0 ? 0 : ends[i - 1];
      return buildInlineNodes(chars, annotations, start, end);
    });

    expect(elementKinds(whole)).toEqual(['link', 'tcy']);
    expect(lines.map(elementKinds)).toEqual([['link'], ['link'], ['link', 'tcy'], ['link', 'tcy']]);
  });

  it('keeps whole-paragraph ancestry on every slice, even when clamping ties ranges', () => {
    const annotations: InlineAnnotation[] = [
      { kind: 'link', startIndex: 0, endIndex: 10, href: 'https://example.test' },
      { kind: 'tcy', startIndex: 1, endIndex: 5 },
      { kind: 'em', startIndex: 3, endIndex: 5 },
      { kind: 'strong', startIndex: 6, endIndex: 10 },
      { kind: 'emphasis', startIndex: 6, endIndex: 8 },
      { kind: 'ruby', startIndex: 8, endIndex: 10, rubyText: 'る' },
    ];
    /** `outer>inner` for every element and each of its descendants. */
    const ancestry = (nodes: readonly InlineNode[], outer: string[] = []): string[] =>
      nodes.flatMap((node) =>
        node.type === 'text'
          ? []
          : [
              ...outer.map((kind) => `${kind}>${node.type}`),
              ...ancestry(node.children, [...outer, node.type]),
            ],
      );
    const whole = new Set(ancestry(buildInlineNodes(chars, annotations)));

    for (let cut = 1; cut < chars.length; cut++) {
      for (const [start, end] of [
        [0, cut],
        [cut, chars.length],
      ]) {
        for (const pair of ancestry(buildInlineNodes(chars, annotations, start, end))) {
          const [outer, inner] = pair.split('>');
          expect(whole.has(`${inner}>${outer}`), `slice [${start}, ${end}) has ${pair}`).toBe(
            false,
          );
        }
      }
    }
    // tcy [1, 5) holds em [3, 5); cut at 3, both clamp to [3, 5) and tcy stays outside.
    expect(elementKinds(buildInlineNodes(chars, annotations, 3, 16))).toEqual([
      'link',
      'tcy',
      'em',
      'strong',
      'emphasis',
      'ruby',
    ]);
  });

  it('visits only the annotations a slice intersects', () => {
    // Every property read on an annotation is counted.
    let reads = 0;
    const counted = (ann: InlineAnnotation): InlineAnnotation =>
      new Proxy(ann, {
        get(target, key, receiver) {
          reads++;
          return Reflect.get(target, key, receiver);
        },
      });
    const readsForOneLine = (annotationCount: number): number => {
      const text = Array.from({ length: annotationCount * 2 }, () => '字');
      const annotations = Array.from({ length: annotationCount }, (_, i) =>
        counted(
          i % 3 === 0
            ? {
                kind: 'ruby',
                startIndex: 2 * i,
                endIndex: 2 * i + 2,
                rubyText: 'じ',
                type: 'jukugo',
              }
            : { kind: 'ruby', startIndex: 2 * i, endIndex: 2 * i + 1, rubyText: 'じ' },
        ),
      );
      // The per-paragraph pass runs once; later lines of the same paragraph reuse it.
      buildInlineNodes(text, annotations, 0, 10);
      reads = 0;
      const middle = annotationCount;
      buildInlineNodes(text, annotations, middle, middle + 10);
      return reads;
    };

    const small = readsForOneLine(100);
    const large = readsForOneLine(10_000);
    expect(small).toBeGreaterThan(0);
    // Binary search adds a logarithmic term; a per-line scan of the paragraph would add 100x.
    expect(large).toBeLessThan(small * 2);
  });
});

describe('segmentToInlineNode', () => {
  it('keeps the nested annotations of a link whose URL is rejected', () => {
    const node = segmentToInlineNode({
      type: 'link',
      text: '漢字',
      href: 'javascript:alert(1)',
      children: [{ type: 'ruby', base: '漢字', rubyText: 'かんじ' }],
    });

    expect(node).toEqual({
      type: 'element',
      tag: 'ruby',
      className: undefined,
      href: undefined,
      title: undefined,
      children: [
        { type: 'text', text: '漢字' },
        {
          type: 'element',
          tag: 'rt',
          className: undefined,
          href: undefined,
          title: undefined,
          children: [{ type: 'text', text: 'かんじ' }],
        },
      ],
    });
  });

  it('groups several nested nodes of a rejected link in a plain span', () => {
    const node = segmentToInlineNode({
      type: 'link',
      text: '漢字です',
      href: 'javascript:alert(1)',
      children: [
        { type: 'ruby', base: '漢字', rubyText: 'かんじ' },
        { type: 'text', text: 'です' },
      ],
    });

    expect(node.type === 'element' && node.tag).toBe('span');
    expect(node.type === 'element' && node.className).toBeUndefined();
    expect(node.type === 'element' && node.children.map((child) => child.type)).toEqual([
      'element',
      'text',
    ]);
  });
});
