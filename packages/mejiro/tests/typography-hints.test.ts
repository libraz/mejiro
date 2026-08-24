import { describe, expect, it } from 'vitest';
import type { MorphemeLike, TextAnalysis } from '../src/types.js';
import { deriveTypographyHints, mergeClusterIds } from '../src/typography-hints.js';

/** One fixture morpheme: its surface and its extended part-of-speech code. */
type Token = readonly [surface: string, extendedPos: string];

/**
 * Builds a {@link TextAnalysis} by locating each surface in `text` in order.
 *
 * Fixtures are written by hand rather than produced by an analyzer: the module
 * under test is analyzer-agnostic, and the rules have to be pinned to the POS
 * codes and character classes they claim to read, not to a dictionary. Searching
 * forward for each surface lets a fixture leave gaps, which is how text with
 * spaces between morphemes is expressed.
 */
function analyze(text: string, tokens: readonly Token[]): TextAnalysis {
  const codepoints = [...text];
  const morphemes: MorphemeLike[] = [];
  let cursor = 0;

  for (const [surface, extendedPos] of tokens) {
    const length = [...surface].length;
    while (
      cursor < codepoints.length &&
      codepoints.slice(cursor, cursor + length).join('') !== surface
    ) {
      cursor++;
    }
    morphemes.push({
      surface,
      start: cursor,
      end: cursor + length,
      pos: extendedPos.split('_')[0],
      extendedPos,
    });
    cursor += length;
  }

  return {
    text,
    morphemes,
    analyzer: { name: 'fixture', version: '0' },
    warnings: [],
  };
}

/** Cluster IDs of `text` under the default options, as a plain array. */
function clustersOf(text: string, tokens: readonly Token[]): number[] | undefined {
  const hints = deriveTypographyHints(text, analyze(text, tokens));
  return hints.clusterIds ? [...hints.clusterIds] : undefined;
}

/** Break penalties of `text`, as a plain array. */
function penaltiesOf(text: string, tokens: readonly Token[]): number[] {
  const hints = deriveTypographyHints(text, analyze(text, tokens), { penalties: true });
  return [...(hints.breakPenalties as Uint8Array)];
}

