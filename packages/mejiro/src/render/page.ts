import type { InlineAnnotation } from '../browser/types.js';
import type { PageSlice } from '../paginate.js';
import { getLineRanges } from '../paginate.js';
import { sanitizeUrl } from '../url.js';
import { buildInlineNodes, type InlineNode } from './inline-tree.js';
import type { RenderEntry, RenderLine, RenderPage, RenderSegment } from './types.js';

/**
 * Builds line segments from characters and inline annotations for a single line.
 *
 * Every annotation intersecting `[lineStart, lineEnd)` contributes a segment
 * covering the intersection (ruby / emphasis / tcy / em / strong / link /
 * footnote), so a span crossing the line boundary keeps its type and metadata on
 * both lines instead of degrading to plain text. Annotations are processed in
 * start-index order; partially overlapping spans are not supported.
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
  return buildInlineNodes(chars, annotations, lineStart, lineEnd).map(nodeToSegment);
}

function nodeToSegment(node: InlineNode): RenderSegment {
  switch (node.type) {
    case 'text':
      return { type: 'text', text: node.text.replaceAll('\n', '') };
    case 'ruby':
      return { type: 'ruby', base: node.base, rubyText: node.rubyText, children: children(node) };
    case 'emphasis':
      return { type: 'emphasis', text: node.text, style: node.style, children: children(node) };
    case 'tcy':
      return { type: 'tcy', text: node.text, children: children(node) };
    case 'em':
      return { type: 'em', text: node.text, children: children(node) };
    case 'strong':
      return { type: 'strong', text: node.text, children: children(node) };
    case 'link': {
      const href = sanitizeUrl(node.href);
      if (!href) return { type: 'text', text: node.text };
      return node.title != null
        ? { type: 'link', text: node.text, href, title: node.title, children: children(node) }
        : { type: 'link', text: node.text, href, children: children(node) };
    }
    case 'footnote-ref':
      return {
        type: 'footnote-ref',
        text: node.text,
        noteId: node.noteId,
        children: children(node),
      };
  }
}

function children(node: Exclude<InlineNode, { type: 'text' }>): RenderSegment[] | undefined {
  return node.children.length > 0 ? node.children.map(nodeToSegment) : undefined;
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
    const safeLineRanges = lineRanges.length > 0 ? lineRanges : ([[0, 0]] as [number, number][]);

    const lines: RenderLine[] = [];
    for (let li = slice.lineStart; li < slice.lineEnd; li++) {
      const [charStart, rawCharEnd] = safeLineRanges[li] ?? [0, 0];
      const charEnd = entry.chars[rawCharEnd - 1] === '\n' ? rawCharEnd - 1 : rawCharEnd;
      lines.push({
        segments: buildLineSegments(entry.chars, entry.inlineAnnotations, charStart, charEnd),
      });
    }

    const headingLevel = entry.headingLevel;
    return {
      lines,
      isHeading: headingLevel != null || entry.isHeading === true,
      headingLevel,
      kind: entry.kind,
    };
  });

  return { paragraphs };
}
