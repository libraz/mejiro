export { loose, strict };

// #region doc:modes
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえおっかきくけこ');
const advances = new Float32Array(11).fill(16);

// Strict mode: っ (small tsu) is prohibited at line start.
// The naive break after index 4 (あいうえお) would put っ at the start of line 2.
// The algorithm backtracks to index 3 to avoid this.
const strict = computeBreaks({ text, advances, lineWidth: 80, mode: 'strict' });
// strict.breakPoints → [3, 8]
// Line 1: あいうえ (4 chars), Line 2 starts with おっ...

// Loose mode: っ is allowed at line start.
// The break can stay at index 4.
const loose = computeBreaks({ text, advances, lineWidth: 80, mode: 'loose' });
// loose.breakPoints → [4, 9]
// Line 1: あいうえお (5 chars), Line 2 starts with っか...
// #endregion doc:modes
