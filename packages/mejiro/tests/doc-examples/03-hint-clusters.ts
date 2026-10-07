export { hinted, plain };

// #region doc:hint-clusters
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえ12人'); // 7 chars
const advances = new Float32Array(7).fill(16);

// Character classes alone: the nearest valid position wins, splitting 12.
const plain = computeBreaks({ text, advances, lineWidth: 80 });
// plain.breakPoints → [4]
// Line 1: あいうえ1, Line 2: 2人

// With the hint clusters for 12人, that position is no longer available.
const hinted = computeBreaks({
  text,
  advances,
  lineWidth: 80,
  clusterIds: new Uint32Array([0, 1, 2, 3, 4, 4, 4]),
});
// hinted.breakPoints → [3]
// Line 1: あいうえ, Line 2: 12人
// #endregion doc:hint-clusters
