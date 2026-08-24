import { computeBreaks, type LayoutInput, toCodepoints } from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { uniformAdvances } from './helpers.js';

/** Advance width every character in these fixtures is measured at. */
const CHAR_WIDTH = 16;

/**
 * Builds a penalty array of `length` entries with the given positions set.
 *
 * @param length - Number of code points in the paragraph.
 * @param entries - Penalty value per position; every other position is 0.
 */
function penalties(length: number, entries: Record<number, number>): Uint8Array {
  const values = new Uint8Array(length);
  for (const [pos, value] of Object.entries(entries)) {
    values[Number(pos)] = value;
  }
  return values;
}

/** Lays out `text` at a uniform advance, with whatever extra input is given. */
function layout(text: string, lineChars: number, extra: Partial<LayoutInput> = {}) {
  const codepoints = toCodepoints(text);
  return computeBreaks({
    text: codepoints,
    advances: uniformAdvances(codepoints.length, CHAR_WIDTH),
    lineWidth: lineChars * CHAR_WIDTH,
    ...extra,
  });
}

// With a uniform 16 px advance and a six-character line, a break after position
// p on the first line leaves (5 - p) em, so at the default weights
// cost(p) = penalties[p] + 1.5 * (5 - p).
const SIX_CHAR_LINE = 6;
const TEN_KANA = 'あいうえおかきくけこ';

