/**
 * Manuscript paragraph space: how a manuscript body splits into paragraph
 * blocks and which blocks are inline-image markers. Shared by `mejiro/book`
 * and `mejiro/epub` so preview layout and EPUB export index paragraphs alike.
 */

/** Blank-line run that separates two manuscript paragraphs. */
const PARAGRAPH_SEPARATOR = /\n[ \t　]*\n+/gu;

/**
 * Layout white space stripped from both ends of every line. Deliberately
 * excludes the ideographic space, which Japanese manuscripts use as body text
 * for paragraph indentation and scene dividers.
 */
const LINE_EDGE_SPACE = /^[ \t]+|[ \t]+$/gu;

/** A paragraph block together with the source range it was read from. */
interface ParagraphBlock {
  /** Normalized block text, as returned by {@link manuscriptParagraphs}. */
  text: string;
  /** Offset of the block within the line-break-normalized body. */
  start: number;
  /** End offset (exclusive) of the block within the line-break-normalized body. */
  end: number;
}

function normalizeLineBreaks(body: string): string {
  return body.replace(/\r\n?/gu, '\n');
}

/**
 * Collects the paragraph blocks of a line-break-normalized body. Blocks are the
 * single source of truth for the manuscript paragraph space: their text drives
 * {@link manuscriptParagraphs} and their offsets drive
 * {@link insertManuscriptParagraph}.
 */
function paragraphBlocks(normalized: string): ParagraphBlock[] {
  const blocks: ParagraphBlock[] = [];
  let cursor = 0;
  for (const match of normalized.matchAll(PARAGRAPH_SEPARATOR)) {
    appendParagraphBlock(blocks, normalized, cursor, match.index);
    cursor = match.index + match[0].length;
  }
  appendParagraphBlock(blocks, normalized, cursor, normalized.length);
  return blocks;
}

function appendParagraphBlock(
  blocks: ParagraphBlock[],
  normalized: string,
  from: number,
  to: number,
): void {
  const lines: string[] = [];
  let start = -1;
  let end = -1;
  let lineStart = from;
  while (lineStart <= to) {
    const lineBreak = normalized.indexOf('\n', lineStart);
    const lineEnd = lineBreak === -1 || lineBreak > to ? to : lineBreak;
    const line = normalized.slice(lineStart, lineEnd).replace(LINE_EDGE_SPACE, '');
    if (line) {
      lines.push(line);
      if (start === -1) start = lineStart;
      end = lineEnd;
    }
    lineStart = lineEnd + 1;
  }
  if (lines.length > 0) blocks.push({ text: lines.join('\n'), start, end });
}

/**
 * Splits manuscript body text into paragraph blocks on blank lines. Every other
 * character of a block survives, including the ideographic spaces that indent a
 * paragraph or stand alone as a scene divider, so the paragraph count and index
 * of a body depend on its blank lines alone.
 */
export function manuscriptParagraphs(body: string): string[] {
  return paragraphBlocks(normalizeLineBreaks(body)).map((block) => block.text);
}

/**
 * Inserts `block` as a standalone paragraph at `index` of the paragraph space
 * {@link manuscriptParagraphs} defines, and returns the new body. Text around
 * the insertion point is left as the author wrote it, apart from line-break
 * normalization. `index` is clamped to the current paragraph count.
 */
export function insertManuscriptParagraph(body: string, index: number, block: string): string {
  const normalized = normalizeLineBreaks(body);
  const blocks = paragraphBlocks(normalized);
  if (blocks.length === 0) return block;
  const insertAt = Math.max(0, Math.min(blocks.length, index));
  if (insertAt === blocks.length) {
    const offset = blocks[blocks.length - 1].end;
    return `${normalized.slice(0, offset)}\n\n${block}${normalized.slice(offset)}`;
  }
  const offset = blocks[insertAt].start;
  return `${normalized.slice(0, offset)}${block}\n\n${normalized.slice(offset)}`;
}

const INLINE_IMAGE_MARKER = /^\[\[mejiro-image:([^:|\]]+)(?:\|([^\]]*))?\]\]$/u;

/** Parsed internal inline-image marker embedded by `EpubProject.addInlineImage()`. */
export interface ManuscriptImageMarker {
  src: string;
  alt: string;
}

/**
 * Parses an internal inline-image marker, returning null for ordinary
 * paragraphs. A marker whose path carries a URL scheme or is absolute does not
 * name a file inside the archive and is treated as ordinary text.
 */
export function parseInlineImageMarker(paragraph: string): ManuscriptImageMarker | null {
  const match = INLINE_IMAGE_MARKER.exec(paragraph.trim());
  if (!match) return null;
  const value = decodeMarkerPart(match[1]);
  if (value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return null;
  const src = value.includes('/') ? value : `../Images/${value}`;
  return { src, alt: match[2] ? decodeMarkerPart(match[2]) : '' };
}

function decodeMarkerPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