describe('deriveTypographyHints — hard clusters', () => {
  it('binds a numeral to the counter that follows it', () => {
    expect(
      clustersOf('3人が来る', [
        ['3', 'NOUN_数'],
        ['人', 'SUFFIX'],
        ['が', 'PART_格助詞'],
        ['来る', 'VERB_一般'],
      ]),
    ).toEqual([0, 0, 2, 3, 4]);
  });

  it('leaves a numeral followed by a particle breakable', () => {
    expect(
      clustersOf('3と4', [
        ['3', 'NOUN_数'],
        ['と', 'PART_格助詞'],
        ['4', 'NOUN_数'],
      ]),
    ).toBeUndefined();
  });

  it('binds a prefix to the word it attaches to', () => {
    expect(
      clustersOf('お名前を', [
        ['お', 'PREFIX'],
        ['名前', 'NOUN_普通名詞'],
        ['を', 'PART_格助詞'],
      ]),
    ).toEqual([0, 0, 0, 3]);
  });

  it('leaves a prefix followed by a function word breakable', () => {
    expect(
      clustersOf('おが', [
        ['お', 'PREFIX'],
        ['が', 'PART_格助詞'],
      ]),
    ).toBeUndefined();
  });

  it('holds a full-width digit run together', () => {
    expect(clustersOf('１２３', [['１２３', 'NOUN_数']])).toEqual([0, 0, 0]);
  });

  it('holds a Latin word inside Japanese text together', () => {
    expect(
      clustersOf('Web技術', [
        ['Web', 'NOUN_普通名詞'],
        ['技術', 'NOUN_普通名詞'],
      ]),
    ).toEqual([0, 0, 0, 3, 4]);
  });

  it('leaves a katakana word breakable', () => {
    expect(
      clustersOf('カメラ技術', [
        ['カメラ', 'NOUN_普通名詞'],
        ['技術', 'NOUN_普通名詞'],
      ]),
    ).toBeUndefined();
  });

  it('merges overlapping rules into one cluster', () => {
    expect(
      clustersOf('第1章です', [
        ['第', 'PREFIX'],
        ['1', 'NOUN_数'],
        ['章', 'SUFFIX'],
        ['です', 'AUX_断定'],
      ]),
    ).toEqual([0, 0, 0, 3, 4]);
  });

  it('keeps two touching units apart', () => {
    expect(
      clustersOf('3人5歳', [
        ['3', 'NOUN_数'],
        ['人', 'SUFFIX'],
        ['5', 'NOUN_数'],
        ['歳', 'SUFFIX'],
      ]),
    ).toEqual([0, 0, 2, 2]);
  });

  it('clusters a digit run the analyzer could not tag', () => {
    expect(
      clustersOf('12月', [
        ['12', 'UNKNOWN'],
        ['月', 'SUFFIX'],
      ]),
    ).toEqual([0, 0, 0]);
  });

  it('does not cluster a numeral spelled without digits', () => {
    expect(
      clustersOf('一二三人', [
        ['一二三', 'NOUN_数'],
        ['人', 'SUFFIX'],
      ]),
    ).toBeUndefined();
  });

  it('drops a cluster wider than the cap', () => {
    const text = '1234567人';
    const tokens: readonly Token[] = [
      ['1234567', 'NOUN_数'],
      ['人', 'SUFFIX'],
    ];
    expect(clustersOf(text, tokens)).toBeUndefined();

    const raised = deriveTypographyHints(text, analyze(text, tokens), {
      maxHardClusterChars: 8,
    });
    expect([...(raised.clusterIds as Uint32Array)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('omits cluster IDs when clustering is switched off', () => {
    const text = '3人';
    const hints = deriveTypographyHints(
      text,
      analyze(text, [
        ['3', 'NOUN_数'],
        ['人', 'SUFFIX'],
      ]),
      { clusters: false },
    );
    expect(hints.clusterIds).toBeUndefined();
  });
});

describe('deriveTypographyHints — break penalties', () => {
  it('is absent unless requested', () => {
    const text = '犬が走る';
    const hints = deriveTypographyHints(
      text,
      analyze(text, [
        ['犬', 'NOUN_普通名詞'],
        ['が', 'PART_格助詞'],
        ['走る', 'VERB_一般'],
      ]),
    );
    expect(hints.breakPenalties).toBeUndefined();
  });

  it('rates a bunsetsu end, a morpheme interior and a base cut off its particle', () => {
    // 犬 | が || 走っ | た — breaking after が ends a bunsetsu, inside 走っ is a
    // plain mid-morpheme cut, and before が or た severs a base from its suffix.
    expect(
      penaltiesOf('犬が走った', [
        ['犬', 'NOUN_普通名詞'],
        ['が', 'PART_格助詞'],
        ['走っ', 'VERB_一般'],
        ['た', 'AUX_過去'],
      ]),
    ).toEqual([3, 0, 2, 3, 0]);
  });

  it('rates a morpheme boundary inside a bunsetsu below its end', () => {
    // The space keeps 本 off the position that precedes は, so the boundary after
    // 本 stays a plain morpheme boundary.
    expect(
      penaltiesOf('本 は', [
        ['本', 'NOUN_普通名詞'],
        ['は', 'PART_係助詞'],
      ]),
    ).toEqual([1, 3, 0]);
  });

  it('rates a space as a bunsetsu boundary', () => {
    expect(
      penaltiesOf('本 犬', [
        ['本', 'NOUN_普通名詞'],
        ['犬', 'NOUN_普通名詞'],
      ]),
    ).toEqual([0, 0, 0]);
  });

  it('lets the larger value win where a space precedes a function word', () => {
    // The space would rate 0 on its own; cutting は off its base rates 3.
    expect(
      penaltiesOf('本 は', [
        ['本', 'NOUN_普通名詞'],
        ['は', 'PART_係助詞'],
      ])[1],
    ).toBe(3);
  });
});

describe('deriveTypographyHints — token boundaries and tate-chu-yoko', () => {
  const text = '12と本';
  const tokens: readonly Token[] = [
    ['12', 'NOUN_数'],
    ['と', 'PART_格助詞'],
    ['本', 'NOUN_普通名詞'],
  ];

  it('leaves both off by default', () => {
    const hints = deriveTypographyHints(text, analyze(text, tokens));
    expect(hints.tokenBoundaries).toBeUndefined();
    expect(hints.tcyCandidates).toBeUndefined();
  });

  it('reports every morpheme end but the last on request', () => {
    const hints = deriveTypographyHints(text, analyze(text, tokens), { tokenBoundaries: true });
    expect([...(hints.tokenBoundaries as Uint32Array)]).toEqual([1, 2]);
  });

  it('proposes a free-standing two-digit number on request', () => {
    const hints = deriveTypographyHints(text, analyze(text, tokens), { tcy: true });
    expect(hints.tcyCandidates).toEqual([{ startIndex: 0, endIndex: 2 }]);
  });

  it('skips a two-digit number bound to a counter', () => {
    const bound = '12月';
    const hints = deriveTypographyHints(
      bound,
      analyze(bound, [
        ['12', 'NOUN_数'],
        ['月', 'SUFFIX'],
      ]),
      { tcy: true },
    );
    expect(hints.tcyCandidates).toBeUndefined();
  });

  it('skips a number that is not exactly two digits', () => {
    const long = '123と';
    const hints = deriveTypographyHints(
      long,
      analyze(long, [
        ['123', 'NOUN_数'],
        ['と', 'PART_格助詞'],
      ]),
      { tcy: true },
    );
    expect(hints.tcyCandidates).toBeUndefined();
  });
});

describe('deriveTypographyHints — misaligned analysis', () => {
  it('yields no hints when the analysis describes different text', () => {
    const hints = deriveTypographyHints(
      '3人が来る',
      analyze('3人', [
        ['3', 'NOUN_数'],
        ['人', 'SUFFIX'],
      ]),
      { penalties: true, tokenBoundaries: true, tcy: true },
    );
    expect(hints).toEqual({});
  });
});

describe('mergeClusterIds', () => {
  it('returns undefined when neither input is present', () => {
    expect(mergeClusterIds(3)).toBeUndefined();
  });

  it('copies the only input it is given', () => {
    const only = new Uint32Array([0, 0, 2]);
    const merged = mergeClusterIds(3, undefined, only);
    expect([...(merged as Uint32Array)]).toEqual([0, 0, 2]);
    expect(merged).not.toBe(only);
  });

  it('joins positions bound in either input, transitively', () => {
    const a = new Uint32Array([0, 0, 2, 3]);
    const b = new Uint32Array([0, 1, 1, 3]);
    expect([...(mergeClusterIds(4, a, b) as Uint32Array)]).toEqual([0, 0, 0, 3]);
  });

  it('keeps clusters that never meet apart', () => {
    const a = new Uint32Array([0, 0, 2, 3]);
    const b = new Uint32Array([0, 1, 2, 2]);
    expect([...(mergeClusterIds(4, a, b) as Uint32Array)]).toEqual([0, 0, 2, 2]);
  });

  it('ignores an input describing text of a different length', () => {
    const usable = new Uint32Array([0, 0, 2]);
    const other = new Uint32Array([0, 0]);
    expect([...(mergeClusterIds(3, other, usable) as Uint32Array)]).toEqual([0, 0, 2]);
    expect(mergeClusterIds(3, other, undefined)).toBeUndefined();
  });
});
