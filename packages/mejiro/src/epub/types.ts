import type { HeadingLevel, InlineAnnotation, ParagraphKind } from '../types.js';

/** Represents a parsed EPUB book. */
export interface EpubBook {
  /** Book title from OPF metadata. */
  readonly title: string;
  /**
   * Display string for the book's author. A parsed package supplies its first
   * `<dc:creator>`; `manuscriptToEpubBook()` joins the names of the creators
   * whose role is `'aut'` with `', '`. Absent when the source names no author.
   */
  readonly author?: string;
  /** Ordered chapters from the spine. */
  readonly chapters: readonly EpubChapter[];
  /** Spine page progression direction from OPF, if declared. */
  readonly pageProgressionDirection?: 'rtl' | 'ltr' | 'default';
}

/** A single chapter extracted from an EPUB spine item. */
export interface EpubChapter {
  /** Chapter title (from heading elements, if found). */
  readonly title?: string;
  /** Paragraphs with extracted ruby annotations. */
  readonly paragraphs: readonly AnnotatedParagraph[];
}

export type { ParagraphKind } from '../types.js';

/** Editable paragraph block — text with inline annotations. */
export interface EditableParagraphBlock {
  /** Discriminant of the {@link EditableBlock} union. */
  kind: 'paragraph';
  /** Stable identifier the editor's mutators address the block by. */
  id: string;
  /** Plain text (base text only, `<rt>` content stripped). Empty on a scene break. */
  text: string;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations: readonly InlineAnnotation[];
  /** Paragraph kind. Absent on body text. */
  paragraphKind?: Exclude<ParagraphKind, 'figure'>;
  /** Heading level; present exactly when `paragraphKind` is `'heading'`. */
  headingLevel?: HeadingLevel;
}

/** Editable image block — a figure embedded in chapter flow. */
export interface EditableImageBlock {
  /** Discriminant of the {@link EditableBlock} union. */
  kind: 'image';
  /** Stable identifier the editor's mutators address the block by. */
  id: string;
  /** Key into the chapter's `imageAssets` map. */
  assetKey: string;
  /** Alternative text for the generated `<img>`. */
  alt?: string;
  /** Optional `<figcaption>` text. */
  caption?: string;
  /** Layout hint for the renderer. */
  placement?: 'inline' | 'fullspread';
}

/**
 * Block-level item in an editable chapter. Paragraphs (including headings,
 * blockquotes, scene breaks) and images are siblings rather than nesting.
 */
export type EditableBlock = EditableParagraphBlock | EditableImageBlock;

/**
 * Image asset attached to an editable chapter, holding either its bytes or a
 * URL to fetch them from at export time. Looked up by `assetKey` from one or
 * more {@link EditableImageBlock}s — several blocks may reference the same
 * asset (e.g. a recurring icon).
 */
export type EditableImageAsset =
  | {
      /** Filename used inside the EPUB ZIP (e.g. `figure-01.png`). */
      filename: string;
      /** Existing ZIP path, kept when the image came from the source EPUB. */
      href?: string;
      /** Image media type. Inferred from the filename extension when absent. */
      mediaType?: string;
      /** Image bytes. */
      data: Uint8Array;
      /** Never set on this variant — it is what makes the union discriminate. */
      url?: never;
    }
  | {
      /** Filename used inside the EPUB ZIP (e.g. `figure-01.png`). */
      filename: string;
      /** Existing ZIP path, kept when the image came from the source EPUB. */
      href?: string;
      /** Image media type. Inferred from the filename extension when absent. */
      mediaType?: string;
      /** Never set on this variant — it is what makes the union discriminate. */
      data?: never;
      /**
       * External URL the bytes are fetched from at export time, through the
       * `assetResolver` passed to `EditableEpub.export()` (the runtime `fetch`
       * by default). Keeps large image bytes off the client while editing.
       */
      url: string;
    };

