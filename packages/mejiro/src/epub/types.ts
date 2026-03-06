import type { RubyInputAnnotation } from '../browser/types.js';

/** Represents a parsed EPUB book. */
export interface EpubBook {
  /** Book title from OPF metadata. */
  title: string;
  /** Book author from OPF metadata. */
  author?: string;
  /** Ordered chapters from the spine. */
  chapters: EpubChapter[];
}

/** A single chapter extracted from an EPUB spine item. */
export interface EpubChapter {
  /** Chapter title (from heading elements, if found). */
  title?: string;
  /** Paragraphs with extracted ruby annotations. */
  paragraphs: AnnotatedParagraph[];
}

/** A paragraph with its base text and ruby annotations. */
export interface AnnotatedParagraph {
  /** Plain text (base text only, <rt> content stripped). */
  text: string;
  /** Ruby annotations referencing character positions in `text`. */
  rubyAnnotations: RubyInputAnnotation[];
  /** Heading level (1–6) if this paragraph originated from an h1–h6 element. */
  headingLevel?: number;
}
