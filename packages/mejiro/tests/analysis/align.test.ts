import { describe, expect, it } from 'vitest';
import { alignMorphemeOffsets } from '../../src/analysis/align.js';
import type { MorphemeLike } from '../../src/types.js';

// The sequences below are spelled out by code point because each is visually
// identical to its composed or full-width counterpart, or invisible altogether,
// and that difference is exactly what these cases are about.

/** ZERO WIDTH SPACE, a format control the normalizer removes outright. */
const ZWSP = String.fromCodePoint(0x200b);
/** ZERO WIDTH NO-BREAK SPACE, which suzume keeps when preserving symbols. */
const BOM = String.fromCodePoint(0xfeff);
/** Hiragana KA followed by the combining voiced sound mark, composing into GA. */
const KA_PLUS_DAKUTEN = String.fromCodePoint(0x304b, 0x3099);
/** Half-width katakana KA followed by the half-width voiced sound mark. */
const HALFWIDTH_GA = String.fromCodePoint(0xff76, 0xff9e);

/** Builds a morpheme with the fields the aligner moves, leaving the rest inert. */
function morpheme(surface: string, start: number, end: number): MorphemeLike {
  return { surface, start, end, pos: 'NOUN', extendedPos: 'NOUN' };
}

/** Aligns and fails the test rather than returning null, for the success cases. */
function align(text: string, normalizedText: string, morphemes: readonly MorphemeLike[]) {
  const aligned = alignMorphemeOffsets(text, normalizedText, morphemes);
  if (aligned === null) throw new Error('expected the offsets to align');
  return aligned;
}

/** Extracts the code points `[start, end)` addresses, the way a caller would. */
function span(text: string, morphemeLike: MorphemeLike): string {
  return [...text].slice(morphemeLike.start, morphemeLike.end).join('');
}

/** Every morpheme's span as a `[start, end]` pair, for compact assertions. */
function offsets(morphemes: readonly MorphemeLike[]): number[][] {
  return morphemes.map((m) => [m.start, m.end]);
}

