export { result };

// #region doc:custom-rules
import { buildKinsokuRules, computeBreaks, toCodepoints } from '@libraz/mejiro';

const rules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002, 0xff0c, 0xff0e], // 、。，．
  lineEndProhibited: [0x300c, 0x300e], // 「『
});

const result = computeBreaks({
  text: toCodepoints('あいう「えお'),
  advances: new Float32Array(6).fill(16),
  lineWidth: 48,
  kinsokuRules: rules,
});

// #endregion doc:custom-rules
