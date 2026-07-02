import type { InlineAnnotation } from '../browser/types.js';

/** Represents a parsed EPUB book. */
export interface EpubBook {
  /** Book title from OPF metadata. */
  readonly title: string;
  /** Book author from OPF metadata. */
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

/**
 * Paragraph kind shared by core, render, and EPUB modules.
 *
 * - `body`: normal `<p>`
 * - `heading`: `<h1>`–`<h6>` (`headingLevel` MUST be set)
 * - `blockquote`: indented quoted passage
 * - `sceneBreak`: a horizontal divider (e.g. `* * *`)
 * - `pre`: preformatted text (rarely used in vertical text)
 * - `figure`: image-with-caption block
 */
export type ParagraphKind = 'body' | 'heading' | 'blockquote' | 'sceneBreak' | 'pre' | 'figure';

/** Editable paragraph block — text with inline annotations. */
export interface EditableParagraphBlock {
  kind: 'paragraph';
  /** Stable identifier for incremental updates. */
  id: string;
  /** Plain text (base text only, `<rt>` content stripped). */
  text: string;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations: readonly InlineAnnotation[];
  /** Paragraph kind. Defaults to `'body'` when omitted. */
  paragraphKind?: Exclude<ParagraphKind, 'figure'>;
  /** Heading level (1–6); required when `paragraphKind: 'heading'`. */
  headingLevel?: number;
}

/** Editable image block — a figure embedded in chapter flow. */
export interface EditableImageBlock {
  kind: 'image';
  /** Stable identifier for incremental updates. */
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
 * Image asset attached to an editable chapter. Looked up by `assetKey` from
 * one or more {@link EditableImageBlock}s — multiple blocks may reference the
 * same asset (e.g. a recurring icon).
 */
export interface EditableImageAsset {
  /** Filename used inside the EPUB ZIP (e.g. `figure-01.png`). */
  filename: string;
  /** Existing ZIP path to preserve when the image came from the source EPUB. */
  href?: string;
  /** @internal Original OPF manifest id for an existing image asset. */
  manifestId?: string;
  /** @internal Original OPF-relative href, preserving percent encoding. */
  manifestHref?: string;
  /**
   * Binary image data. Either this or {@link EditableImageAsset.url} must be
   * set. When both are present, `data` wins and `url` is ignored.
   */
  data?: Uint8Array | ArrayBuffer;
  /**
   * External URL to fetch image bytes from at export time. Resolved by the
   * `assetResolver` provided to `EditableEpub.export()` (defaults to the
   * runtime `fetch`). Useful for keeping large image bytes off the client —
   * register only a URL during editing, then materialize the bytes once when
   * the EPUB is assembled.
   */
  url?: string;
  /** Image media type. Defaults are inferred from the filename extension. */
  mediaType?: string;
}

/** EPUB chapter with enough source metadata to be written back. */
export interface EditableEpubChapter extends EpubChapter {
  /** ZIP path for the chapter XHTML document. */
  href: string;
  /** Original XHTML source. Kept for inspection. */
  originalXhtml: string;
  /** @internal Whether this chapter must be serialized instead of preserving `originalXhtml`. */
  isDirty?: boolean;
  /**
   * Block-level chapter content. Paragraphs and images are siblings, ordered
   * by reading order. This is the canonical representation in v0.5+.
   */
  blocks: EditableBlock[];
  /**
   * Image assets used by this chapter. Keyed by `assetKey` (which is also the
   * preferred file basename inside the EPUB ZIP).
   */
  imageAssets: Map<string, EditableImageAsset>;
  /** @internal Image ZIP paths discovered while parsing the source chapter. */
  originalImageHrefs?: string[];
  /**
   * @deprecated Mirror of `blocks` projected to {@link AnnotatedParagraph}s
   * for read-only compatibility with v0.4 callers. Regenerated on every
   * mutation. Editor APIs operate on `blocks`.
   */
  paragraphs: AnnotatedParagraph[];
  /** @deprecated Replaced by `blocks`; will be removed in v0.6. */
  paragraphRefs?: EditableParagraphRef[];
  /** @deprecated Use {@link EditableEpubChapter.imageAssets} via `addImage`. */
  images?: EditableEpubImage[];
}

/** @deprecated Source element metadata is no longer used. */
interface EditableParagraphRef {
  index: number;
  tagName: string;
}

/** EPUB book with editable chapter metadata. */
export interface EditableEpubBook extends Omit<EpubBook, 'chapters'> {
  /** Ordered editable chapters from the spine. */
  chapters: EditableEpubChapter[];
  /** @internal Original EPUB package data needed for export. */
  packageData: {
    rootfilePath: string;
    opfDir: string;
    opfXml: string;
    files: Map<string, Uint8Array>;
  };
}

/**
 * @deprecated v0.4 image-insertion shape. The v0.5 path is
 * `EditableEpub.addImage(chapterIndex, { filename, data, ... })`. Both
 * signatures are accepted by `addImage`, but `EditableEpubImage` will be
 * removed in v0.6.
 */
export interface EditableEpubImage {
  id?: string;
  /** ZIP path for the image file, relative to EPUB root. */
  href: string;
  /** Image media type, e.g. `image/jpeg` or `image/png`. */
  mediaType: string;
  /** Binary image data. */
  data: Uint8Array | ArrayBuffer;
  /** Alternative text for the generated `<img>`. */
  alt?: string;
  /** Insert after this block index. Defaults to the end of the chapter. */
  afterParagraph?: number;
}

/** A paragraph with its base text and inline annotations. */
export interface AnnotatedParagraph {
  /** Plain text (base text only, `<rt>` content stripped). */
  text: string;
  /** Inline annotations (ruby, emphasis, tcy, em/strong, link, footnote). */
  inlineAnnotations: readonly InlineAnnotation[];
  /** Heading level (1–6) if this paragraph originated from an h1–h6 element. */
  headingLevel?: number;
}
