export { lines };

// #region doc:headless
import { computeBreaks, getLineRanges, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // 16px per character

const result = computeBreaks({
  text,
  advances,
  lineWidth: 128, // 8 characters per line
});

const lines = getLineRanges(result.breakPoints, text.length);
// lines: [[0, 8], [8, 16]]
// #endregion doc:headless