describe('alignMorphemeOffsets', () => {
  it('returns the morphemes untouched when nothing was removed', () => {
    const text = '今日は良い天気です';
    const input = [morpheme('今日', 0, 2), morpheme('は', 2, 3), morpheme('良い', 3, 5)];

    const aligned = align(text, text, input);

    expect(aligned.morphemes).toEqual(input);
    expect(aligned.warnings).toEqual([]);
  });

  it('stays on the identity path through a same-length width fold', () => {
    const text = 'Ａ社の件';
    const input = [morpheme('A社', 0, 2), morpheme('の', 2, 3), morpheme('件', 3, 4)];

    const aligned = align(text, 'A社の件', input);

    expect(aligned.morphemes).toEqual(input);
    expect(aligned.warnings).toEqual([]);
    expect(span(text, aligned.morphemes[0])).toBe('Ａ社');
  });

  it('skips a removed zero-width space', () => {
    const text = `吾輩${ZWSP}は猫`;
    const input = [morpheme('吾輩', 0, 2), morpheme('は', 2, 3), morpheme('猫', 3, 4)];

    const aligned = align(text, '吾輩は猫', input);

    expect(offsets(aligned.morphemes)).toEqual([
      [0, 2],
      [3, 4],
      [4, 5],
    ]);
    expect(aligned.morphemes.map((m) => span(text, m))).toEqual(['吾輩', 'は', '猫']);
    expect(aligned.warnings).toEqual([]);
  });

  it('widens a span over a kana composed with a combining dakuten', () => {
    const text = `${KA_PLUS_DAKUTEN}つお`;
    const input = [morpheme('が', 0, 1), morpheme('つお', 1, 3)];

    const aligned = align(text, 'がつお', input);

    expect(offsets(aligned.morphemes)).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(span(text, aligned.morphemes[0])).toBe(KA_PLUS_DAKUTEN);
    expect(span(text, aligned.morphemes[1])).toBe('つお');
  });

  it('widens a span over half-width katakana composed with its sound mark', () => {
    const text = `${HALFWIDTH_GA}ラス`;
    const input = [morpheme('ガラス', 0, 3)];

    const aligned = align(text, 'ガラス', input);

    expect(offsets(aligned.morphemes)).toEqual([[0, 4]]);
    expect(span(text, aligned.morphemes[0])).toBe(text);
  });

  it('skips the surplus marks of a collapsed prolonged sound mark run', () => {
    const text = 'ラーーー漢';
    const input = [morpheme('ラー', 0, 2), morpheme('漢', 2, 3)];

    const aligned = align(text, 'ラー漢', input);

    expect(offsets(aligned.morphemes)).toEqual([
      [0, 2],
      [4, 5],
    ]);
    expect(aligned.morphemes.map((m) => span(text, m))).toEqual(['ラー', '漢']);
  });

  it('reconciles all three shortenings in one text', () => {
    const text = `猫${ZWSP}は${KA_PLUS_DAKUTEN}ラーーー漢`;
    const input = [
      morpheme('猫', 0, 1),
      morpheme('は', 1, 2),
      morpheme('がラー', 2, 5),
      morpheme('漢', 5, 6),
    ];

    const aligned = align(text, '猫はがラー漢', input);

    expect(aligned.morphemes.map((m) => span(text, m))).toEqual([
      '猫',
      'は',
      `${KA_PLUS_DAKUTEN}ラー`,
      '漢',
    ]);
    expect(aligned.warnings).toEqual([]);
  });

  it('drops a span the walk shifted onto other characters', () => {
    // The walk cannot know that 猫 was removed, so it reads it as a substitution
    // for the zero-width space and pays for it by removing the real zero-width
    // space further on. Both strings are consumed exactly, so nothing about the
    // lengths gives the error away: the zero-width space's span now sits on 猫,
    // and it is the same single character wide it should have been.
    const text = `あ猫${ZWSP}い`;
    const input = [morpheme('あ', 0, 1), morpheme(ZWSP, 1, 2), morpheme('い', 2, 3)];

    const aligned = align(text, `あ${ZWSP}い`, input);

    expect(aligned.morphemes.map((m) => m.surface)).toEqual(['あ', 'い']);
    expect(aligned.warnings).toHaveLength(1);
    expect(aligned.morphemes.map((m) => span(text, m))).toEqual(['あ', 'い']);
  });

  it('keeps a format control the normalizer left in place', () => {
    // The verification must not read every removable character as removed: this
    // one survived normalization and carries a morpheme of its own.
    const text = `猫${BOM}だ${ZWSP}ね`;
    const input = [
      morpheme('猫', 0, 1),
      morpheme(BOM, 1, 2),
      morpheme('だ', 2, 3),
      morpheme('ね', 3, 4),
    ];

    const aligned = align(text, `猫${BOM}だね`, input);

    expect(aligned.warnings).toEqual([]);
    expect(aligned.morphemes.map((m) => span(text, m))).toEqual(['猫', BOM, 'だ', 'ね']);
  });

  it('returns null when the two strings cannot be reconciled', () => {
    expect(alignMorphemeOffsets('あいう', 'あ', [morpheme('あ', 0, 1)])).toBeNull();
    expect(alignMorphemeOffsets('あ', 'あいうえお', [morpheme('あ', 0, 1)])).toBeNull();
  });

  it('drops morphemes whose offsets fall outside the text and says so', () => {
    const text = '猫';

    const aligned = align(text, text, [morpheme('猫', 0, 1), morpheme('犬', 1, 4)]);

    expect(aligned.morphemes).toEqual([morpheme('猫', 0, 1)]);
    expect(aligned.warnings).toHaveLength(1);
    expect(aligned.warnings[0]).toContain('1');
  });

  it('drops morphemes indexed outside the normalized text', () => {
    const aligned = align(`猫${ZWSP}だ`, '猫だ', [morpheme('猫', 0, 1), morpheme('だ', 2, 9)]);

    expect(offsets(aligned.morphemes)).toEqual([[0, 1]]);
    expect(aligned.warnings).toHaveLength(1);
  });
});
