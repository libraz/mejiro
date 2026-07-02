import { describe, expect, it } from 'vitest';
import { parseManuscript } from '../src/manuscript.js';
import { tokenizeManuscriptSource } from '../src/manuscript-tokens.js';

describe('tokenizeManuscriptSource', () => {
  it('detects bar-notation ruby spans with correct source ranges', () => {
    const text = 'AB｜漢字《かんじ》CD';
    const tokens = tokenizeManuscriptSource(text);
    expect(tokens).toHaveLength(1);
    expect(text.slice(tokens[0].start, tokens[0].end)).toBe('｜漢字《かんじ》');
  });

  it('accepts half-width bar ruby notation', () => {
    const parsed = parseManuscript('これは|漢字《かんじ》です', { dialect: 'narou' });
    const tokens = tokenizeManuscriptSource('これは|漢字《かんじ》です', 'narou');

    expect(parsed.text).toBe('これは漢字です');
    expect(parsed.inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 3, endIndex: 5, rubyText: 'かんじ', type: 'group' },
    ]);
    expect(tokens.map((token) => token.kind)).toEqual(['ruby']);
  });

  it('detects auto-ruby spans (no leading bar)', () => {
    const text = '漢字《かんじ》です';
    const tokens = tokenizeManuscriptSource(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe('ruby');
    expect(text.slice(tokens[0].start, tokens[0].end)).toBe('漢字《かんじ》');
  });

  it('does not consume emphasis opening as auto-ruby text', () => {
    const text = '漢字《《かんじ》》です';
    const tokens = tokenizeManuscriptSource(text);
    const parsed = parseManuscript(text);

    expect(tokens.map((token) => token.kind)).toEqual(['emphasis']);
    expect(text.slice(tokens[0].start, tokens[0].end)).toBe('《《かんじ》》');
    expect(parsed.text).toBe('漢字かんじです');
    expect(parsed.inlineAnnotations).toEqual([
      { kind: 'emphasis', startIndex: 2, endIndex: 5, style: 'sesame' },
    ]);
  });

  it('detects emphasis / TCY / em / strong / link / footnote under mejiro dialect', () => {
    const kinds = tokenizeManuscriptSource(
      '《《圏点》》〔20〕*em***strong**[a](https://example.com)[[#n1]]',
    ).map((t) => t.kind);
    expect(kinds).toEqual(['emphasis', 'tcy', 'em', 'strong', 'link', 'footnote']);
  });

  it('omits mejiro-only tokens under the narou dialect', () => {
    const kinds = tokenizeManuscriptSource('《《圏点》》*em*', 'narou').map((t) => t.kind);
    expect(kinds).toEqual([]);
  });

  it('leaves degenerate emphasis and footnote markers as text', () => {
    const parsed = parseManuscript('a《《》》b[[#]]c');

    expect(parsed.text).toBe('a《《》》b[[#]]c');
    expect(parsed.inlineAnnotations).toEqual([]);
  });

  it('does not match manuscript markers across line breaks', () => {
    const source = '｜漢字\n《かんじ》 《《圏点\n》》 *em\n* [a]\n(https://example.test)';
    const parsed = parseManuscript(source);
    const tokens = tokenizeManuscriptSource(source);

    expect(parsed.text).toBe(source);
    expect(parsed.inlineAnnotations).toEqual([]);
    expect(tokens).toEqual([]);
  });

  it('normalizes parsed text to NFC', () => {
    const parsed = parseManuscript('か\u3099《《く》》');

    expect(parsed.text).toBe('がく');
    expect(parsed.inlineAnnotations).toEqual([
      { kind: 'emphasis', startIndex: 1, endIndex: 2, style: 'sesame' },
    ]);
  });

  it('tokenizes long plain text in linear time', () => {
    const text = 'あ'.repeat(80_000);
    const start = performance.now();
    const tokens = tokenizeManuscriptSource(text);
    const elapsed = performance.now() - start;

    expect(tokens).toEqual([]);
    expect(elapsed).toBeLessThan(500);
  });

  it('rejects unsafe markdown link targets', () => {
    const source = '[x](javascript:alert(1)) [y](https://example.test)';
    const parsed = parseManuscript(source);
    const tokens = tokenizeManuscriptSource(source);
    const linkStart = parsed.text.indexOf('y');

    expect(parsed.text).toBe('[x](javascript:alert(1)) y');
    expect(tokens.map((token) => token.kind)).toEqual(['link']);
    expect(source.slice(tokens[0].start, tokens[0].end)).toBe('[y](https://example.test)');
    expect(parsed.inlineAnnotations).toEqual([
      {
        kind: 'link',
        startIndex: linkStart,
        endIndex: linkStart + 1,
        href: 'https://example.test',
      },
    ]);
  });
});
