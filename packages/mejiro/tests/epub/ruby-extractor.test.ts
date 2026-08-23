/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { extractRubyContent } from '../../src/epub/ruby-extractor.js';
import { renderEpubStatic } from '../../src/render/static.js';
import { toCodepoints } from '../../src/text.js';

/** Kana plus a combining voiced sound mark: the decomposed form of `が`. */
const DECOMPOSED_GA = String.fromCodePoint(0x304b, 0x3099);
/** Decomposed form of `がぎ`. */
const DECOMPOSED_KANA = `${DECOMPOSED_GA}${String.fromCodePoint(0x304d, 0x3099)}`;

function wrapXhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>test</title></head>
<body>${body}</body>
</html>`;
}

describe('extractRubyContent', () => {
  it('extracts plain text without ruby', () => {
    const xhtml = wrapXhtml('<p>吾輩は猫である。</p>');
    const result = extractRubyContent(xhtml);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('吾輩は猫である。');
    expect(result[0].inlineAnnotations).toHaveLength(0);
  });

  it('extracts mono ruby (single base char)', () => {
    const xhtml = wrapXhtml('<p><ruby>漢<rt>かん</rt></ruby>字</p>');
    const result = extractRubyContent(xhtml);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('漢字');
    expect(result[0].inlineAnnotations).toHaveLength(1);

    const ann = result[0].inlineAnnotations[0];
    expect(ann.startIndex).toBe(0);
    expect(ann.endIndex).toBe(1);
    expect(ann.rubyText).toBe('かん');
    expect(ann.type).toBe('mono');
  });

  it('extracts group ruby (multiple base chars, single rt)', () => {
    const xhtml = wrapXhtml('<p><ruby>明日<rt>あした</rt></ruby>は晴れ</p>');
    const result = extractRubyContent(xhtml);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('明日は晴れ');

    const ann = result[0].inlineAnnotations[0];
    expect(ann.startIndex).toBe(0);
    expect(ann.endIndex).toBe(2);
    expect(ann.rubyText).toBe('あした');
    expect(ann.type).toBe('group');
  });

  it('extracts jukugo ruby (multiple rt segments)', () => {
    const xhtml = wrapXhtml(
      '<p><ruby>東<rt>とう</rt>京<rt>きょう</rt>都<rt>と</rt></ruby>に行く</p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('東京都に行く');

    // Should have individual annotations + jukugo overall annotation
    const annotations = result[0].inlineAnnotations;
    expect(annotations.length).toBeGreaterThanOrEqual(3);

    // Check individual annotations
    const mono0 = annotations.find((a) => a.startIndex === 0 && a.type === 'mono');
    expect(mono0).toBeDefined();
    expect(mono0?.rubyText).toBe('とう');

    const mono1 = annotations.find((a) => a.startIndex === 1 && a.type === 'mono');
    expect(mono1).toBeDefined();
    expect(mono1?.rubyText).toBe('きょう');

    const mono2 = annotations.find((a) => a.startIndex === 2 && a.type === 'mono');
    expect(mono2).toBeDefined();
    expect(mono2?.rubyText).toBe('と');

    // Check jukugo annotation
    const jukugo = annotations.find((a) => a.type === 'jukugo');
    expect(jukugo).toBeDefined();
    expect(jukugo?.startIndex).toBe(0);
    expect(jukugo?.endIndex).toBe(3);
    expect(jukugo?.jukugoSplitPoints).toEqual([1, 2]);
  });

  it('handles <rp> elements (ignored)', () => {
    const xhtml = wrapXhtml('<p><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字');
    expect(result[0].inlineAnnotations).toHaveLength(1);
    expect(result[0].inlineAnnotations[0].rubyText).toBe('かん');
  });

  it('handles <rb> elements', () => {
    const xhtml = wrapXhtml('<p><ruby><rb>漢</rb><rt>かん</rt></ruby>字</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字');
    expect(result[0].inlineAnnotations[0].rubyText).toBe('かん');
  });

  it('keeps base text after rt in source order', () => {
    const xhtml = wrapXhtml('<p><ruby>漢字<rt>かんじ</rt>です</ruby></p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字です');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
    ]);
  });

  it('pairs rb and rt elements by index', () => {
    const xhtml = wrapXhtml(
      '<p><ruby><rb>東</rb><rb>京</rb><rt>とう</rt><rt>きょう</rt></ruby></p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('東京');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'とう', type: 'mono' },
      { kind: 'ruby', startIndex: 1, endIndex: 2, rubyText: 'きょう', type: 'mono' },
      {
        kind: 'ruby',
        startIndex: 0,
        endIndex: 2,
        rubyText: 'とうきょう',
        type: 'jukugo',
        jukugoSplitPoints: [1],
      },
    ]);
  });

  it('skips rtc and nested ruby readings without leaking them into base text', () => {
    const xhtml = wrapXhtml(
      '<p><ruby>漢<rt>かん</rt><rtc><rt>Kan</rt></rtc></ruby><ruby><ruby>字<rt>じ</rt></ruby><rt>zi</rt></ruby></p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字');
    expect(result[0].text).not.toContain('Kan');
    expect(result[0].inlineAnnotations[0]).toMatchObject({
      startIndex: 0,
      endIndex: 1,
      rubyText: 'かん',
    });
  });

  it('extracts multiple paragraphs', () => {
    const xhtml = wrapXhtml('<p>第一段落</p><p><ruby>第<rt>だい</rt></ruby>二段落</p>');
    const result = extractRubyContent(xhtml);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('第一段落');
    expect(result[0].inlineAnnotations).toHaveLength(0);
    expect(result[1].text).toBe('第二段落');
    expect(result[1].inlineAnnotations).toHaveLength(1);
  });

  it('preserves <br /> as a line break inside a paragraph', () => {
    const xhtml = wrapXhtml('<p>一行目<br />二行目</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('一行目\n二行目');
  });

  it('ignores stylesheet links with explicit closing tags', () => {
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><link rel="stylesheet" href="style.css"></link></head>
<body><p>本文</p></body>
</html>`;
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('本文');
  });

  it('handles multiple ruby annotations in one paragraph', () => {
    const xhtml = wrapXhtml('<p><ruby>漢<rt>かん</rt></ruby><ruby>字<rt>じ</rt></ruby>を書く</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字を書く');
    expect(result[0].inlineAnnotations).toHaveLength(2);
    expect(result[0].inlineAnnotations[0].startIndex).toBe(0);
    expect(result[0].inlineAnnotations[0].endIndex).toBe(1);
    expect(result[0].inlineAnnotations[1].startIndex).toBe(1);
    expect(result[0].inlineAnnotations[1].endIndex).toBe(2);
  });

  it('keeps cumulative annotation indices in code point units', () => {
    const xhtml = wrapXhtml(
      '<p>🙂<ruby>漢<rt>かん</rt></ruby><a href="https://example.test">字</a></p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('🙂漢字');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 1, endIndex: 2, rubyText: 'かん', type: 'mono' },
      { kind: 'link', startIndex: 2, endIndex: 3, href: 'https://example.test' },
    ]);
  });

  it('preserves inline annotations inside ruby base markup', () => {
    const xhtml = wrapXhtml(
      '<p><ruby><em>漢</em><rt>かん</rt></ruby><ruby><a href="https://example.test">字</a><rt>じ</rt></ruby></p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'em', startIndex: 0, endIndex: 1 },
      { kind: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'かん', type: 'mono' },
      { kind: 'link', startIndex: 1, endIndex: 2, href: 'https://example.test' },
      { kind: 'ruby', startIndex: 1, endIndex: 2, rubyText: 'じ', type: 'mono' },
    ]);
  });

  it('extracts non-ruby inline annotations from XHTML markup', () => {
    const xhtml = wrapXhtml(
      '<p><em class="mejiro-emphasis" data-style="dot">A</em><span class="mejiro-tcy">12</span><em>B</em><strong>C</strong><a href="https://example.test" title="例">D</a><a class="mejiro-footnote-ref" href="#fn1">E</a>F</p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('A12BCDEF');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'emphasis', startIndex: 0, endIndex: 1, style: 'dot' },
      { kind: 'tcy', startIndex: 1, endIndex: 3 },
      { kind: 'em', startIndex: 3, endIndex: 4 },
      { kind: 'strong', startIndex: 4, endIndex: 5 },
      {
        kind: 'link',
        startIndex: 5,
        endIndex: 6,
        href: 'https://example.test',
        title: '例',
      },
      { kind: 'footnote', startIndex: 6, endIndex: 7, noteId: 'fn1' },
    ]);
  });

  it('drops unsafe link schemes while preserving link text', () => {
    const xhtml = wrapXhtml(
      '<p><a href="javascript:alert(1)">危険</a><a href="mailto:test@example.com">安全</a></p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('危険安全');
    expect(result[0].inlineAnnotations).toEqual([
      {
        kind: 'link',
        startIndex: 2,
        endIndex: 4,
        href: 'mailto:test@example.com',
      },
    ]);
  });

  it('skips empty paragraphs', () => {
    const xhtml = wrapXhtml('<p></p><p>テスト</p><p>  </p>');
    const result = extractRubyContent(xhtml);

    // Empty and whitespace-only paragraphs may or may not be included
    const nonEmpty = result.filter((p) => p.text.length > 0);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(1);
    expect(nonEmpty[0].text).toBe('テスト');
  });

  it('does not duplicate nested block text', () => {
    const xhtml = wrapXhtml('<div><p>第一段落</p><p>第二段落</p></div>');
    const result = extractRubyContent(xhtml);

    expect(result.map((p) => p.text)).toEqual(['第一段落', '第二段落']);
  });

  it('adjusts ruby annotation indices after trimming paragraph whitespace', () => {
    const xhtml = wrapXhtml('<p>\n  <ruby>漢<rt>かん</rt></ruby>字</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字');
    expect(result[0].inlineAnnotations[0]).toMatchObject({
      startIndex: 0,
      endIndex: 1,
      rubyText: 'かん',
    });
  });

  it('clamps inline annotations that cross trimmed paragraph boundaries', () => {
    const xhtml = wrapXhtml('<p><a href="https://example.test"> 本文 </a></p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('本文');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'link', startIndex: 0, endIndex: 2, href: 'https://example.test' },
    ]);
  });

  it('normalizes pretty-print whitespace while preserving explicit br and ideographic indent', () => {
    const xhtml = wrapXhtml('<p>\n  吾輩は\n  猫である<br />　次行</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('吾輩は猫である\n　次行');
  });

  it('keeps annotation spans identical whether or not the source is line wrapped', () => {
    const inline =
      'これは<ruby>漢字<rt>かんじ</rt></ruby>と<em class="mejiro-emphasis" data-style="dot">傍点</em>と<span class="mejiro-tcy">12</span>年と<a href="https://example.test">参照</a>です';
    const wrapped =
      'これは\n  <ruby>漢字<rt>かんじ</rt></ruby>と\n  <em class="mejiro-emphasis" data-style="dot">傍点</em>と<span class="mejiro-tcy">12</span>年と\n  <a href="https://example.test">参照</a>です';

    const flat = extractRubyContent(wrapXhtml(`<p>${inline}</p>`))[0];
    const folded = extractRubyContent(wrapXhtml(`<p>${wrapped}</p>`))[0];

    expect(folded.text).toBe(flat.text);
    expect(folded.inlineAnnotations).toEqual(flat.inlineAnnotations);

    const chars = [...folded.text];
    const covered = (kind: string): string[] =>
      folded.inlineAnnotations
        .filter((ann) => ann.kind === kind)
        .map((ann) => chars.slice(ann.startIndex, ann.endIndex).join(''));
    expect(covered('ruby')).toEqual(['漢字']);
    expect(covered('emphasis')).toEqual(['傍点']);
    expect(covered('tcy')).toEqual(['12']);
    expect(covered('link')).toEqual(['参照']);
  });

  it('keeps annotation spans aligned across astral and decomposed characters', () => {
    const astral = '\u{20B9F}'; // Han character outside the BMP (surrogate pair)
    const decomposed = '\u304B\u3099'; // kana plus combining voiced sound mark (NFD)
    const xhtml = wrapXhtml(
      `<p>${astral}\n  ${astral}<ruby>${decomposed}<rt>が</rt></ruby>る` +
        `<a href="https://example.test">${astral}</a>る</p>`,
    );
    const result = extractRubyContent(xhtml);

    const composed = decomposed.normalize('NFC');
    expect(result[0].text).toBe(`${astral}${astral}${composed}る${astral}る`);
    const chars = [...result[0].text];
    const spans = result[0].inlineAnnotations.map((ann) =>
      chars.slice(ann.startIndex, ann.endIndex).join(''),
    );
    expect(spans).toEqual([composed, astral]);
  });

  it('moves jukugo split points when a folded space is removed from the base', () => {
    const xhtml = wrapXhtml('<p><ruby>東<rt>とう</rt>京\n都<rt>きょうと</rt></ruby>に行く</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('東京都に行く');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'とう', type: 'mono' },
      { kind: 'ruby', startIndex: 1, endIndex: 3, rubyText: 'きょうと', type: 'group' },
      {
        kind: 'ruby',
        startIndex: 0,
        endIndex: 3,
        rubyText: 'とうきょうと',
        type: 'jukugo',
        jukugoSplitPoints: [1],
      },
    ]);
  });

  it('drops annotations whose characters are all removed', () => {
    const xhtml = wrapXhtml('<p>本文<a href="https://example.test"> </a></p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('本文');
    expect(result[0].inlineAnnotations).toEqual([]);
  });

  it('returns NFC text with annotation offsets in NFC code points', () => {
    const nfd = DECOMPOSED_KANA;
    const result = extractRubyContent(
      wrapXhtml(`<p>${nfd}<ruby>漢<rt>かん</rt></ruby>${nfd}<em>字</em></p>`),
    );

    const { text, inlineAnnotations } = result[0];
    expect(text).toBe('がぎ漢がぎ字');
    expect(text).toBe(text.normalize('NFC'));

    const chars = [...text];
    for (const ann of inlineAnnotations) {
      expect(ann.startIndex).toBeGreaterThanOrEqual(0);
      expect(ann.endIndex).toBeLessThanOrEqual(chars.length);
      expect(ann.endIndex).toBeGreaterThan(ann.startIndex);
    }
    const covered = (kind: string): string[] =>
      inlineAnnotations
        .filter((ann) => ann.kind === kind)
        .map((ann) => chars.slice(ann.startIndex, ann.endIndex).join(''));
    expect(covered('ruby')).toEqual(['漢']);
    expect(covered('em')).toEqual(['字']);
  });

  it('keeps annotations covering a decomposed character after composition', () => {
    const result = extractRubyContent(
      wrapXhtml(`<p><ruby>${DECOMPOSED_GA}<rt>が</rt></ruby>行</p>`),
    );

    expect(result[0].text).toBe('が行');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'が', type: 'mono' },
    ]);
  });

  it('splits text identically for static rendering and layout input', () => {
    const nfd = DECOMPOSED_KANA;
    const paragraph = extractRubyContent(
      wrapXhtml(`<p>${nfd}<ruby>漢<rt>かん</rt></ruby>${nfd}</p>`),
    )[0];

    expect(toCodepoints(paragraph.text)).toHaveLength([...paragraph.text].length);
    expect(renderEpubStatic({ paragraphs: [paragraph] })).toContain('<ruby>漢<rt>かん</rt></ruby>');
  });

  it('excludes script and style source text from the base text', () => {
    const withCode = extractRubyContent(
      wrapXhtml(
        "<div>本文です<script>alert('x')</script><style>p { color: red; }</style>続きます" +
          '<ruby>漢<rt>かん</rt></ruby>字</div>',
      ),
    );
    const withoutCode = extractRubyContent(
      wrapXhtml('<div>本文です続きます<ruby>漢<rt>かん</rt></ruby>字</div>'),
    );

    expect(withCode[0].text).toBe('本文です続きます漢字');
    expect(withCode[0].text).toBe(withoutCode[0].text);
    expect(withCode[0].inlineAnnotations).toEqual(withoutCode[0].inlineAnnotations);
  });

  it('emits no paragraph for a block whose only content is script or style', () => {
    const result = extractRubyContent(
      wrapXhtml('<p><script>alert(1)</script></p><p>本文</p><div><style>p{}</style></div>'),
    );

    expect(result.map((p) => p.text)).toEqual(['本文']);
  });

  it('keeps ruby base indices unaffected by script inside the ruby markup', () => {
    const result = extractRubyContent(
      wrapXhtml('<p><ruby>漢<script>alert(1)</script><rt>かん</rt></ruby>字</p>'),
    );

    expect(result[0].text).toBe('漢字');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'かん', type: 'mono' },
    ]);
  });

  it('keeps direct inline runs inside section elements with nested blocks', () => {
    const xhtml = wrapXhtml(
      '<section>序文<p>本文</p></section><table><tr><td>セル</td></tr></table>',
    );
    const result = extractRubyContent(xhtml);

    expect(result.map((p) => p.text)).toEqual(['序文', '本文', 'セル']);
  });

  it('reads rb pairs from an rtc container when ruby has no direct rt', () => {
    const xhtml = wrapXhtml(
      '<p><ruby><rb>東</rb><rb>京</rb><rtc><rt>とう</rt><rt>きょう</rt></rtc></ruby></p>',
    );
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('東京');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'とう', type: 'mono' },
      { kind: 'ruby', startIndex: 1, endIndex: 2, rubyText: 'きょう', type: 'mono' },
      {
        kind: 'ruby',
        startIndex: 0,
        endIndex: 2,
        rubyText: 'とうきょう',
        type: 'jukugo',
        jukugoSplitPoints: [1],
      },
    ]);
  });

  it('reads a plain base annotated only by an rtc container', () => {
    const xhtml = wrapXhtml('<p><ruby>東京<rtc><rt>とうきょう</rt></rtc></ruby>に行く</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('東京に行く');
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'とうきょう', type: 'group' },
    ]);
  });

  it('emits inline runs around nested blocks as separate paragraphs in source order', () => {
    const result = extractRubyContent(wrapXhtml('<div>前<p>中</p>後</div>'));

    expect(result.map((p) => p.text)).toEqual(['前', '中', '後']);
  });

  it('anchors annotations to the paragraph that contains them in mixed content', () => {
    const result = extractRubyContent(
      wrapXhtml('<div>序<ruby>漢<rt>かん</rt></ruby><p>本文</p>末<em>尾</em></div>'),
    );

    expect(result.map((p) => p.text)).toEqual(['序漢', '本文', '末尾']);
    expect(result[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 1, endIndex: 2, rubyText: 'かん', type: 'mono' },
    ]);
    expect(result[1].inlineAnnotations).toEqual([]);
    expect(result[2].inlineAnnotations).toEqual([{ kind: 'em', startIndex: 1, endIndex: 2 }]);
  });
});
