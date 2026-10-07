export { result };

// #region doc:kinsoku
import {
  buildKinsokuRules,
  computeBreaks,
  getDefaultKinsokuRules,
  toCodepoints,
} from '@libraz/mejiro';

// Get defaults and customize
const defaults = getDefaultKinsokuRules();
const rules = buildKinsokuRules({
  lineStartProhibited: [...defaults.lineStartProhibited, 0xff05], // Add ％
  lineEndProhibited: defaults.lineEndProhibited,
  unbreakablePairs: defaults.unbreakablePairs, // Keep ‥‥ …… —— ―― together
});

const result = computeBreaks({
  text: toCodepoints('ただいま５％引きです。'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  kinsokuRules: rules,
});
// result.breakPoints → [3, 8]: ５ moves down with ％ instead of leaving ％ at a line start
// #endregion doc:kinsoku
