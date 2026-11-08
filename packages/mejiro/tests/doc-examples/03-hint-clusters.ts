export { hinted, plain };

// #region doc:hint-clusters
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいう12人'); // 6 chars
const advances = new Float32Array(6).fill(16);

// Character classes alone: the nearest valid position wins, tearing 人 off 12.
const plain = computeBreaks({ text, advances, lineWidth: 80 });
// plain.breakPoints → [4]
// Line 1: あいう12, Line 2: 人

// With the hint clusters for 12人, that position is no longer available.
const hinted = computeBreaks({
  text,
  advances,
  lineWidth: 80,
  clusterIds: new Uint32Array([0, 1, 2, 3, 3, 3]),
});
// hinted.breakPoints → [2]
// Line 1: あいう, Line 2: 12人
// #endregion doc:hint-clusters
