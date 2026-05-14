import type { InlineAnnotation } from '../browser/types.js';
import type { PageSlice } from '../paginate.js';
import { getLineRanges } from '../paginate.js';
import type { RenderEntry, RenderLine, RenderPage, RenderSegment } from './types.js';

/**
 * Builds line segments from characters and inline annotations for a single line.
 *
 * Each non-`jukugo` annotation whose start falls within the line opens a new
 * segment (ruby / emphasis / tcy / em / strong / link / footnote). Annotations
 * are processed in start-index order; overlapping spans are not supported.
 *
 * @param chars - Character array for the paragraph.
 * @param annotations - Inline annotations for the paragraph.
 * @param lineStart - Start index of the line (inclusive).
 * @param lineEnd - End index of the line (exclusive).
 * @returns Array of render segments for the line.
 */
function buildLineSegments(
  chars: string[],
  annotations: readonly InlineAnnotation[],
  lineStart: number,
  lineEnd: number,
): RenderSegment[] {
  const annMap = new Map<number, InlineAnnotation>();
  const annSkip = new Set<number>();

  for (const ann of annotations) {
    // Jukugo ruby is a span hint for the line breaker — the renderer emits
    // the per-segment ruby variants that pair with it instead.
    if (ann.kind === 'ruby' && ann.type === 'jukugo') continue;
    if (ann.startIndex >= lineStart && ann.startIndex < lineEnd) {
      annMap.set(ann.startIndex, ann);
      for (let i = ann.startIndex + 1; i < ann.endIndex && i < lineEnd; i++) {
        annSkip.add(i);
      }
    }
  }

  const segments: RenderSegment[] = [];
  let textBuffer = '';
  let pos = lineStart;

  function flushText(): void {
    if (textBuffer) {
      segments.push({ type: 'text', text: textBuffer });
      textBuffer = '';
    }
  }

  while (pos < lineEnd) {
    if (annSkip.has(pos)) {
      pos++;
      continue;
    }

    const ann = annMap.get(pos);
    if (ann) {
      flushText();
      const baseEnd = Math.min(ann.endIndex, lineEnd);
      const base = chars.slice(pos, baseEnd).join('');
      segments.push(toSegment(ann, base));
      pos = baseEnd;
    } else {
      if (chars[pos] !== '\n') textBuffer += chars[pos];
      pos++;
    }
  }

  flushText();
  return segments;
}

function toSegment(ann: InlineAnnotation, text: string): RenderSegment {
  switch (ann.kind) {
    case 'ruby':
      return { type: 'ruby', base: text, rubyText: ann.rubyText };
    case 'emphasis':
      return { type: 'emphasis', text, style: ann.style ?? 'sesame' };
    case 'tcy':
      return { type: 'tcy', text };
    case 'em':
      return { type: 'em', text };
    case 'strong':
      return { type: 'strong', text };
    case 'link':
      return ann.title != null
        ? { type: 'link', text, href: ann.href, title: ann.title }
        : { type: 'link', text, href: ann.href };
    case 'footnote':
      return { type: 'footnote-ref', text, noteId: ann.noteId };
  }
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
      const [charStart, rawCharEnd] = lineRanges[li];
      const charEnd = entry.chars[rawCharEnd - 1] === '\n' ? rawCharEnd - 1 : rawCharEnd;
      lines.push({
        segments: buildLineSegments(entry.chars, entry.inlineAnnotations, charStart, charEnd),
      });
    }

    const headingLevel = entry.headingLevel ?? (entry.isHeading ? 1 : undefined);
    return { lines, isHeading: headingLevel != null, headingLevel };
  });

  return { paragraphs };
}
