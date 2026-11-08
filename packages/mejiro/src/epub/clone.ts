import type { InlineAnnotation } from '../types.js';
import type {
  AnnotatedParagraph,
  EditableBlock,
  EditableEpubBook,
  EditableEpubChapter,
  EditableImageAsset,
  EpubBook,
  EpubChapter,
} from './types.js';

/**
 * Block an editor UI currently targets, addressed by chapter index and block
 * id inside that chapter.
 */
export interface EditableEpubSelection {
  /** Zero-based chapter index. */
  chapterIndex: number;
  /** Id of the selected block, or `null` when no block is selected. */
  blockId: string | null;
}

/** @internal Package data of a parsed book, which export writes back. */
export interface EditablePackageData {
  rootfilePath: string;
  opfDir: string;
  opfXml: string;
  files: Map<string, Uint8Array>;
}

/** @internal Export state of one chapter. */
export interface EditableChapterState {
  /** Whether the chapter is rebuilt from its blocks instead of written back verbatim. */
  dirty: boolean;
  /** Image ZIP paths found while parsing the source chapter. */
  originalImageHrefs: readonly string[];
}

/** @internal Where an asset parsed from the source EPUB sits in its package document. */
export interface EditableAssetSource {
  /** Original OPF manifest id. */
  manifestId?: string;
  /** Original OPF-relative href, preserving percent encoding. */
  manifestHref?: string;
}

/** @internal A chapter as the editor writes it; the public type is read-only. */
export interface WritableChapter extends Omit<EditableEpubChapter, 'blocks' | 'imageAssets'> {
  blocks: EditableBlock[];
  imageAssets: Map<string, EditableImageAsset>;
}

// State export needs that is no part of the public document model.
const packageSlots = new WeakMap<EditableEpubBook, EditablePackageData>();
const chapterSlots = new WeakMap<EditableEpubChapter, EditableChapterState>();
const assetSlots = new WeakMap<EditableImageAsset, EditableAssetSource>();

/** @internal Gives the editor's write access to a chapter. */
export function writable(chapter: EditableEpubChapter): WritableChapter {
  return chapter as WritableChapter;
}

/** @internal Attaches the package data a parsed book exports with. */
export function attachPackageData(book: EditableEpubBook, data: EditablePackageData): void {
  packageSlots.set(book, data);
}

/** @internal Package data of a book made by `parseEditableEpub`. */
export function packageDataOf(book: EditableEpubBook): EditablePackageData {
  const data = packageSlots.get(book);
  if (!data) throw new TypeError('The book was not produced by parseEditableEpub');
  return data;
}

/** @internal Export state of `chapter`, created clean on first use. */
export function chapterStateOf(chapter: EditableEpubChapter): EditableChapterState {
  let state = chapterSlots.get(chapter);
  if (!state) {
    state = { dirty: false, originalImageHrefs: [] };
    chapterSlots.set(chapter, state);
  }
  return state;
}

/** @internal Records where a parsed asset sits in the source package document. */
export function attachAssetSource(asset: EditableImageAsset, source: EditableAssetSource): void {
  assetSlots.set(asset, source);
}

/** @internal Source location of `asset`; empty for an asset added while editing. */
export function assetSourceOf(asset: EditableImageAsset): EditableAssetSource {
  return assetSlots.get(asset) ?? {};
}

/**
 * Deep-copies an editable book so preview rendering can never reach the
 * document the editor owns.
 *
 * This is the single clone implementation in the package family: the React and
 * Vue editors call it rather than carrying their own copy, so a chapter field
 * added to {@link EditableEpubChapter} reaches every surface at once. Each
 * chapter is rebuilt by spreading the source first and overriding only the
 * mutable containers, which is what makes a new field carried over without
 * touching this function. A copy of a book made by `parseEditableEpub` keeps
 * the package state that book exports with.
 *
 * Every mutable field is copied — down to individual inline annotations and
 * their `jukugoSplitPoints`, and each `imageAssets` entry — matching the
 * fidelity of the editor's own undo/redo snapshots. Binary payloads (asset
 * `data` and the archive's file buffers) are shared by reference: they are
 * treated as immutable blobs and copying them would double the memory a loaded
 * book occupies.
 *
 * @param epub - Book to copy; never mutated.
 * @returns An independent book whose chapters can be edited freely.
 */
