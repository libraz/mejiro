import type { RubyInputAnnotation } from '../browser/types.js';
import type { PageSlice } from '../paginate.js';
import { getLineRanges } from '../paginate.js';
import type { RenderEntry, RenderLine, RenderPage, RenderSegment } from './types.js';

/**
 * Builds line segments from characters and ruby annotations for a single line.
 *
 * @param chars - Character array for the paragraph.
 * @param annotations - Ruby annotations for the paragraph.
 * @param lineStart - Start index of the line (inclusive).
 * @param lineEnd - End index of the line (exclusive).
 * @returns Array of render segments for the line.
 */
function buildLineSegments(
  chars: string[],
  annotations: RubyInputAnnotation[],
  lineStart: number,
  lineEnd: number,
): RenderSegment[] {
  const rubyMap = new Map<number, RubyInputAnnotation>();
  const rubySkip = new Set<number>();

  for (const ann of annotations) {
    if (ann.type === 'jukugo') continue;
    if (ann.startIndex >= lineStart && ann.startIndex < lineEnd) {
      rubyMap.set(ann.startIndex, ann);
      for (let i = ann.startIndex + 1; i < ann.endIndex && i < lineEnd; i++) {
        rubySkip.add(i);
      }
    }
  }

  const segments: RenderSegment[] = [];
  let textBuffer = '';
  let pos = lineStart;

  while (pos < lineEnd) {
    if (rubySkip.has(pos)) {
      pos++;
      continue;
    }

    const ann = rubyMap.get(pos);
    if (ann) {
      if (textBuffer) {
        segments.push({ type: 'text', text: textBuffer });
        textBuffer = '';
      }
      const baseEnd = Math.min(ann.endIndex, lineEnd);
      segments.push({
        type: 'ruby',
        base: chars.slice(pos, baseEnd).join(''),
        rubyText: ann.rubyText,
      });
      pos = baseEnd;
    } else {
      textBuffer += chars[pos];
      pos++;
    }
  }

  if (textBuffer) {
    segments.push({ type: 'text', text: textBuffer });
  }

  return segments;
}

/**
 * Builds a render page data structure from page slices and render entries.
 *
 * Converts layout results (break points, characters, ruby annotations) into
 * a framework-agnostic `RenderPage` structure containing paragraphs, lines,
 * and segments ready for rendering.
 *
 * @param slices - Page slices from `paginate()` for a single page.
 * @param entries - Render entries for all paragraphs in the chapter.
 * @returns A `RenderPage` data structure for the page.
 */
export function buildRenderPage(slices: PageSlice[], entries: RenderEntry[]): RenderPage {
  const paragraphs = slices.map((slice) => {
    const entry = entries[slice.paragraphIndex];
    const lineRanges = getLineRanges(entry.breakPoints, entry.chars.length);

    const lines: RenderLine[] = [];
    for (let li = slice.lineStart; li < slice.lineEnd; li++) {
      const [charStart, charEnd] = lineRanges[li];
      lines.push({
        segments: buildLineSegments(entry.chars, entry.rubyAnnotations, charStart, charEnd),
      });
    }

    return { lines, isHeading: entry.isHeading };
  });

  return { paragraphs };
}
