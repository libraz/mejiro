export { result };

// #region doc:breaks
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('漢字を読む');
const advances = new Float32Array([16, 16, 16, 16, 16]);

const result = computeBreaks({
  text,
  advances,
  lineWidth: 48,
  rubyAnnotations: [
    {
      startIndex: 0,
      endIndex: 2,
      rubyText: toCodepoints('かんじ'),
      rubyAdvances: new Float32Array([8, 8, 8]),
      type: 'group',
    },
  ],
});
// Line breaks respect group clustering: indices 0 and 1 will not be split.
// #endregion doc:breaks
