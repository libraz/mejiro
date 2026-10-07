export { result, slots };

// #region doc:exclusion
import { computeBreaks, ExclusionEngine, toCodepoints } from '@libraz/mejiro';

const engine = new ExclusionEngine({
  lineWidth: 600, // Column height (px)
  lineCount: 12, // Number of columns
  linePitch: 30.4, // fontSize × lineHeight
  contentWidth: 380, // Available width for columns (px)
});

// Add images (content-area coordinates)
engine.addImage({ x: 100, y: 50, w: 120, h: 160 });
engine.addImage({ x: 50, y: 300, w: 80, h: 100 });

// Compute column slots and line widths
const { slots, lineWidths } = engine.compute();

// Pass lineWidths to the layout engine
const text = toCodepoints('...');
const advances = new Float32Array(text.length).fill(16);
const result = computeBreaks({
  text,
  advances,
  lineWidth: 600,
  lineWidths, // Per-column widths from ExclusionEngine
});

// Render each column at slots[i].xPos, slots[i].yStart
// with height = slots[i].height
// #endregion doc:exclusion
