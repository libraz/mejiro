import { computeBreaks } from './layout.ts';
import { getLineRanges } from './paginate.ts';

// 20 chars, each advance = 10, lineWidth = 50 => 5 chars per line
const len = 20;
const text = new Uint32Array(len);
for (let i = 0; i < len; i++) text[i] = 0x3042; // 'あ' codepoint, generic char
const advances = new Float32Array(len).fill(10);

const result = computeBreaks({
  text,
  advances,
  lineWidth: 50,
  mode: 'loose',
  enableHanging: false,
});
console.log('breakPoints:', Array.from(result.breakPoints));

const ranges = getLineRanges(result.breakPoints, len);
console.log('line ranges (via getLineRanges, the actual rendering logic):', ranges);

// Now replicate findInParaLine logic from chapter-layout.ts
function findInParaLine(breakPoints, c) {
  let lo = 0;
  let hi = breakPoints.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (breakPoints[mid] > c) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

for (let c = 0; c < len; c++) {
  const li = findInParaLine(result.breakPoints, c);
  // ground truth from ranges
  const trueLi = ranges.findIndex(([s, e]) => c >= s && c < e);
  const mark = li === trueLi ? '' : '  <-- MISMATCH';
  console.log(`char ${c}: findInParaLine=${li}, ground truth (getLineRanges)=${trueLi}${mark}`);
}
