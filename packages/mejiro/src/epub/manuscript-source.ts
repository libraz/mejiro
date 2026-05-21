import { type ManuscriptDialect, parseManuscript } from '../manuscript.js';
import type { AnnotatedParagraph, EpubBook, EpubChapter } from './types.js';

/** Input shape for {@link manuscriptToEpubBook}. */
export interface ManuscriptSourceChapter {
  /** Optional chapter id (carried through but not required by the renderer). */
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
  const blocks = chapter.body
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t　]*\n+/u)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);
  for (const block of blocks) {
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
 * resolve them.
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