describe('cost-based break search', () => {
  it('skips a penalised position in favour of a cheaper one slightly earlier', () => {
    const plain = layout(TEN_KANA, SIX_CHAR_LINE);
    expect([...plain.breakPoints]).toEqual([5]);

    // cost(5) = 3 + 0 = 3 and cost(4) = 0 + 1.5 = 1.5, and no position further
    // back comes near that: cost(3) = 3, cost(2) = 4.5, cost(1) = 6.
    const result = layout(TEN_KANA, SIX_CHAR_LINE, {
      breakPenalties: penalties(10, { 5: 3 }),
    });
    expect([...result.breakPoints]).toEqual([4]);
  });

  it('rejects an unpenalised position that leaves the line too short', () => {
    // cost(5) = 1 + 0 = 1 against cost(1) = 0 + 1.5 * 4 = 6, the cheapest
    // unpenalised position on the line: the near penalised position still wins.
    const result = layout(TEN_KANA, SIX_CHAR_LINE, {
      breakPenalties: penalties(10, { 2: 5, 3: 5, 4: 5, 5: 1 }),
    });
    expect([...result.breakPoints]).toEqual([5]);
  });

  it('resolves a tie towards the position that fills the line better', () => {
    // A penalty of 3 is worth exactly 2 em at the default weights, so
    // cost(5) = 3 + 0 and cost(3) = 0 + 1.5 * 2 are equal while the positions
    // between and before them are priced out (cost(4) = 9 + 1.5 = 10.5,
    // cost(2) = 9 + 4.5 = 13.5, cost(1) = 9 + 6 = 15). The walk runs downwards
    // from 5 and only replaces its choice on a strictly lower cost, so the tie
    // falls to the larger index.
    const result = layout(TEN_KANA, SIX_CHAR_LINE, {
      breakPenalties: penalties(10, { 1: 9, 2: 9, 4: 9, 5: 3 }),
    });
    expect([...result.breakPoints]).toEqual([5]);
  });

  it('bounds the walk back with maxBacktrackChars', () => {
    const breakPenalties = penalties(10, { 3: 5, 4: 5, 5: 5 });

    // cost(2) = 0 + 1.5 * 3 = 4.5 is the cheapest of the five positions the
    // default window of 6 reaches, all the way back to the start of the line:
    // cost(5) = 5, cost(4) = 6.5, cost(3) = 8, cost(1) = 6. The second line
    // starts at 3 and its window sees the unpenalised 8, which fills it.
    const unbounded = layout(TEN_KANA, SIX_CHAR_LINE, { breakPenalties });
    expect([...unbounded.breakPoints]).toEqual([2, 8]);

    // Two positions in, only 5 and 4 are ever costed, and cost(5) = 5 beats
    // cost(4) = 6.5. The remaining four characters need no second break.
    const bounded = layout(TEN_KANA, SIX_CHAR_LINE, {
      breakPenalties,
      breakCost: { maxBacktrackChars: 2 },
    });
    expect([...bounded.breakPoints]).toEqual([5]);
  });

  it('applies the configured weights and em size', () => {
    const breakPenalties = penalties(10, { 5: 3 });

    // Against a shortfall weight of 1, halving the penalty weight puts cost(5)
    // at 0.5 * 3 = 1.5 and cost(4) at 0 + 1 = 1, so a penalty of 3 is no longer
    // worth one em of shortfall. The shortfall weight is spelled out because
    // the default of 1.5 would price the two positions equally.
    expect([
      ...layout(TEN_KANA, SIX_CHAR_LINE, {
        breakPenalties,
        breakCost: { penaltyWeight: 0.5, shortfallWeight: 1 },
      }).breakPoints,
    ]).toEqual([4]);

    // Doubling the shortfall weight raises cost(4) to 0 + 2 = 2 against
    // cost(5) = 1.5 and hands the position back.
    expect([
      ...layout(TEN_KANA, SIX_CHAR_LINE, {
        breakPenalties,
        breakCost: { penaltyWeight: 0.5, shortfallWeight: 2 },
      }).breakPoints,
    ]).toEqual([5]);

    // Declaring a quarter-width em counts the one-character gap before 4 as
    // four em of shortfall, so cost(4) = 0 + 1.5 * 4 = 6 loses to cost(5) = 3
    // on the em size alone.
    expect([
      ...layout(TEN_KANA, SIX_CHAR_LINE, {
        breakPenalties,
        breakCost: { emSize: CHAR_WIDTH / 4 },
      }).breakPoints,
    ]).toEqual([5]);
  });

  it('decides on the ratio of the weights, not on their magnitude', () => {
    const breakPenalties = penalties(10, { 5: 2 });

    // Scaling both weights scales every cost, which cannot reorder them: at
    // (0.5, 1) cost(5) = 1 ties with cost(4) = 1, and at (1, 2) the same two
    // cost 2 apiece. Both take the tie at the larger index.
    for (const breakCost of [
      { penaltyWeight: 0.5, shortfallWeight: 1 },
      { penaltyWeight: 1, shortfallWeight: 2 },
    ]) {
      expect(
        [...layout(TEN_KANA, SIX_CHAR_LINE, { breakPenalties, breakCost }).breakPoints],
        `weights ${breakCost.penaltyWeight} / ${breakCost.shortfallWeight}`,
      ).toEqual([5]);
    }

    // The defaults hold a different ratio and so reach a different position:
    // cost(5) = 2 + 0 against cost(4) = 0 + 1.5.
    expect([...layout(TEN_KANA, SIX_CHAR_LINE, { breakPenalties }).breakPoints]).toEqual([4]);
  });

  it('supersedes token boundaries', () => {
    const tokenBoundaries = new Uint32Array([2]);

    const tokenised = layout(TEN_KANA, SIX_CHAR_LINE, { tokenBoundaries });
    expect([...tokenised.breakPoints]).toEqual([2, 8]);

    // cost(4) = 0 + 1.5 beats both the token edge at 2, which the cost search
    // prices at 0 + 4.5, and the penalised 5 at 3 + 0.
    const result = layout(TEN_KANA, SIX_CHAR_LINE, {
      tokenBoundaries,
      breakPenalties: penalties(10, { 5: 3 }),
    });
    expect([...result.breakPoints]).toEqual([4]);
  });
});

describe('cost-based search with no candidate in the window', () => {
  // Positions 4 through 11 are all followed by a small kana, which may not open
  // a line, so a twelve-character line overflowing at index 12 finds nothing in
  // the six positions the default window reaches, 11 down to 6. The only valid
  // position on the line is 3, further back than the window and reachable only
  // by the unbounded search.
  const text = 'あいうえおゃゃゃゃゃゃゃゃかきく';
  const twelveCharLine = 12;

  it('falls through to the unbounded search instead of force-breaking', () => {
    const result = layout(text, twelveCharLine, {
      breakPenalties: penalties(text.length, {}),
    });
    expect([...result.breakPoints]).toEqual([3]);
  });

  it('matches the position the same text breaks at without penalties', () => {
    const plain = layout(text, twelveCharLine);
    const costed = layout(text, twelveCharLine, {
      breakPenalties: penalties(text.length, {}),
    });
    expect([...costed.breakPoints]).toEqual([...plain.breakPoints]);
  });
});

