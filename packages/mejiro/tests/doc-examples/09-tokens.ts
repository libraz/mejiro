// #region doc:tokens
import { computeBreaks, toCodepoints, tokenLengthsToBoundaries } from '@libraz/mejiro';

// Input: "新しいプログラミング言語" tokenized as:
// ["新しい" (3), "プログラミング" (7), "言語" (2)]
const boundaries = tokenLengthsToBoundaries([3, 7, 2]);
// boundaries → Uint32Array [2, 9]  (prefer breaks after index 2 and 9)

const text = toCodepoints('新しいプログラミング言語');
const result = computeBreaks({
  text,
  advances: new Float32Array(text.length).fill(16),
  lineWidth: 80,
  tokenBoundaries: boundaries,
});
// #endregion doc:tokens

/** The array form, printed right after the example above. */
export function withArray(text: Uint32Array, advances: Float32Array) {
  // #region doc:token-array
  computeBreaks({
    text,
    advances,
    lineWidth: 80,
    tokenBoundaries: [2, 9], // readonly number[] also accepted
  });
  // #endregion doc:token-array
}

export { result };
