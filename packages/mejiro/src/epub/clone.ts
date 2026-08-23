import type { EditableBlock, EditableEpubBook, EditableEpubChapter } from './types.js';

/**
 * Paragraph an editor UI currently targets, addressed by chapter index and
 * paragraph index inside that chapter.
 */
export interface EditableEpubSelection {
  /** Zero-based chapter index. */
  chapter: number;
  /** Zero-based paragraph index inside that chapter. */
  paragraph: number;
}

/**
 * Deep-copies an editable book so preview rendering and export-only transforms
 * (watermarking, for instance) can never reach the document the editor owns.
 *
 * This is the single clone implementation in the package family: the React and
 * Vue editors call it rather than carrying their own copy, so a chapter field
 * added to {@link EditableEpubChapter} reaches every surface at once. Each
 * chapter is rebuilt by spreading the source first and overriding only the
 * mutable containers, which is what makes a new field carried over without
 * touching this function.
 *
 * Every mutable field is copied — down to individual inline annotations —
 * matching the fidelity of the editor's own undo/redo snapshots. Binary payloads
 * (`imageAssets` entries and `packageData.files` buffers) are shared by
 * reference: they are treated as immutable blobs and copying them would double
 * the memory a loaded book occupies.
 *
 * @param book - Book to copy; never mutated.
 * @returns An independent book whose chapters can be edited freely.
 */
export function cloneEditableEpubBook(book: EditableEpubBook): EditableEpubBook {
  return {
    ...book,
    chapters: book.chapters.map(cloneEditableEpubChapter),
    packageData: {
      ...book.packageData,
      files: new Map(book.packageData.files),
    },
  };
}

/** Deep-copies one chapter of an editable book. */
function cloneEditableEpubChapter(chapter: EditableEpubChapter): EditableEpubChapter {
  return {
    ...chapter,
    blocks: chapter.blocks.map(cloneEditableBlock),
    imageAssets: new Map(chapter.imageAssets),
    originalImageHrefs: chapter.originalImageHrefs ? [...chapter.originalImageHrefs] : undefined,
    paragraphs: chapter.paragraphs.map((paragraph) => ({
      ...paragraph,
      inlineAnnotations: paragraph.inlineAnnotations.map((annotation) => ({ ...annotation })),
    })),
    paragraphRefs: chapter.paragraphRefs?.map((ref) => ({ ...ref })),
    images: chapter.images?.map((image) => ({ ...image })),
  };
}

/**
 * Deep-copies one block of an editable chapter.
 *
 * Shared with the editor's undo/redo snapshots so a preview copy and a history
 * entry always carry the same depth.
 *
 * @param block - Block to copy; never mutated.
 * @returns An independent block.
 */
export function cloneEditableBlock(block: EditableBlock): EditableBlock {
  return block.kind === 'paragraph'
    ? { ...block, inlineAnnotations: block.inlineAnnotations.map((ann) => ({ ...ann })) }
    : { ...block };
}

/**
 * Confines a selection to the paragraphs a book actually has.
 *
 * Non-integer and non-finite indices are accepted so a UI can hand over raw
 * input: they are truncated toward zero, then clamped. A book with no chapters,
 * or a chapter with no paragraphs, resolves to index `0` so the selection stays
 * a valid pair rather than becoming `null`.
 *
 * @param book - Book the selection points into, or `null` before one is loaded.
 * @param selection - Requested selection.
 * @returns A selection that addresses an existing paragraph whenever one exists.
 */
export function clampEditableEpubSelection(
  book: EditableEpubBook | null,
  selection: EditableEpubSelection,
): EditableEpubSelection {
  if (!book?.chapters.length) return { chapter: 0, paragraph: 0 };
  const chapter = clampInteger(selection.chapter, 0, book.chapters.length - 1);
  const paragraphCount = book.chapters[chapter]?.paragraphs.length ?? 0;
  const paragraph = paragraphCount ? clampInteger(selection.paragraph, 0, paragraphCount - 1) : 0;
  return { chapter, paragraph };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
