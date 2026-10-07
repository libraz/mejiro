export { result };

// #region doc:clusters
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('ABCDE');
const advances = new Float32Array(5).fill(16);
// ABC grouped (cluster 0), DE grouped (cluster 1)
const clusterIds = new Uint32Array([0, 0, 0, 1, 1]);

const result = computeBreaks({
  text,
  advances,
  lineWidth: 48, // 3 chars fit
  clusterIds,
});
// Cannot break within cluster 0 (A-B or B-C) or cluster 1 (D-E).
// The only valid break is after index 2 (between C and D).
// result.breakPoints → [2]
// Line 1: ABC (48px), Line 2: DE (32px)
// #endregion doc:clusters
