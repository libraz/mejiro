import { type ManuscriptDialect, parseManuscript } from '../manuscript.js';
import type { AnnotatedParagraph, EpubBook, EpubChapter } from './types.js';

/** Input shape for {@link manuscriptToEpubBook}. */
export interface ManuscriptSourceChapter {
  /** Optional source id for callers; the synthesized `EpubBook` shape does not expose it. */
  id?: string;
  /** Chapter title. Emitted as an `h1` paragraph at the top of the chapter. */
  title: string;
  /** Raw manuscript body. Blank lines separate paragraphs. */
  body: string;
}

/** Options for {@link manuscriptToEpubBook}. */
export interface ManuscriptToEpubBookOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /** Book title surfaced via {@link EpubBook.title}. @defaultValue `''` */
  title?: string;
  /** Book author surfaced via {@link EpubBook.author}. */
  author?: string;
}

function manuscriptChapterToAnnotatedParagraphs(
  chapter: ManuscriptSourceChapter,
  dialect: ManuscriptDialect,
): AnnotatedParagraph[] {
  const paragraphs: AnnotatedParagraph[] = [];
  if (chapter.title) {
    paragraphs.push({ text: chapter.title, inlineAnnotations: [], headingLevel: 1 });
  }
  for (const block of manuscriptParagraphs(chapter.body)) {
    if (parseInlineImageMarker(block)) continue;
    const parsed = parseManuscript(block, { dialect });
    paragraphs.push({ text: parsed.text, inlineAnnotations: parsed.inlineAnnotations });
  }
  return paragraphs;
}

/**
 * Synthesizes an {@link EpubBook} from manuscript chapters, skipping the EPUB
 * ZIP round-trip entirely. Designed for live preview surfaces and custom
 * manuscript editors that want to feed `MejiroReader` (or any code that
 * consumes `EpubBook`) without exporting to a real EPUB file first.
 *
 * Each chapter body is split into paragraphs on blank lines and run through
 * {@link parseManuscript}, so ruby / emphasis / TCY / em / strong / link /
 * footnote annotations are resolved exactly as `EpubProject.export()` would
 * resolve them. Internal `[[mejiro-image:...]]` blocks are recognized and
 * skipped, matching the current read-only `EpubBook` parser surface where
 * figures do not appear as text paragraphs.
 *
 * @example
 * ```ts
 * const book = manuscriptToEpubBook(draft.chapters, { dialect: 'mejiro' });
 * <MejiroReader epub={book} />
 * ```
 */
export function manuscriptToEpubBook(
  chapters: readonly ManuscriptSourceChapter[],
  options: ManuscriptToEpubBookOptions = {},
): EpubBook {
  const dialect = options.dialect ?? 'mejiro';
  const synthesized: EpubChapter[] = chapters.map((chapter) => ({
    title: chapter.title,
    paragraphs: manuscriptChapterToAnnotatedParagraphs(chapter, dialect),
  }));
  return {
    title: options.title ?? '',
    ...(options.author ? { author: options.author } : {}),
    chapters: synthesized,
  };
}

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

/** Parses an internal inline-image marker, returning null for ordinary paragraphs. */
export function parseInlineImageMarker(paragraph: string): ManuscriptImageMarker | null {
  const match = INLINE_IMAGE_MARKER.exec(paragraph.trim());
  if (!match) return null;
  const value = decodeMarkerPart(match[1]);
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
