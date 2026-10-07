export { hinted, plain };

// #region doc:break-penalties
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('今日は良い天気ですね'); // 10 chars
const advances = new Float32Array(10).fill(16);

// Character classes alone: the line is filled as far as it goes, splitting 天気.
const plain = computeBreaks({ text, advances, lineWidth: 96 });
// plain.breakPoints → [5]
// Line 1: 今日は良い天, Line 2: 気ですね

// 今 日  は 良 い  天 気  で す  ね
const breakPenalties = new Uint8Array([2, 3, 0, 2, 0, 2, 3, 2, 3, 0]);

const hinted = computeBreaks({ text, advances, lineWidth: 96, breakPenalties });
// Breaking after index 5 fills the line and costs its penalty of 2. Breaking
// after index 4 carries no penalty and leaves 1 em, which the shortfall weight
// prices at 1.5. The cheaper position wins.
// hinted.breakPoints → [4]
// Line 1: 今日は良い, Line 2: 天気ですね
// #endregion doc:break-penalties