describe('backward compatibility', () => {
  const paragraph =
    '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。' +
    '何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。';
  const twentyCharLine = 20;

  it('breaks an ordinary paragraph at the positions it has always used', () => {
    const result = layout(paragraph, twentyCharLine);
    expect([...result.breakPoints]).toEqual([19, 39, 59]);
  });

  it('is unaffected by an all-zero penalty array', () => {
    const plain = layout(paragraph, twentyCharLine);
    const costed = layout(paragraph, twentyCharLine, {
      breakPenalties: penalties(toCodepoints(paragraph).length, {}),
    });
    expect([...costed.breakPoints]).toEqual([...plain.breakPoints]);
    expect([...(costed.hangingAdjustments ?? [])]).toEqual([...(plain.hangingAdjustments ?? [])]);
  });

  it('accepts empty text carrying an empty penalty array', () => {
    const result = layout('', SIX_CHAR_LINE, { breakPenalties: new Uint8Array(0) });
    expect(result.breakPoints.length).toBe(0);
  });
});

describe('validation', () => {
  it('rejects a penalty array of the wrong length', () => {
    expect(() => layout(TEN_KANA, SIX_CHAR_LINE, { breakPenalties: new Uint8Array(9) })).toThrow(
      RangeError,
    );
    expect(() => layout(TEN_KANA, SIX_CHAR_LINE, { breakPenalties: new Uint8Array(9) })).toThrow(
      /breakPenalties length/u,
    );
  });

  it('rejects a negative or non-finite penaltyWeight', () => {
    expect(() => layout(TEN_KANA, SIX_CHAR_LINE, { breakCost: { penaltyWeight: -1 } })).toThrow(
      /penaltyWeight/u,
    );
    expect(() =>
      layout(TEN_KANA, SIX_CHAR_LINE, { breakCost: { penaltyWeight: Number.NaN } }),
    ).toThrow(/penaltyWeight/u);
  });

  it('rejects a negative or non-finite shortfallWeight', () => {
    expect(() => layout(TEN_KANA, SIX_CHAR_LINE, { breakCost: { shortfallWeight: -0.5 } })).toThrow(
      /shortfallWeight/u,
    );
    expect(() =>
      layout(TEN_KANA, SIX_CHAR_LINE, {
        breakCost: { shortfallWeight: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(/shortfallWeight/u);
  });

  it('rejects a maxBacktrackChars that is not a positive integer', () => {
    expect(() => layout(TEN_KANA, SIX_CHAR_LINE, { breakCost: { maxBacktrackChars: 0 } })).toThrow(
      /maxBacktrackChars/u,
    );
    expect(() =>
      layout(TEN_KANA, SIX_CHAR_LINE, { breakCost: { maxBacktrackChars: 2.5 } }),
    ).toThrow(/maxBacktrackChars/u);
    expect(() =>
      layout(TEN_KANA, SIX_CHAR_LINE, {
        breakCost: { maxBacktrackChars: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(/maxBacktrackChars/u);
  });

  it('rejects a non-positive emSize', () => {
    expect(() => layout(TEN_KANA, SIX_CHAR_LINE, { breakCost: { emSize: 0 } })).toThrow(/emSize/u);
    expect(() => layout(TEN_KANA, SIX_CHAR_LINE, { breakCost: { emSize: Number.NaN } })).toThrow(
      /emSize/u,
    );
  });

  it('accepts zero weights', () => {
    // A zero shortfall weight leaves the penalty alone to decide, and every
    // position on the line is unpenalised, so the first one costed wins.
    const result = layout(TEN_KANA, SIX_CHAR_LINE, {
      breakPenalties: penalties(10, {}),
      breakCost: { shortfallWeight: 0 },
    });
    expect([...result.breakPoints]).toEqual([5]);
  });
});
