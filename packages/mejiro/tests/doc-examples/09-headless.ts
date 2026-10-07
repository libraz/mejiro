export { pages };

// #region doc:headless
import { computeBreaks, getLineRanges, paginate, toCodepoints } from '@libraz/mejiro';

// You must provide advance widths yourself (no Canvas available)
const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // Fixed-width assumption

const result = computeBreaks({ text, advances, lineWidth: 128 });
const lines = getLineRanges(result.breakPoints, text.length);
const pages = paginate(400, [{ lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 }]);

// #endregion doc:headless