export function cloneEditableEpubBook(epub: EditableEpubBook): EditableEpubBook {
  const copy: EditableEpubBook = { ...epub, chapters: epub.chapters.map(cloneEditableEpubChapter) };
  const data = packageSlots.get(epub);
  if (data) packageSlots.set(copy, { ...data, files: new Map(data.files) });
  return copy;
}

/** Deep-copies one chapter of an editable book. */
function cloneEditableEpubChapter(chapter: EditableEpubChapter): EditableEpubChapter {
  const copy: WritableChapter = {
    ...chapter,
    blocks: chapter.blocks.map(cloneEditableBlock),
    imageAssets: new Map(
      Array.from(chapter.imageAssets, ([key, asset]) => [key, cloneImageAsset(asset)] as const),
    ),
  };
  const state = chapterSlots.get(chapter);
  if (state) {
    chapterSlots.set(copy, { ...state, originalImageHrefs: [...state.originalImageHrefs] });
  }
  return copy;
}

/** Copies an asset entry together with its source location; the bytes are shared. */
function cloneImageAsset(asset: EditableImageAsset): EditableImageAsset {
  const copy = { ...asset };
  const source = assetSlots.get(asset);
  if (source) assetSlots.set(copy, { ...source });
  return copy;
}

/**
 * Projects an editable book onto the read-only {@link EpubBook} shape, for
 * previewing the edited book in a reader.
 *
 * The paragraphs are the ones `parseEpub` would read from the exported book:
 * paragraph blocks keep their text, annotations and heading level, a scene
 * break and an empty paragraph contribute none, and an image block
 * contributes its caption, when it has one, as a plain paragraph. Chapters
 * stay index-aligned with `epub.chapters`.
 *
 * @param epub - Book to project; never mutated.
 * @returns A new book sharing no objects with `epub`.
 */
export function editableEpubToEpubBook(epub: EditableEpubBook): EpubBook {
  return {
    title: epub.title,
    ...(epub.author !== undefined ? { author: epub.author } : {}),
    ...(epub.pageProgressionDirection
      ? { pageProgressionDirection: epub.pageProgressionDirection }
      : {}),
    chapters: epub.chapters.map(chapterToEpubChapter),
  };
}

function chapterToEpubChapter(chapter: EditableEpubChapter): EpubChapter {
  const paragraphs: AnnotatedParagraph[] = [];
  for (const block of chapter.blocks) {
    if (block.kind === 'image') {
      if (block.caption) paragraphs.push({ text: block.caption, inlineAnnotations: [] });
    } else if (block.text !== '') {
      const paragraph: AnnotatedParagraph = {
        text: block.text,
        inlineAnnotations: block.inlineAnnotations.map(copyAnnotation),
      };
      if (block.headingLevel !== undefined) paragraph.headingLevel = block.headingLevel;
      paragraphs.push(paragraph);
    }
  }
  return chapter.title !== undefined ? { title: chapter.title, paragraphs } : { paragraphs };
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
    ? { ...block, inlineAnnotations: block.inlineAnnotations.map(copyAnnotation) }
    : { ...block };
}

/** Copies an annotation together with its one array field, `jukugoSplitPoints`. */
function copyAnnotation(annotation: InlineAnnotation): InlineAnnotation {
  return annotation.type === 'ruby' && annotation.jukugoSplitPoints
    ? { ...annotation, jukugoSplitPoints: [...annotation.jukugoSplitPoints] }
    : { ...annotation };
}

/**
 * Confines a selection to the chapters and blocks a book actually has.
 *
 * A non-integer or non-finite chapter index is accepted so a UI can hand over
 * raw input: it is truncated toward zero, then clamped. A block id the chapter
 * does not hold resolves to the chapter's first block, and to `null` when the
 * chapter has none; a `null` block id stays `null`.
 *
 * @param epub - Book the selection points into, or `null` before one is loaded.
 * @param selection - Requested selection.
 * @returns A selection that addresses an existing chapter, and an existing
 *   block of it or none.
 */
export function clampEditableEpubSelection(
  epub: EditableEpubBook | null,
  selection: EditableEpubSelection,
): EditableEpubSelection {
  if (!epub?.chapters.length) return { chapterIndex: 0, blockId: null };
  const chapterIndex = clampInteger(selection.chapterIndex, 0, epub.chapters.length - 1);
  const { blocks } = epub.chapters[chapterIndex];
  if (selection.blockId === null) return { chapterIndex, blockId: null };
  const blockId = blocks.some((block) => block.id === selection.blockId)
    ? selection.blockId
    : (blocks[0]?.id ?? null);
  return { chapterIndex, blockId };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
