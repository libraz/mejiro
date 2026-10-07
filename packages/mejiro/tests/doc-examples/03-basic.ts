export { result };

// #region doc:basic
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
});

// #endregion doc:basic
