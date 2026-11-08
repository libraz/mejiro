import { type ManuscriptDialect, parseManuscript } from '../manuscript.js';
import { manuscriptParagraphs, parseInlineImageMarker } from '../manuscript-paragraphs.js';
import type { ManuscriptChapter } from '../types.js';
import type { EpubProjectMetadata } from './project.js';
import type { AnnotatedParagraph, EpubBook, EpubChapter } from './types.js';

export {
  insertManuscriptParagraph,
  type ManuscriptImageMarker,
  manuscriptParagraphs,
  parseInlineImageMarker,
} from '../manuscript-paragraphs.js';

/** Options for {@link manuscriptToEpubBook}. */
export interface ManuscriptToEpubBookOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /**
   * Package metadata of the book. Only `title` and `creators` reach the
   * synthesized {@link EpubBook}: the title as {@link EpubBook.title}, and the
   * names of the creators whose role is `'aut'`, joined with `', '`, as
   * {@link EpubBook.author}. A title left out reads as `''`.
   */
  metadata?: Partial<EpubProjectMetadata>;
}

function manuscriptChapterToAnnotatedParagraphs(
  chapter: ManuscriptChapter,
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
 * A chapter's `id` is not carried over: {@link EpubBook} chapters have none.
 * Each chapter body is split into paragraphs on blank lines and run through
 * {@link parseManuscript}, so ruby / emphasis / TCY / em / strong / link /
 * footnote annotations are resolved exactly as `EpubProject.export()` would
 * resolve them. Internal `[[mejiro-image:...]]` blocks are recognized and
 * skipped, matching the current read-only `EpubBook` parser surface where
 * figures do not appear as text paragraphs.
 *
 * @example
 * ```ts
 * const book = manuscriptToEpubBook(draft.chapters, {
 *   dialect: 'mejiro',
 *   metadata: { title: draft.title, creators: [{ name: draft.author, role: 'aut' }] },
 * });
 * <MejiroReader epub={book} />
 * ```
 *
 * @param chapters - Chapters in reading order.
 * @param options - Dialect and book metadata.
 * @returns A book with one {@link EpubChapter} per input chapter.
 */
export function manuscriptToEpubBook(
  chapters: readonly ManuscriptChapter[],
  options: ManuscriptToEpubBookOptions = {},
): EpubBook {
  const dialect = options.dialect ?? 'mejiro';
  const synthesized: EpubChapter[] = chapters.map((chapter) => ({
    title: chapter.title,
    paragraphs: manuscriptChapterToAnnotatedParagraphs(chapter, dialect),
  }));
  const author = (options.metadata?.creators ?? [])
    .filter((creator) => creator.role === 'aut')
    .map((creator) => creator.name)
    .join(', ');
  return {
    title: options.metadata?.title ?? '',
    ...(author ? { author } : {}),
    chapters: synthesized,
  };
}
