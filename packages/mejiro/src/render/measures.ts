import type { ParagraphMeasure } from '../paginate.js';
import type { RenderEntry } from './types.js';

/** Options for computing paragraph measures. */
export interface MeasureOptions {
  /** Base font size in pixels. */
  fontSize: number;
  /** Line height multiplier. */
  lineHeight: number;
  /** Scale factor for heading font size. @defaultValue 1.4 */
  headingScale?: number;
  /** Gap before body paragraphs in em units. @defaultValue 0.4 */
  paragraphGapEm?: number;
  /** Gap after a heading paragraph in em units. @defaultValue 1.2 */
  headingGapEm?: number;
}

/**
 * Builds paragraph measures from render entries for use with `paginate()`.
 *
 * Computes line pitch (font size x line height) and inter-paragraph gaps
 * based on whether each paragraph is a heading or body text.
 *
 * @param entries - Render entries for each paragraph.
 * @param options - Font size, line height, and spacing configuration.
 * @returns Array of paragraph measures suitable for `paginate()`.
 */
export function buildParagraphMeasures(
  entries: RenderEntry[],
  options: MeasureOptions,
): ParagraphMeasure[] {
  const {
    fontSize,
    lineHeight,
    headingScale = 1.4,
    paragraphGapEm = 0.4,
    headingGapEm = 1.2,
  } = options;

  const headingFontSize = Math.round(fontSize * headingScale);
  const basePitch = fontSize * lineHeight;
  const headingPitch = headingFontSize * lineHeight;
  const paragraphGap = fontSize * paragraphGapEm;
  const headingGap = fontSize * headingGapEm;

  return entries.map((entry, i) => {
    const lineCount = entry.breakPoints.length + 1;
    const prevIsHeading = i > 0 && entries[i - 1].isHeading;
    return {
      lineCount,
      linePitch: entry.isHeading ? headingPitch : basePitch,
      gapBefore: prevIsHeading ? headingGap : paragraphGap,
    };
  });
}
