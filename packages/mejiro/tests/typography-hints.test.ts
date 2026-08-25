import { describe, expect, it } from 'vitest';
import type { MorphemeLike, TextAnalysis, TypographyHintOptions } from '../src/types.js';
import {
  DEFAULT_KEEP_WHOLE_POS,
  deriveTypographyHints,
  mergeClusterIds,
} from '../src/typography-hints.js';

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

/**
 * Break penalties of `text`, as a plain array.
 *
 * `penalties` is fixed on, this being the hint the helper exists to read; the
 * keep-whole settings are left open because they are what changes the values.
 */
function penaltiesOf(
  text: string,
  tokens: readonly Token[],
  options: Omit<TypographyHintOptions, 'penalties'> = {},
): number[] {
  const hints = deriveTypographyHints(text, analyze(text, tokens), { ...options, penalties: true });
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

/** Code point length of the keep-whole word a case uses. */
type KeepWholeLength = 1 | 2 | 4;

/**
 * One keep-whole word per length: a pronoun with no interior at all, an adverb
 * with a single interior position and a conjunction with several. All three
 * belong to a part of speech the default list names, and each carries an
 * extended code distinct from its coarse one, so a case can select the same word
 * through either field.
 */
const KEEP_WHOLE_WORDS: Record<KeepWholeLength, Token> = {
  1: ['彼', 'PRON_人称'],
  2: ['やや', 'ADV_程度'],
  4: ['そのため', 'CONJ_順接'],
};

/**
 * The frame every keep-whole case puts after its word. Holding it fixed leaves
 * the word's own interior as the only part of the array a case can move, so a
 * row that differs elsewhere is reporting a rule reaching further than it should.
 */
const KEEP_WHOLE_FRAME: readonly Token[] = [
  ['本', 'NOUN_普通名詞'],
  ['を', 'PART_格助詞'],
  ['読む', 'VERB_一般'],
];

/** One row of the keep-whole covering array: the inputs, and what they produce. */
interface KeepWholeCase {
  /**
   * Which list reaches `keepWholePos`: the default, one naming the word's
   * extended code, one naming its coarse code, or none at all.
   */
  pos: 'default' | 'custom' | 'coarse' | 'empty';
  /**
   * Which value reaches `keepWholePenalty`: the default, an ordinary one, one
   * past the range the array holds, or one that is not a number.
   */
  penalty: 'default' | 'explicit' | 'clamped' | 'nonFinite';
  /** Code point length of the word, which decides how much interior there is to price. */
  length: KeepWholeLength;
  /** Whether penalties are asked for at all. */
  penalties: boolean;
  /** The whole `breakPenalties` array, or `undefined` when none is emitted. */
  expected: number[] | undefined;
}

/** The case's word followed by the frame, as the text and the tokens describing it. */
function keepWholeFixture(length: KeepWholeLength): { text: string; tokens: readonly Token[] } {
  const tokens: readonly Token[] = [KEEP_WHOLE_WORDS[length], ...KEEP_WHOLE_FRAME];
  return { text: tokens.map(([surface]) => surface).join(''), tokens };
}

/**
 * Turns a case's parameter values into the options they stand for. `undefined`
 * is what an omitted field looks like to the module, so the default cases pass
 * it rather than reaching for the value they expect back.
 */
function keepWholeOptions(testCase: KeepWholeCase): TypographyHintOptions {
  const extendedPos = KEEP_WHOLE_WORDS[testCase.length][1];
  const lists: Record<KeepWholeCase['pos'], readonly string[] | undefined> = {
    default: undefined,
    custom: [extendedPos],
    coarse: [extendedPos.split('_')[0]],
    empty: [],
  };
  const penalties: Record<KeepWholeCase['penalty'], number | undefined> = {
    default: undefined,
    explicit: 7,
    clamped: 300,
    nonFinite: Number.NaN,
  };
  return {
    penalties: testCase.penalties,
    keepWholePos: lists[testCase.pos],
    keepWholePenalty: penalties[testCase.penalty],
  };
}

/**
 * An all-pairs covering array over the four inputs that decide what the
 * keep-whole rule writes: which list selects the word, what the interior is
 * priced at, how much interior the word has, and whether penalties are emitted
 * at all. Every pair of values drawn from two different inputs appears in some
 * row, which is the interaction a rule can get wrong; the full product of the
 * four only repeats those pairs.
 */
const KEEP_WHOLE_CASES: readonly KeepWholeCase[] = [
  { pos: 'default', penalty: 'default', length: 1, penalties: true, expected: [0, 3, 0, 2, 0] },
  { pos: 'default', penalty: 'explicit', length: 2, penalties: false, expected: undefined },
  {
    pos: 'default',
    penalty: 'clamped',
    length: 4,
    penalties: true,
    expected: [255, 255, 255, 0, 3, 0, 2, 0],
  },
  { pos: 'default', penalty: 'nonFinite', length: 1, penalties: false, expected: undefined },
  { pos: 'custom', penalty: 'default', length: 2, penalties: true, expected: [4, 0, 3, 0, 2, 0] },
  { pos: 'custom', penalty: 'explicit', length: 1, penalties: true, expected: [0, 3, 0, 2, 0] },
  { pos: 'custom', penalty: 'clamped', length: 1, penalties: false, expected: undefined },
  {
    pos: 'custom',
    penalty: 'nonFinite',
    length: 4,
    penalties: true,
    expected: [4, 4, 4, 0, 3, 0, 2, 0],
  },
  { pos: 'coarse', penalty: 'default', length: 4, penalties: false, expected: undefined },
  { pos: 'coarse', penalty: 'explicit', length: 1, penalties: true, expected: [0, 3, 0, 2, 0] },
  { pos: 'coarse', penalty: 'clamped', length: 2, penalties: true, expected: [255, 0, 3, 0, 2, 0] },
  { pos: 'coarse', penalty: 'nonFinite', length: 2, penalties: true, expected: [4, 0, 3, 0, 2, 0] },
  { pos: 'empty', penalty: 'default', length: 1, penalties: true, expected: [0, 3, 0, 2, 0] },
  { pos: 'empty', penalty: 'explicit', length: 4, penalties: false, expected: undefined },
  { pos: 'empty', penalty: 'clamped', length: 2, penalties: true, expected: [2, 0, 3, 0, 2, 0] },
  { pos: 'empty', penalty: 'nonFinite', length: 1, penalties: true, expected: [0, 3, 0, 2, 0] },
];

/** A three code point conjunction the default list selects, ahead of the usual frame. */
const CONJUNCTION_TEXT = 'しかし本を読む';
/** The morphemes of {@link CONJUNCTION_TEXT}. */
const CONJUNCTION_TOKENS: readonly Token[] = [['しかし', 'CONJ_逆接'], ...KEEP_WHOLE_FRAME];

describe('deriveTypographyHints — keeping a word whole', () => {
  it.each(KEEP_WHOLE_CASES)(
    '$pos list, $penalty penalty, $length-code-point word, penalties $penalties',
    (testCase) => {
      const { text, tokens } = keepWholeFixture(testCase.length);
      const hints = deriveTypographyHints(text, analyze(text, tokens), keepWholeOptions(testCase));
      expect(hints.breakPenalties ? [...hints.breakPenalties] : undefined).toEqual(
        testCase.expected,
      );
    },
  );

  it('reaches nothing at all while penalties are off', () => {
    const { text, tokens } = keepWholeFixture(4);
    const hints = deriveTypographyHints(text, analyze(text, tokens), {
      keepWholePos: ['CONJ'],
      keepWholePenalty: 200,
    });
    // The fixture trips no cluster rule either, so a keep-whole setting that
    // leaked into any other hint would show up as a field on this object.
    expect(hints).toEqual({});
  });

  it('writes nothing for a word with no interior', () => {
    const { text, tokens } = keepWholeFixture(1);
    // 彼 occupies one position, which is also the position it ends on, and a
    // morpheme's last position belongs to the bunsetsu rule. However the word is
    // priced, the array is the one an empty list produces.
    expect(penaltiesOf(text, tokens, { keepWholePenalty: 200 })).toEqual([0, 3, 0, 2, 0]);
    expect(penaltiesOf(text, tokens, { keepWholePos: [] })).toEqual([0, 3, 0, 2, 0]);
  });

  it('raises the interior of a conjunction but not the position it ends on', () => {
    // しかし | 本 — index 2 closes the conjunction and a bunsetsu with it, so it keeps
    // the 0 that rule gave it: that position is where a break escaping the word
    // lands, and pricing it as interior would leave the search nowhere to go.
    expect(penaltiesOf(CONJUNCTION_TEXT, CONJUNCTION_TOKENS)).toEqual([4, 4, 0, 3, 0, 2, 0]);
  });

  it('leaves the interior at the ordinary value when the list is empty', () => {
    // The whole array a caller saw before there was a keep-whole rule at all.
    expect(penaltiesOf(CONJUNCTION_TEXT, CONJUNCTION_TOKENS, { keepWholePos: [] })).toEqual([
      2, 2, 0, 3, 0, 2, 0,
    ]);
  });

  it('saturates a penalty larger than the array can hold', () => {
    // 255 is the ceiling of the `Uint8Array` the penalties travel in. A value
    // that wrapped instead of saturating would land back among the values the
    // structural rules use, and read as a position the search should prefer.
    expect(penaltiesOf(CONJUNCTION_TEXT, CONJUNCTION_TOKENS, { keepWholePenalty: 300 })).toEqual([
      255, 255, 0, 3, 0, 2, 0,
    ]);
  });

  it('floors a negative penalty at zero', () => {
    // Zero is the value a bunsetsu boundary carries, so asking for less than
    // nothing does not switch the rule off — it makes the interior of the word
    // the position the cost search likes best. `[]` is how the rule is switched
    // off.
    expect(penaltiesOf(CONJUNCTION_TEXT, CONJUNCTION_TOKENS, { keepWholePenalty: -3 })).toEqual([
      0, 0, 0, 3, 0, 2, 0,
    ]);
  });

  it('rounds a fractional penalty', () => {
    expect(penaltiesOf(CONJUNCTION_TEXT, CONJUNCTION_TOKENS, { keepWholePenalty: 2.6 })).toEqual([
      3, 3, 0, 3, 0, 2, 0,
    ]);
  });

  it('falls back to the default penalty for a value that is not a number', () => {
    expect(
      penaltiesOf(CONJUNCTION_TEXT, CONJUNCTION_TOKENS, { keepWholePenalty: Number.NaN }),
    ).toEqual([4, 4, 0, 3, 0, 2, 0]);
  });

  it('selects a word by its coarse code as well as by its extended one', () => {
    const { text, tokens } = keepWholeFixture(2);
    // やや is tagged ADV_程度 over ADV, so a caller naming the family gets every
    // adverb and a caller naming the class gets just that one.
    expect(penaltiesOf(text, tokens, { keepWholePos: ['ADV'] })).toEqual([4, 0, 3, 0, 2, 0]);
    expect(penaltiesOf(text, tokens, { keepWholePos: ['ADV_程度'] })).toEqual([4, 0, 3, 0, 2, 0]);
    // A sibling class names a different set of adverbs and selects nothing here.
    expect(penaltiesOf(text, tokens, { keepWholePos: ['ADV_状態'] })).toEqual([2, 0, 3, 0, 2, 0]);
  });

  it('extends the default list when the caller spreads it', () => {
    // しかし | 書物 — the conjunction is kept whole either way; spreading the
    // default and adding common nouns prices the interior of 書物 too, which is
    // how the documented "extend rather than replace" use is written.
    const text = 'しかし書物を読む';
    const tokens: readonly Token[] = [
      ['しかし', 'CONJ_逆接'],
      ['書物', 'NOUN_普通名詞'],
      ['を', 'PART_格助詞'],
      ['読む', 'VERB_一般'],
    ];
    expect(penaltiesOf(text, tokens)).toEqual([4, 4, 0, 2, 3, 0, 2, 0]);
    expect(
      penaltiesOf(text, tokens, {
        keepWholePos: [...DEFAULT_KEEP_WHOLE_POS, 'NOUN_普通名詞'],
      }),
    ).toEqual([4, 4, 0, 4, 3, 0, 2, 0]);
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
