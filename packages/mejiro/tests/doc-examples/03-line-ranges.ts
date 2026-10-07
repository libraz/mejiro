export { lines };

// #region doc:line-ranges
import { computeBreaks, getLineRanges, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえおかきくけこさしすせそ'); // 15 chars
const advances = new Float32Array(15).fill(16);
const result = computeBreaks({ text, advances, lineWidth: 80 });
// result.breakPoints → Uint32Array [4, 9]

const lines = getLineRanges(result.breakPoints, text.length);
// lines → [[0, 5], [5, 10], [10, 15]]
// #endregion doc:line-ranges
