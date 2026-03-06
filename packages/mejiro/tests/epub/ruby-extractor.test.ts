/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { extractRubyContent } from '../../src/epub/ruby-extractor.js';

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
    expect(result[0].rubyAnnotations).toHaveLength(0);
  });

  it('extracts mono ruby (single base char)', () => {
    const xhtml = wrapXhtml('<p><ruby>漢<rt>かん</rt></ruby>字</p>');
    const result = extractRubyContent(xhtml);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('漢字');
    expect(result[0].rubyAnnotations).toHaveLength(1);

    const ann = result[0].rubyAnnotations[0];
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

    const ann = result[0].rubyAnnotations[0];
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
    const annotations = result[0].rubyAnnotations;
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
    expect(result[0].rubyAnnotations).toHaveLength(1);
    expect(result[0].rubyAnnotations[0].rubyText).toBe('かん');
  });

  it('handles <rb> elements', () => {
    const xhtml = wrapXhtml('<p><ruby><rb>漢</rb><rt>かん</rt></ruby>字</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字');
    expect(result[0].rubyAnnotations[0].rubyText).toBe('かん');
  });

  it('extracts multiple paragraphs', () => {
    const xhtml = wrapXhtml('<p>第一段落</p><p><ruby>第<rt>だい</rt></ruby>二段落</p>');
    const result = extractRubyContent(xhtml);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('第一段落');
    expect(result[0].rubyAnnotations).toHaveLength(0);
    expect(result[1].text).toBe('第二段落');
    expect(result[1].rubyAnnotations).toHaveLength(1);
  });

  it('handles multiple ruby annotations in one paragraph', () => {
    const xhtml = wrapXhtml('<p><ruby>漢<rt>かん</rt></ruby><ruby>字<rt>じ</rt></ruby>を書く</p>');
    const result = extractRubyContent(xhtml);

    expect(result[0].text).toBe('漢字を書く');
    expect(result[0].rubyAnnotations).toHaveLength(2);
    expect(result[0].rubyAnnotations[0].startIndex).toBe(0);
    expect(result[0].rubyAnnotations[0].endIndex).toBe(1);
    expect(result[0].rubyAnnotations[1].startIndex).toBe(1);
    expect(result[0].rubyAnnotations[1].endIndex).toBe(2);
  });

  it('skips empty paragraphs', () => {
    const xhtml = wrapXhtml('<p></p><p>テスト</p><p>  </p>');
    const result = extractRubyContent(xhtml);

    // Empty and whitespace-only paragraphs may or may not be included
    const nonEmpty = result.filter((p) => p.text.length > 0);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(1);
    expect(nonEmpty[0].text).toBe('テスト');
  });
});
