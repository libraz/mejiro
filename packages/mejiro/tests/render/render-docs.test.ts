/**
 * @vitest-environment happy-dom
 *
 * Runs the renderer examples printed in `docs/{en,ja}/01-getting-started.md`,
 * `04-ruby.md`, `07-pagination-and-rendering.md` and `09-advanced.md` against
 * real `buildRenderPage()` output, so a documented loop that stops handling a
 * `RenderSegment` variant fails here.
 */
import { describe, expect, it } from 'vitest';
import type { PageSlice } from '../../src/paginate.js';
import { buildRenderPage } from '../../src/render/page.js';
import { type InlineRenderNode, segmentToInlineNode } from '../../src/render/segment-descriptor.js';
import type { RenderEntry, RenderPage, RenderSegment } from '../../src/render/types.js';

// --- helpers exactly as documented -----------------------------------------

/** DOM writer from `07-pagination-and-rendering.md` and `01-getting-started.md`. */
function appendInlineNode(parent: Node, node: InlineRenderNode): void {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.text));
    return;
  }
  const el = document.createElement(node.tag);
  if (node.className) el.className = node.className;
  if (node.href) el.setAttribute('href', node.href);
  if (node.title) el.title = node.title;
  for (const child of node.children) appendInlineNode(el, child);
  parent.appendChild(el);
}

/** Flattening helper from `09-advanced.md` (Canvas example). */
function segmentText(segment: RenderSegment): string {
  return segment.type === 'ruby' ? segment.base : segment.text;
}

/** String renderer from `09-advanced.md`. */
function renderToString(page: RenderPage): string {
  return page.paragraphs
    .map((p) =>
      p.lines
        .map((l) =>
          l.segments.map((s) => (s.type === 'ruby' ? `${s.base}(${s.rubyText})` : s.text)).join(''),
        )
        .join('\n'),
    )
    .join('\n\n');
}

// --- fixtures ---------------------------------------------------------------

/** Paragraph exercising every `RenderSegment` variant plus a nested one. */
const TEXT = '漢字とルビ傍点2024縦横リンク注';

function annotated(): RenderEntry {
  return {
    chars: [...TEXT],
    breakPoints: new Uint32Array([]),
    inlineAnnotations: [
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ' },
      { kind: 'emphasis', startIndex: 5, endIndex: 7, style: 'dot' },
      { kind: 'tcy', startIndex: 7, endIndex: 11 },
      { kind: 'em', startIndex: 11, endIndex: 12 },
      { kind: 'strong', startIndex: 12, endIndex: 13 },
      { kind: 'link', startIndex: 13, endIndex: 16, href: 'ch2.xhtml', title: '第二章' },
      { kind: 'footnote', startIndex: 16, endIndex: 17, noteId: 'fn1' },
    ],
  };
}

const SLICES: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

function renderToDom(page: RenderPage): string {
  const div = document.createElement('div');
  for (const paragraph of page.paragraphs) {
    for (const line of paragraph.lines) {
      for (const segment of line.segments) {
        appendInlineNode(div, segmentToInlineNode(segment));
      }
    }
  }
  return div.innerHTML;
}

describe('documented RenderSegment renderers', () => {
  it('covers every segment variant produced for one paragraph', () => {
    const page = buildRenderPage(SLICES, [annotated()]);
    const types = page.paragraphs[0].lines[0].segments.map((s) => s.type);

    expect(new Set(types)).toEqual(
      new Set(['text', 'ruby', 'emphasis', 'tcy', 'em', 'strong', 'link', 'footnote-ref']),
    );
  });

  it('emits the documented markup for each variant', () => {
    const html = renderToDom(buildRenderPage(SLICES, [annotated()]));

    expect(html).toBe(
      '<ruby>漢字<rt>かんじ</rt></ruby>とルビ' +
        '<span class="mejiro-emphasis mejiro-emphasis--dot">傍点</span>' +
        '<span class="mejiro-tcy">2024</span>' +
        '<em>縦</em><strong>横</strong>' +
        '<a href="ch2.xhtml" title="第二章">リンク</a>' +
        '<a class="mejiro-footnote-ref" href="#fn1">注</a>',
    );
    expect(html).not.toContain('undefined');
  });

  it('renders nested annotations through children', () => {
    const entry: RenderEntry = {
      chars: [...'重要な漢字です'],
      breakPoints: new Uint32Array([]),
      inlineAnnotations: [
        { kind: 'strong', startIndex: 0, endIndex: 5 },
        { kind: 'ruby', startIndex: 3, endIndex: 5, rubyText: 'かんじ' },
      ],
    };

    expect(renderToDom(buildRenderPage(SLICES, [entry]))).toBe(
      '<strong>重要な<ruby>漢字<rt>かんじ</rt></ruby></strong>です',
    );
  });

  it('degrades an unsafe link URL to text instead of an anchor', () => {
    const entry: RenderEntry = {
      chars: [...'危険なリンク'],
      breakPoints: new Uint32Array([]),
      inlineAnnotations: [
        { kind: 'link', startIndex: 3, endIndex: 6, href: 'javascript:alert(1)' },
      ],
    };

    expect(renderToDom(buildRenderPage(SLICES, [entry]))).toBe('危険なリンク');
  });

  it('flattens every variant to text for canvas and string output', () => {
    const page = buildRenderPage(SLICES, [annotated()]);

    expect(page.paragraphs[0].lines[0].segments.map(segmentText).join('')).toBe(TEXT);
    expect(renderToString(page)).toBe('漢字(かんじ)とルビ傍点2024縦横リンク注');
  });
});