/** EPUB chapter with enough source metadata to be written back. */
export interface EditableEpubChapter {
  /** Chapter title (from heading elements or the table of contents, if found). */
  readonly title?: string;
  /** ZIP path for the chapter XHTML document. */
  href: string;
  /** Original XHTML source. An unedited chapter is exported as this, plus any export watermark. */
  originalXhtml: string;
  /** Block-level chapter content: paragraphs and images, in reading order. */
  blocks: readonly EditableBlock[];
  /**
   * Image assets used by this chapter. Keyed by `assetKey` (which is also the
   * preferred file basename inside the EPUB ZIP).
   */
  imageAssets: ReadonlyMap<string, EditableImageAsset>;
}

/** EPUB book with editable chapter metadata. */
export interface EditableEpubBook extends Omit<EpubBook, 'chapters'> {
  /** Ordered editable chapters from the spine. */
  chapters: readonly EditableEpubChapter[];
}

/**
 * Paragraph handed to `EditableEpub.insertParagraph`. The kind decides which
 * fields the paragraph carries: a heading needs its level, a scene break
 * carries no text.
 */
export type NewParagraph =
  | {
      /** Paragraph kind. @defaultValue 'body' */
      paragraphKind?: 'body' | 'blockquote' | 'pre';
      /** Plain text of the paragraph. */
      text: string;
      /**
       * Inline annotations indexed into `text`; any that fall outside it are
       * dropped. @defaultValue []
       */
      inlineAnnotations?: readonly InlineAnnotation[];
      /** Only headings carry a level. */
      headingLevel?: never;
    }
  | {
      /** Makes the paragraph a heading. */
      paragraphKind: 'heading';
      /** Heading level. */
      headingLevel: HeadingLevel;
      /** Plain text of the heading. */
      text: string;
      /**
       * Inline annotations indexed into `text`; any that fall outside it are
       * dropped. @defaultValue []
       */
      inlineAnnotations?: readonly InlineAnnotation[];
    }
  | {
      /** Makes the paragraph a scene break, exported as `<hr/>`. */
      paragraphKind: 'sceneBreak';
    };

/**
 * Change handed to `EditableEpub.updateParagraph`. Without `paragraphKind` the
 * kind is kept; with it, the fields the new kind requires come along: a heading
 * needs its level, and a scene break takes no text.
 */
export type ParagraphPatch =
  | {
      /** Absent: the paragraph keeps its kind. */
      paragraphKind?: never;
      /**
       * New text. Existing annotations are re-anchored onto it unless
       * `inlineAnnotations` is given too; each one either keeps covering the
       * same base characters or is dropped.
       */
      text?: string;
      /** Replacement annotations, indexed into the resulting text. */
      inlineAnnotations?: readonly InlineAnnotation[];
      /** New heading level; only a heading takes one. */
      headingLevel?: HeadingLevel;
    }
  | {
      /** Turns the paragraph into body text, a blockquote or preformatted text. */
      paragraphKind: 'body' | 'blockquote' | 'pre';
      /** New text; the current text is kept when absent. */
      text?: string;
      /** Replacement annotations, indexed into the resulting text. */
      inlineAnnotations?: readonly InlineAnnotation[];
    }
  | {
      /** Turns the paragraph into a heading. */
      paragraphKind: 'heading';
      /** Level of the heading. */
      headingLevel: HeadingLevel;
      /** New text; the current text is kept when absent. */
      text?: string;
      /** Replacement annotations, indexed into the resulting text. */
      inlineAnnotations?: readonly InlineAnnotation[];
    }
  | {
      /** Turns the paragraph into a scene break, dropping its text and annotations. */
      paragraphKind: 'sceneBreak';
    };

/** A paragraph with its base text and inline annotations. */
export interface AnnotatedParagraph {
  /** Plain text (base text only, `<rt>` content stripped). */
  text: string;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations: readonly InlineAnnotation[];
  /** Heading level if this paragraph originated from an h1–h6 element. */
  headingLevel?: HeadingLevel;
}
