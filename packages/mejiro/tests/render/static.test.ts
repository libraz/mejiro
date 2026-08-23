import { describe, expect, it } from 'vitest';
import type { BookParagraph } from '../../src/book/types.js';
import { renderEpubStatic } from '../../src/render/static.js';
import { toCodepoints } from '../../src/text.js';

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

  it('renders explicit newlines as line breaks instead of spaces', () => {
    const html = renderEpubStatic({
      paragraphs: [paragraph('一行目\n二行目')],
    });

    expect(html).toContain('一行目<br />二行目');
  });

  it('renders heading paragraphs with per-level classes', () => {
    const html = renderEpubStatic({
      paragraphs: [paragraph('Title', { headingLevel: 1, kind: 'heading' })],
    });
    expect(html).toContain('mejiro-paragraph--h1');
  });

  it('renders structural paragraph kind classes using CSS-friendly names', () => {
    const html = renderEpubStatic({
      paragraphs: [
        paragraph('quote', { kind: 'blockquote' }),
        paragraph('* * *', { kind: 'sceneBreak' }),
        paragraph('code', { kind: 'pre' }),
        paragraph('caption', { kind: 'figure' }),
      ],
    });

    expect(html).toContain('mejiro-paragraph--blockquote');
    expect(html).toContain('mejiro-paragraph--scene-break');
    expect(html).toContain('mejiro-paragraph--pre');
    expect(html).toContain('mejiro-paragraph--figure');
    expect(html).not.toContain('mejiro-paragraph--sceneBreak');
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

  it('does not render unsafe link schemes', () => {
    const html = renderEpubStatic({
      paragraphs: [
        paragraph('unsafe', {
          inlineAnnotations: [{ kind: 'link', startIndex: 0, endIndex: 6, href: 'javascript:x' }],
        }),
      ],
    });

    expect(html).toContain('>unsafe</div>');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
  });

  it('renders newlines inside an unsafe link as line breaks', () => {
    const html = renderEpubStatic({
      paragraphs: [
        paragraph('一行目\n二行目', {
          inlineAnnotations: [
            { kind: 'link', startIndex: 0, endIndex: 7, href: 'javascript:alert(1)' },
          ],
        }),
      ],
    });

    expect(html).toContain('一行目<br />二行目');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
  });

  it('keeps annotations nested inside an unsafe link', () => {
    const html = renderEpubStatic({
      paragraphs: [
        paragraph('漢字', {
          inlineAnnotations: [
            { kind: 'link', startIndex: 0, endIndex: 2, href: 'javascript:alert(1)' },
            { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
          ],
        }),
      ],
    });

    expect(html).toContain('<ruby>漢字<rt>かんじ</rt></ruby>');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
  });

  it('renders contained annotations such as ruby inside links', () => {
    const html = renderEpubStatic({
      paragraphs: [
        paragraph('漢字', {
          inlineAnnotations: [
            { kind: 'link', startIndex: 0, endIndex: 2, href: 'https://example.test' },
            { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
          ],
        }),
      ],
    });

    expect(html).toContain('<a href="https://example.test"><ruby>漢字<rt>かんじ</rt></ruby></a>');
  });

  it('splits decomposed text on NFC boundaries like the measured layout does', () => {
    // Decomposed `がぎ` followed by `漢字`.
    const text = `${String.fromCodePoint(0x304b, 0x3099, 0x304d, 0x3099)}漢字`;
    const html = renderEpubStatic({
      paragraphs: [
        paragraph(text, {
          inlineAnnotations: [{ kind: 'ruby', startIndex: 2, endIndex: 3, rubyText: 'かん' }],
        }),
      ],
    });

    expect(toCodepoints(text)).toHaveLength(4);
    expect(html).toContain('がぎ<ruby>漢<rt>かん</rt></ruby>字');
  });

  it('honors tag and ariaLabel options', () => {
    const html = renderEpubStatic(
      { paragraphs: [paragraph('hi')] },
      { tag: 'article', ariaLabel: 'Chapter 1' },
    );
    expect(html).toMatch(/^<article /);
    expect(html).toContain('aria-label="Chapter 1"');
  });

  it('falls back to div for runtime-invalid wrapper tags', () => {
    const html = renderEpubStatic(
      { paragraphs: [paragraph('hi')] },
      { tag: 'img src=x onerror=alert(1)' as 'div' },
    );

    expect(html).toMatch(/^<div /);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img ');
  });
});
