export { result };

// #region doc:options
import { buildKinsokuRules, computeBreaks, toCodepoints } from '@libraz/mejiro';

const customRules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002], // 、。
  lineEndProhibited: [0x300c], // 「
});

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  mode: 'loose',
  enableHanging: true,
  tokenBoundaries: new Uint32Array([4, 10]),
  kinsokuRules: customRules,
});

// #endregion doc:options
