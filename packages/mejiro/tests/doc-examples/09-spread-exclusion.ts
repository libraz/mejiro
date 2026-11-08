export { leftSlots, result, rightSlots };

import { toCodepoints } from '@libraz/mejiro';

// `text` and `advances` stand for a spread's worth of measured text.
const text = toCodepoints('吾輩は猫である。'.repeat(60));
const advances = new Float32Array(text.length).fill(16);

// #region doc:spread
import { computeBreaks, SpreadExclusionEngine } from '@libraz/mejiro';

const spread = new SpreadExclusionEngine({
  pageWidth: 537,
  paddingX: 52, // Inner + outer padding
  paddingY: 56,
  lineWidth: 676,
  linePitch: 30.4,
});

// Images are positioned relative to the right page's top-left corner.
// Negative x values automatically map to the left page with gutter offset.
spread.addImage({ x: 200, y: 100, width: 120, height: 160, inlineMargin: 16 });
spread.addImage({ x: -100, y: 300, width: 80, height: 100 }); // left page

const { rightSlots, leftSlots, lineWidths } = spread.compute();

// One computeBreaks call for the entire spread
const result = computeBreaks({ text, advances, lineWidth: 676, lineWidths });

// Split lines for rendering:
// Lines 0..rightSlots.length-1 → render on right page using rightSlots
// Lines rightSlots.length..     → render on left page using leftSlots
// #endregion doc:spread
