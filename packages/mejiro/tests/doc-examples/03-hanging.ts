export { result };

// #region doc:hanging
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80, // 5 chars fit exactly
  enableHanging: true, // default
});
// The 、 at index 5 overflows but is allowed to hang.
// result.breakPoints → [5]
// result.hangingAdjustments → Float32Array [16, 0]
// Line 1: あいうえお、 (、 hangs 16px past the edge)
// Line 2: かきくけこ (no hang)
// #endregion doc:hanging

/** Hanging disabled, printed right after the example above. */
export function withoutHanging() {
  // #region doc:no-hanging
  const result = computeBreaks({
    text: toCodepoints('あいうえお、かきくけこ'),
    advances: new Float32Array(11).fill(16),
    lineWidth: 80,
    enableHanging: false,
  });
  // The 、 cannot hang, so it must start line 2 — but 、 is prohibited at line start,
  // so the backward search moves the break one position earlier.
  // result.breakPoints → [3, 8]
  // Line 1: あいうえ (4 chars)
  // Line 2: お、かきく
  // Line 3: けこ
  // #endregion doc:no-hanging
  return result;
}
