import { describe, expect, it } from 'vitest';
import type { BookParagraph } from '../../src/book/types.js';
import { renderEpubStatic } from '../../src/render/static.js';

function paragraph(text: string, extra: Partial<BookParagraph> = {}): BookParagraph {
  return { text, ...extra };
}

describe('renderEpubStatic', () => {
  it('wraps paragraphs in mejiro-page markup with vertical-rl semantics', () => {
    const html = renderEpubStatic({
      paragraphs: [paragraph('hello'), paragraph('world')],
    });
    expect(html).toMatch(/^<div class="mejiro-page">/);
    expect(html).toContain('<div class="mejiro-paragraph">hello</div>');
    expect(html).toContain('<div class="mejiro-paragraph">world</div>');
    expect(html).toMatch(/<\/div>$/);
  });

  it('escapes HTML special characters in text and attribute values', () => {
    const html = renderEpubStatic({
      paragraphs: [paragraph('< & > " evil')],
    });
    expect(html).toContain('&lt; &amp; &gt; " evil');
    expect(html).not.toContain('<evil>');
  });

  it('renders heading paragraphs with per-level classes', () => {
    const html = renderEpubStatic({
      paragraphs: [paragraph('Title', { headingLevel: 1, kind: 'heading' })],
    });
    expect(html).toContain('mejiro-paragraph--h1');
  });

  it('renders inline annotations (ruby / emphasis / tcy / em / strong / link / footnote)', () => {
    const html = renderEpubStatic({
      paragraphs: [
        paragraph('漢字abcdef', {
          inlineAnnotations: [
            { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ' },
            { kind: 'emphasis', startIndex: 2, endIndex: 3, style: 'sesame' },
            { kind: 'tcy', startIndex: 3, endIndex: 4 },
            { kind: 'em', startIndex: 4, endIndex: 5 },
            { kind: 'strong', startIndex: 5, endIndex: 6 },
            { kind: 'link', startIndex: 6, endIndex: 7, href: '/x' },
            { kind: 'footnote', startIndex: 7, endIndex: 8, noteId: 'n1' },
          ],
        }),
      ],
    });
    expect(html).toContain('<ruby>漢字<rt>かんじ</rt></ruby>');
    expect(html).toContain('mejiro-emphasis mejiro-emphasis--sesame');
    expect(html).toContain('class="mejiro-tcy"');
    expect(html).toContain('<em>c</em>');
    expect(html).toContain('<strong>d</strong>');
    expect(html).toContain('<a href="/x">e</a>');
    expect(html).toContain('class="mejiro-footnote-ref"');
  });

  it('honors tag and ariaLabel options', () => {
    const html = renderEpubStatic(
      { paragraphs: [paragraph('hi')] },
      { tag: 'article', ariaLabel: 'Chapter 1' },
    );
    expect(html).toMatch(/^<article /);
    expect(html).toContain('aria-label="Chapter 1"');
  });
});
