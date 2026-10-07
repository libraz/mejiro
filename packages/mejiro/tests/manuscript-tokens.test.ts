import { describe, expect, it } from 'vitest';
import { parseManuscript } from '../src/manuscript.js';
import { tokenizeManuscriptSource } from '../src/manuscript-tokens.js';
import { expectElapsedUnder } from './timing.js';

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
    expectElapsedUnder(elapsed, 500);
  });

  it('tokenizes text dense with unclosed markers in linear time', () => {
    const half = unclosedMarkerSource(320_000);
    const full = unclosedMarkerSource(640_000);

    const halfElapsed = fastestRun(() => tokenizeManuscriptSource(half));
    const fullElapsed = fastestRun(() => tokenizeManuscriptSource(full));

    expect(tokenizeManuscriptSource(full)).toEqual([]);
    expectElapsedUnder(fullElapsed, 500);
    // Quadratic scanning would roughly quadruple when the source doubles.
    expectElapsedUnder(fullElapsed, halfElapsed * 3 + 5);
  });

  it('scans a long base run without ruby in linear time', () => {
    const text = `${'漢'.repeat(2_000)}\n`.repeat(160);

    const elapsed = fastestRun(() => tokenizeManuscriptSource(text));

    expect(tokenizeManuscriptSource(text)).toEqual([]);
    expectElapsedUnder(elapsed, 500);
  });

  it('still matches markers on later lines after an unclosed marker', () => {
    const source = '[未対応\n*強調* [ラベル](https://example.test)';
    const tokens = tokenizeManuscriptSource(source);
    const parsed = parseManuscript(source);

    expect(tokens.map((token) => token.kind)).toEqual(['em', 'link']);
    expect(source.slice(tokens[1].start, tokens[1].end)).toBe('[ラベル](https://example.test)');
    expect(parsed.text).toBe('[未対応\n強調 ラベル');
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

/** Builds a source of about `bytes` characters whose markers never close. */
function unclosedMarkerSource(bytes: number): string {
  const line = `${'｜漢[い《う〔え'.repeat(8)}*お\n`;
  return line.repeat(Math.ceil(bytes / line.length));
}

/** Returns the fastest of a few runs, to keep timing noise out of the ratio. */
function fastestRun(run: () => unknown): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('parseManuscript normalization', () => {
  it('keeps CJK compatibility ideographs as written while composing kana', () => {
    // U+FA10 and U+2F83B are compatibility ideographs NFC would replace.
    const compat = '\uFA10';
    const supplement = '\u{2F83B}';
    const parsed = parseManuscript(`${compat}本《つかもと》と${supplement}とか\u3099`);

    expect(parsed.text).toBe(`${compat}本と${supplement}とが`);
    expect(parsed.inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'つかもと', type: 'group' },
    ]);
  });
});

describe('auto ruby with variation selectors', () => {
  const ivs = '\u{E0100}';

  it('keeps an IVS or standardized variation selector inside the base run', () => {
    const cases: Array<{
      source: string;
      text: string;
      start: number;
      end: number;
      token: string;
    }> = [
      // Selector inside the run.
      {
        source: `葛${ivs}城《かつらぎ》`,
        text: `葛${ivs}城`,
        start: 0,
        end: 3,
        token: `葛${ivs}城《かつらぎ》`,
      },
      // Run ending in an IVS-qualified kanji directly before the reading.
      {
        source: `あ辻${ivs}《つじ》`,
        text: `あ辻${ivs}`,
        start: 1,
        end: 3,
        token: `辻${ivs}《つじ》`,
      },
      {
        source: '神\uFE00社《じんじゃ》',
        text: '神\uFE00社',
        start: 0,
        end: 3,
        token: '神\uFE00社《じんじゃ》',
      },
      // A selector on a preceding non-Han character does not join the run.
      {
        source: '❤\uFE0F漢字《かんじ》',
        text: '❤\uFE0F漢字',
        start: 2,
        end: 4,
        token: '漢字《かんじ》',
      },
    ];
    for (const { source, text, start, end, token } of cases) {
      const parsed = parseManuscript(source);
      expect(parsed.text, source).toBe(text);
      expect(parsed.inlineAnnotations, source).toEqual([
        expect.objectContaining({ kind: 'ruby', startIndex: start, endIndex: end, type: 'group' }),
      ]);
      const tokens = tokenizeManuscriptSource(source);
      expect(
        tokens.map((t) => source.slice(t.start, t.end)),
        source,
      ).toEqual([token]);
    }
  });

  it('scans a long base run of IVS-qualified kanji without ruby in linear time', () => {
    const text = `${`漢${ivs}`.repeat(2_000)}\n`.repeat(80);
    const elapsed = fastestRun(() => tokenizeManuscriptSource(text));
    expect(tokenizeManuscriptSource(text)).toEqual([]);
    expectElapsedUnder(elapsed, 500);
  });
});

describe('parseManuscript cost and offsets', () => {
  it('keeps code point offsets across astral characters and dense annotations', () => {
    const parsed = parseManuscript('𠮟*強*〔12〕𩸽《ほっけ》');
    expect(parsed.text).toBe('𠮟強12𩸽');
    expect(parsed.inlineAnnotations).toEqual([
      { kind: 'em', startIndex: 1, endIndex: 2 },
      { kind: 'tcy', startIndex: 2, endIndex: 4 },
      { kind: 'ruby', startIndex: 4, endIndex: 5, rubyText: 'ほっけ', type: 'mono' },
    ]);
  });

  it('parses an annotation-dense paragraph in time linear in its length', () => {
    const half = '𠮟*強調*本文《ほんぶん》'.repeat(20_000);
    const full = half + half;

    const halfElapsed = fastestRun(() => parseManuscript(half));
    const fullElapsed = fastestRun(() => parseManuscript(full));

    const parsed = parseManuscript(full);
    expect(parsed.inlineAnnotations).toHaveLength(80_000);
    expect(parsed.inlineAnnotations.at(-1)).toMatchObject({
      startIndex: [...parsed.text].length - 2,
      endIndex: [...parsed.text].length,
    });
    // Recounting the output per annotation would roughly quadruple here.
    expectElapsedUnder(fullElapsed, halfElapsed * 3 + 5);
  });
});
