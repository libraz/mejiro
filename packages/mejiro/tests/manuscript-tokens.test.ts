import { describe, expect, it } from 'vitest';
import { tokenizeManuscriptSource } from '../src/manuscript-tokens.js';

describe('tokenizeManuscriptSource', () => {
  it('detects bar-notation ruby spans with correct source ranges', () => {
    const text = 'AB｜漢字《かんじ》CD';
    const tokens = tokenizeManuscriptSource(text);
    expect(tokens).toHaveLength(1);
    expect(text.slice(tokens[0].start, tokens[0].end)).toBe('｜漢字《かんじ》');
  });

  it('detects auto-ruby spans (no leading bar)', () => {
    const text = '漢字《かんじ》です';
    const tokens = tokenizeManuscriptSource(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe('ruby');
    expect(text.slice(tokens[0].start, tokens[0].end)).toBe('漢字《かんじ》');
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
});
