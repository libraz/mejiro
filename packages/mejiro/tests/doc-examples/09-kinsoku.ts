export { result };

// #region doc:kinsoku
import {
  computeBreaks,
  extendKinsokuRules,
  getDefaultKinsokuRules,
  toCodepoints,
} from '@libraz/mejiro';

// The default rules, with ％ also kept off the start of a line
const rules = extendKinsokuRules(getDefaultKinsokuRules(), { lineStartProhibited: [0xff05] });

const result = computeBreaks({
  text: toCodepoints('ただいま５％引きです。'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  kinsoku: rules,
});
// result.breakPoints → [3, 8]: ５ moves down with ％ instead of leaving ％ at a line start
// #endregion doc:kinsoku
