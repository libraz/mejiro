/**
 * Extracts line ranges (character start/end pairs) from break points.
 *
 * Converts the compact `breakPoints` array from a `BreakResult` into
 * an array of `[startIndex, endIndex)` pairs, one per line.
 *
 * @param breakPoints - Break point indices from `BreakResult`.
 * @param charCount - Total number of characters in the text.
 * @returns Array of `[start, end)` index pairs for each line.
 */
export function getLineRanges(breakPoints: Uint32Array, charCount: number): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;
  for (const bp of breakPoints) {
    ranges.push([start, bp + 1]);
    start = bp + 1;
  }
  if (start < charCount) {
    ranges.push([start, charCount]);
  }
  return ranges;
}

/**
 * Measurement for a single paragraph used in pagination.
 */
export interface ParagraphMeasure {
  /** Number of lines (columns in vertical-rl) in this paragraph. */
  lineCount: number;
  /** Size of each line in the block direction (px). Typically fontSize * lineHeight. */
  linePitch: number;
  /** Gap before this paragraph in the block direction (px). Ignored when paragraph starts a page. */
  gapBefore: number;
}

/**
 * A slice of a paragraph assigned to a page.
 */
export interface PageSlice {
  /** Index of the paragraph in the input array. */
  paragraphIndex: number;
  /** First line index within the paragraph (0-based). */
  lineStart: number;
  /** End line index within the paragraph (exclusive). */
  lineEnd: number;
}

/**
 * Computes page assignments for a sequence of paragraphs.
 *
 * Distributes paragraph lines across pages of fixed block size,
 * splitting paragraphs at page boundaries when necessary.
 * Each line consumes its paragraph's `linePitch` in the block direction,
 * and inter-paragraph gaps are added before the first line of each
 * paragraph (except at page start).
 *
 * @param pageBlockSize - Available size in the block direction per page (px).
 * @param paragraphs - Measurements for each paragraph.
 * @returns Array of pages, each containing an array of paragraph slices.
 */
export function paginate(pageBlockSize: number, paragraphs: ParagraphMeasure[]): PageSlice[][] {
  if (paragraphs.length === 0) return [[]];

  const pages: PageSlice[][] = [];
  let currentPage: PageSlice[] = [];
  let usedBlock = 0;
  let isPageStart = true;

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const { lineCount, linePitch, gapBefore } = paragraphs[pi];

    for (let li = 0; li < lineCount; li++) {
      const isNewPara = li === 0;
      const gap = isNewPara && !isPageStart ? gapBefore : 0;
      const needed = gap + linePitch;

      // If this line doesn't fit, start a new page
      if (!isPageStart && usedBlock + needed > pageBlockSize + 0.5) {
        pages.push(currentPage);
        currentPage = [];
        usedBlock = 0;
        isPageStart = true;
      }

      // Recalculate gap for the (possibly new) page
      const effectiveGap = isNewPara && !isPageStart ? gapBefore : 0;
      usedBlock += effectiveGap + linePitch;
      isPageStart = false;

      // Extend existing slice or create a new one
      const last = currentPage[currentPage.length - 1];
      if (last && last.paragraphIndex === pi) {
        last.lineEnd = li + 1;
      } else {
        currentPage.push({ paragraphIndex: pi, lineStart: li, lineEnd: li + 1 });
      }
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}
