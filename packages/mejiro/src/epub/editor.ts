import JSZip from 'jszip';
import type { InlineAnnotation } from '../browser/types.js';
import { extractRubyContent } from './ruby-extractor.js';
import type {
  AnnotatedParagraph,
  EditableBlock,
  EditableEpubBook,
  EditableEpubChapter,
  EditableEpubImage,
  EditableImageAsset,
  EditableImageBlock,
  EditableParagraphBlock,
} from './types.js';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Reusable EPUB editing session with read/modify/write-back support. */
export class EditableEpub {
  readonly book: EditableEpubBook;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private historyLimit = 50;
  private txnDepth = 0;
  private pendingEntry: HistoryEntry | undefined;

  private constructor(book: EditableEpubBook) {
    this.book = book;
  }

  /**
   * Groups a sequence of edits into one history entry. Nested calls are
   * folded into the outermost transaction. The callback is run synchronously.
   * Throws inside the callback rewind the buffered changes.
   */
  transaction<T>(fn: () => T): T {
    if (this.txnDepth === 0) this.pendingEntry = new Map();
    this.txnDepth++;
    try {
      const result = fn();
      this.txnDepth--;
      if (this.txnDepth === 0 && this.pendingEntry && this.pendingEntry.size > 0) {
        this.commitHistoryEntry(this.pendingEntry);
        this.pendingEntry = undefined;
      } else if (this.txnDepth === 0) {
        this.pendingEntry = undefined;
      }
      return result;
    } catch (err) {
      this.txnDepth--;
      if (this.txnDepth === 0 && this.pendingEntry) {
        // Roll back to the pre-transaction state.
        this.restoreEntry(this.pendingEntry);
        this.pendingEntry = undefined;
      }
      throw err;
    }
  }

  /** Reverts the last committed change (or transaction). */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const redoEntry = this.captureEntry(entry);
    this.restoreEntry(entry);
    this.redoStack.push(redoEntry);
    return true;
  }

  /** Re-applies the change most recently reverted by `undo`. */
  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const undoEntry = this.captureEntry(entry);
    this.restoreEntry(entry);
    this.undoStack.push(undoEntry);
    return true;
  }

  /** Snapshot of the current undo/redo state. */
  get history(): { canUndo: boolean; canRedo: boolean; depth: number; redoDepth: number } {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      depth: this.undoStack.length,
      redoDepth: this.redoStack.length,
    };
  }

  /**
   * Records the current state of `chapterIndex` into the active history
   * entry. Called by every mutating method before it changes a chapter.
   */
  private recordChapterChange(chapterIndex: number): void {
    const chapter = this.book.chapters[chapterIndex];
    if (!chapter) return;
    if (this.pendingEntry) {
      // Already inside an explicit transaction.
      if (!this.pendingEntry.has(chapterIndex)) {
        this.pendingEntry.set(chapterIndex, snapshotChapter(chapter));
      }
      return;
    }
    const entry: HistoryEntry = new Map();
    entry.set(chapterIndex, snapshotChapter(chapter));
    this.commitHistoryEntry(entry);
  }

  private commitHistoryEntry(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Builds an entry mirroring `template` but capturing the *current* state. */
  private captureEntry(template: HistoryEntry): HistoryEntry {
    const entry: HistoryEntry = new Map();
    for (const chapterIndex of template.keys()) {
      const chapter = this.book.chapters[chapterIndex];
      if (chapter) entry.set(chapterIndex, snapshotChapter(chapter));
    }
    return entry;
  }

  /** Writes an entry's chapter state back onto the live book. */
  private restoreEntry(entry: HistoryEntry): void {
    for (const [chapterIndex, snapshot] of entry) {
      const chapter = this.book.chapters[chapterIndex];
      if (!chapter) continue;
      chapter.blocks = snapshot.blocks.map(cloneBlock);
      chapter.imageAssets = new Map(snapshot.imageAssets);
      syncParagraphsView(chapter);
    }
  }

  /** Parses an EPUB and starts an editing session. */
  static async load(data: ArrayBuffer): Promise<EditableEpub> {
    return new EditableEpub(await parseEditableEpubBook(data));
  }

  get title(): string {
    return this.book.title;
  }

  get author(): string | undefined {
    return this.book.author;
  }

  get chapters(): EditableEpubChapter[] {
    return this.book.chapters;
  }

  /**
   * Updates one paragraph's text and optional inline annotations.
   *
   * `paragraphIndex` is the position in the chapter's paragraph projection
   * (excluding image blocks). Image blocks remain untouched.
   */
  updateParagraph(
    chapterIndex: number,
    paragraphIndex: number,
    next: Partial<AnnotatedParagraph>,
  ): void {
    const chapter = requireChapter(this.book, chapterIndex);
    const block = findParagraphBlock(chapter, paragraphIndex);
    this.recordChapterChange(chapterIndex);
    applyParagraphUpdate(chapter, block, next);
  }

  /** Adds or replaces inline annotations for one paragraph. */
  setInlineAnnotations(
    chapterIndex: number,
    paragraphIndex: number,
    inlineAnnotations: readonly InlineAnnotation[],
  ): void {
    const chapter = requireChapter(this.book, chapterIndex);
    const block = findParagraphBlock(chapter, paragraphIndex);
    this.recordChapterChange(chapterIndex);
    applyInlineAnnotations(chapter, block, inlineAnnotations);
  }

  /**
   * Inserts a new paragraph block. Returns the generated `blockId`.
   *
   * `atIndex` is the position in the chapter's `blocks` array. Pass
   * `chapter.blocks.length` to append.
   */
  insertParagraph(
    chapterIndex: number,
    atIndex: number,
    paragraph: Omit<EditableParagraphBlock, 'kind' | 'id'>,
  ): string {
    const chapter = requireChapter(this.book, chapterIndex);
    this.recordChapterChange(chapterIndex);
    const block: EditableParagraphBlock = {
      kind: 'paragraph',
      id: nextBlockId(chapter),
      text: paragraph.text,
      inlineAnnotations: paragraph.inlineAnnotations ?? [],
      paragraphKind: paragraph.paragraphKind,
      headingLevel: paragraph.headingLevel,
    };
    chapter.blocks.splice(clamp(atIndex, 0, chapter.blocks.length), 0, block);
    syncParagraphsView(chapter);
    return block.id;
  }

  /** Removes a block (paragraph or image) by id. */
  deleteBlock(chapterIndex: number, blockId: string): void {
    const chapter = requireChapter(this.book, chapterIndex);
    const index = chapter.blocks.findIndex((b) => b.id === blockId);
    if (index < 0) throw new Error(`Missing block: ${blockId}`);
    const removed = chapter.blocks[index];
    this.recordChapterChange(chapterIndex);
    chapter.blocks.splice(index, 1);
    if (
      removed.kind === 'image' &&
      !chapter.blocks.some((b) => b.kind === 'image' && b.assetKey === removed.assetKey)
    ) {
      chapter.imageAssets.delete(removed.assetKey);
    }
    syncParagraphsView(chapter);
  }

  /**
   * Splits a paragraph block at `charIndex` (codepoint index in `text`).
   * Inline annotations that straddle the split are dropped.
   */
  splitParagraph(chapterIndex: number, blockId: string, charIndex: number): [string, string] {
    const chapter = requireChapter(this.book, chapterIndex);
    const index = chapter.blocks.findIndex((b) => b.id === blockId);
    if (index < 0) throw new Error(`Missing block: ${blockId}`);
    const target = chapter.blocks[index];
    if (target.kind !== 'paragraph')
      throw new Error(`Cannot split non-paragraph block: ${blockId}`);
    this.recordChapterChange(chapterIndex);

    const chars = [...target.text];
    const cut = clamp(charIndex, 0, chars.length);
    const leftText = chars.slice(0, cut).join('');
    const rightText = chars.slice(cut).join('');

    const leftAnns: InlineAnnotation[] = [];
    const rightAnns: InlineAnnotation[] = [];
    for (const ann of target.inlineAnnotations) {
      if (ann.endIndex <= cut) leftAnns.push(ann);
      else if (ann.startIndex >= cut)
        rightAnns.push({ ...ann, startIndex: ann.startIndex - cut, endIndex: ann.endIndex - cut });
      // Annotations spanning the cut are intentionally dropped.
    }

    const leftBlock: EditableParagraphBlock = {
      ...target,
      text: leftText,
      inlineAnnotations: leftAnns,
    };
    const rightBlock: EditableParagraphBlock = {
      kind: 'paragraph',
      id: nextBlockId(chapter),
      text: rightText,
      inlineAnnotations: rightAnns,
      paragraphKind: target.paragraphKind,
      headingLevel: target.headingLevel,
    };
    chapter.blocks.splice(index, 1, leftBlock, rightBlock);
    syncParagraphsView(chapter);
    return [leftBlock.id, rightBlock.id];
  }

  /**
   * Merges two adjacent paragraph blocks. `leftId` must immediately precede
   * `rightId`. Returns the surviving (left) block's id.
   */
  mergeParagraphs(chapterIndex: number, leftId: string, rightId: string): string {
    const chapter = requireChapter(this.book, chapterIndex);
    const leftIdx = chapter.blocks.findIndex((b) => b.id === leftId);
    const rightIdx = chapter.blocks.findIndex((b) => b.id === rightId);
    if (leftIdx < 0 || rightIdx < 0) throw new Error('Merge target missing');
    if (rightIdx !== leftIdx + 1) throw new Error('Merge requires adjacent blocks');
    const left = chapter.blocks[leftIdx];
    const right = chapter.blocks[rightIdx];
    if (left.kind !== 'paragraph' || right.kind !== 'paragraph')
      throw new Error('Merge requires two paragraph blocks');
    this.recordChapterChange(chapterIndex);

    const leftChars = [...left.text];
    const offset = leftChars.length;
    const merged: EditableParagraphBlock = {
      ...left,
      text: left.text + right.text,
      inlineAnnotations: [
        ...left.inlineAnnotations,
        ...right.inlineAnnotations.map((ann) => ({
          ...ann,
          startIndex: ann.startIndex + offset,
          endIndex: ann.endIndex + offset,
        })),
      ],
    };
    chapter.blocks.splice(leftIdx, 2, merged);
    syncParagraphsView(chapter);
    return merged.id;
  }

  /** Moves a block to a new index. */
  moveBlock(chapterIndex: number, blockId: string, toIndex: number): void {
    const chapter = requireChapter(this.book, chapterIndex);
    const from = chapter.blocks.findIndex((b) => b.id === blockId);
    if (from < 0) throw new Error(`Missing block: ${blockId}`);
    this.recordChapterChange(chapterIndex);
    const [block] = chapter.blocks.splice(from, 1);
    chapter.blocks.splice(clamp(toIndex, 0, chapter.blocks.length), 0, block);
    syncParagraphsView(chapter);
  }

  /**
   * Adds an image asset and inserts an image block referencing it. Accepts
   * both the new v0.5 shape (`{ filename, data, ... }`) and the v0.4 shape
   * (`{ href, mediaType, ... }`).
   *
   * Returns the generated `assetKey`.
   */
  addImage(chapterIndex: number, image: AddImageInput | EditableEpubImage): string {
    assertImageInputFilename(image);
    const chapter = requireChapter(this.book, chapterIndex);
    assertAddImageTarget(chapter, image);
    this.recordChapterChange(chapterIndex);
    return addEpubChapterImage(this.book, chapterIndex, image);
  }

  /** Removes an image block (and its asset, if no other block references it). */
  removeImage(chapterIndex: number, blockIdOrAssetKey: string): void {
    const chapter = requireChapter(this.book, chapterIndex);
    const matchingImage = chapter.blocks.find(
      (block) =>
        block.kind === 'image' &&
        (block.id === blockIdOrAssetKey || block.assetKey === blockIdOrAssetKey),
    ) as EditableImageBlock | undefined;
    if (!matchingImage) throw new Error(`Missing image block or asset: ${blockIdOrAssetKey}`);

    this.recordChapterChange(chapterIndex);
    const removedKey = matchingImage.assetKey;
    chapter.blocks = chapter.blocks.filter((block) => {
      if (block.kind !== 'image') return true;
      return block.id !== blockIdOrAssetKey && block.assetKey !== blockIdOrAssetKey;
    });
    if (
      removedKey &&
      !chapter.blocks.some((b) => b.kind === 'image' && b.assetKey === removedKey)
    ) {
      chapter.imageAssets.delete(removedKey);
    }
    syncParagraphsView(chapter);
  }

  /** Updates an image block's alt text, caption, or placement. */
  updateImage(
    chapterIndex: number,
    blockId: string,
    patch: Partial<Omit<EditableImageBlock, 'kind' | 'id' | 'assetKey'>>,
  ): void {
    const chapter = requireChapter(this.book, chapterIndex);
    const block = chapter.blocks.find((b) => b.id === blockId);
    if (!block || block.kind !== 'image') throw new Error(`Missing image block: ${blockId}`);
    this.recordChapterChange(chapterIndex);
    if (patch.alt !== undefined) block.alt = patch.alt;
    if (patch.caption !== undefined) block.caption = patch.caption;
    if (patch.placement !== undefined) block.placement = patch.placement;
  }

  /** Shortcut for {@link EditableEpub.updateImage} that only sets the caption. */
  setImageCaption(chapterIndex: number, blockId: string, caption: string | undefined): void {
    this.updateImage(chapterIndex, blockId, { caption });
  }

  /** Exports the current edited EPUB as an ArrayBuffer. */
  export(options?: EpubExportOptions): Promise<ArrayBuffer> {
    return exportEditableEpubBook(this.book, options);
  }
}

/**
 * Request passed to {@link EpubExportOptions.assetResolver}. The resolver
 * returns the bytes that should be embedded for `asset` inside the exported
 * EPUB ZIP.
 */
export interface AssetResolverRequest {
  /** Asset key inside the chapter's `imageAssets` map. */
  assetKey: string;
  /** The image asset to resolve. */
  asset: EditableImageAsset;
  /** External URL declared on the asset (mirrors `asset.url`). */
  url: string;
  /** Mirror of the export `AbortSignal`, when one was passed. */
  signal?: AbortSignal;
}

/**
 * Resolves an image asset to its bytes at export time. Called once per
 * {@link EditableImageAsset} that declares a `url` and has no inline `data`.
 * Throw to abort export; return a `Uint8Array` or `ArrayBuffer` containing
 * the image bytes.
 */
export type AssetResolver = (
  request: AssetResolverRequest,
) => Promise<Uint8Array | ArrayBuffer> | Uint8Array | ArrayBuffer;

/** Options shared by EPUB export entry points. */
export interface EpubExportOptions {
  /**
   * Notifies progress during export.
   *
   * - `phase: 'serialize'` — chapter XHTML rebuild and asset staging (including
   *   any asset URL resolution).
   * - `phase: 'zip'` — DEFLATE compression. `ratio` mirrors JSZip's
   *   `metadata.percent / 100`.
   */
  onProgress?: (phase: 'serialize' | 'zip', ratio: number) => void;
  /** AbortSignal — when triggered, export rejects with `AbortError`. */
  signal?: AbortSignal;
  /**
   * Resolves URL-only image assets ({@link EditableImageAsset.url} set,
   * `data` unset) into bytes at export time. When omitted, a default resolver
   * uses the runtime `fetch` with the export `signal`. Override to inject
   * auth headers, pull from non-HTTP sources (IndexedDB, S3 SDK), or short-
   * circuit with a cached buffer.
   */
  assetResolver?: AssetResolver;
}

/** Common fields of the {@link AddImageInput} variants. */
interface AddImageInputCommon {
  /**
   * Filename used inside the EPUB ZIP (e.g. `figure-01.png`). The returned
   * `assetKey` starts from this basename and is uniqued when needed. The image
   * is written to `OPS/Images/<assetKey>` by default.
   */
  filename: string;
  mediaType?: string;
  alt?: string;
  caption?: string;
  placement?: 'inline' | 'fullspread';
  /** Insert the block immediately after this block id. Defaults to the end. */
  afterBlockId?: string;
}

/** v0.5 shape for {@link EditableEpub.addImage} — inline bytes variant. */
export interface AddImageInputBytes extends AddImageInputCommon {
  /** Binary image data. */
  data: Uint8Array | ArrayBuffer;
  url?: never;
}

/** v0.5 shape for {@link EditableEpub.addImage} — external URL variant. */
export interface AddImageInputUrl extends AddImageInputCommon {
  /**
   * External URL. Bytes are fetched at export time via the
   * {@link EpubExportOptions.assetResolver} (or the runtime `fetch`).
   */
  url: string;
  data?: never;
}

/**
 * v0.5 input shape for {@link EditableEpub.addImage}. Pick the `data` variant
 * to embed bytes immediately, or the `url` variant to defer fetching until
 * export.
 */
export type AddImageInput = AddImageInputBytes | AddImageInputUrl;

/**
 * Parses an EPUB while retaining enough package metadata to export edits back
 * into an EPUB file.
 */
export async function parseEditableEpub(data: ArrayBuffer): Promise<EditableEpub> {
  return EditableEpub.load(data);
}

async function parseEditableEpubBook(data: ArrayBuffer): Promise<EditableEpubBook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    throw new Error(`Not a valid EPUB file: ${err instanceof Error ? err.message : String(err)}`);
  }
  const files = new Map<string, Uint8Array>();

  await Promise.all(
    Object.keys(zip.files).map(async (path) => {
      const file = zip.file(path);
      if (!file) return;
      files.set(path, await file.async('uint8array'));
    }),
  );

  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  const rootfilePath = extractRootfilePath(containerXml);
  const opfXml = await readZipText(zip, rootfilePath);
  const opfDir = rootfilePath.includes('/')
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1)
    : '';
  const { title, author, spineHrefs, manifestItems } = parseOpf(opfXml, opfDir);

  const chapters: EditableEpubChapter[] = [];
  for (const href of spineHrefs) {
    const xhtml = await readZipText(zip, href);
    let extracted: {
      blocks: EditableBlock[];
      imageAssets: Map<string, EditableImageAsset>;
      originalImageHrefs: string[];
    };
    try {
      extracted = extractEditableBlocks(xhtml, href, files, manifestItems);
    } catch (err) {
      throw new Error(
        `Failed to parse chapter XHTML: ${href} (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const chapterTitle = extractChapterTitle(xhtml);
    if (extracted.blocks.length > 0) {
      const chapter: EditableEpubChapter = {
        href,
        originalXhtml: xhtml,
        title: chapterTitle,
        blocks: extracted.blocks,
        imageAssets: extracted.imageAssets,
        originalImageHrefs: extracted.originalImageHrefs,
        paragraphs: [],
        paragraphRefs: undefined,
      };
      syncParagraphsView(chapter);
      chapters.push(chapter);
    }
  }

  return {
    title,
    author,
    chapters,
    packageData: { rootfilePath, opfDir, opfXml, files },
  };
}

/** Updates one paragraph's text and optional inline annotations. */
export function updateEpubParagraph(
  book: EditableEpubBook,
  chapterIndex: number,
  paragraphIndex: number,
  next: Partial<AnnotatedParagraph>,
): void {
  const chapter = requireChapter(book, chapterIndex);
  const block = findParagraphBlock(chapter, paragraphIndex);
  applyParagraphUpdate(chapter, block, next);
}

function applyParagraphUpdate(
  chapter: EditableEpubChapter,
  block: EditableParagraphBlock,
  next: Partial<AnnotatedParagraph>,
): void {
  if (next.text !== undefined) block.text = next.text;
  if (next.inlineAnnotations !== undefined) block.inlineAnnotations = next.inlineAnnotations;
  if (Object.hasOwn(next, 'headingLevel')) {
    if (next.headingLevel == null) {
      delete block.headingLevel;
      if (block.paragraphKind === 'heading') block.paragraphKind = 'body';
    } else {
      block.headingLevel = next.headingLevel;
      if (next.headingLevel >= 1) block.paragraphKind = 'heading';
    }
  }
  syncParagraphsView(chapter);
}

/** Adds or replaces inline annotations for one paragraph. */
export function setEpubInlineAnnotations(
  book: EditableEpubBook,
  chapterIndex: number,
  paragraphIndex: number,
  inlineAnnotations: readonly InlineAnnotation[],
): void {
  const chapter = requireChapter(book, chapterIndex);
  const block = findParagraphBlock(chapter, paragraphIndex);
  applyInlineAnnotations(chapter, block, inlineAnnotations);
}

function applyInlineAnnotations(
  chapter: EditableEpubChapter,
  block: EditableParagraphBlock,
  inlineAnnotations: readonly InlineAnnotation[],
): void {
  block.inlineAnnotations = inlineAnnotations;
  syncParagraphsView(chapter);
}

/**
 * Queues an image asset and inserts a corresponding image block.
 *
 * Accepts both the v0.5 `{ filename, ... }` shape and the v0.4
 * `{ href, mediaType, afterParagraph }` shape (deprecated). Returns the
 * `assetKey` used to reference the asset.
 */
export function addEpubChapterImage(
  book: EditableEpubBook,
  chapterIndex: number,
  image: AddImageInput | EditableEpubImage,
): string {
  const chapter = requireChapter(book, chapterIndex);
  const isV5 = isAddImageInput(image);

  const requestedFilename = assertImageInputFilename(image);
  const insertAt = resolveAddImageInsertIndex(chapter, image);
  const assetKey = uniqueAssetKey(requestedFilename, collectImageAssetKeys(book));
  const filename = assetKey;
  const mediaType = isV5
    ? (image.mediaType ?? mediaTypeFromFilename(requestedFilename))
    : (image as EditableEpubImage).mediaType;

  const asset: EditableImageAsset = { filename, mediaType };
  if (image.data !== undefined) asset.data = image.data;
  if (isV5 && (image as AddImageInputUrl).url !== undefined) {
    asset.url = (image as AddImageInputUrl).url;
  }
  if (asset.data === undefined && asset.url === undefined) {
    throw new Error('Image input must include either `data` or `url`');
  }
  chapter.imageAssets.set(assetKey, asset);

  const imageBlock: EditableImageBlock = {
    kind: 'image',
    id: nextBlockId(chapter),
    assetKey,
    alt: image.alt,
    caption: isV5 ? image.caption : undefined,
    placement: isV5 ? image.placement : undefined,
  };

  chapter.blocks.splice(insertAt, 0, imageBlock);
  syncParagraphsView(chapter);
  return assetKey;
}

function resolveAddImageInsertIndex(
  chapter: EditableEpubChapter,
  image: AddImageInput | EditableEpubImage,
): number {
  if (isAddImageInput(image) && image.afterBlockId) {
    const targetIdx = chapter.blocks.findIndex((b) => b.id === image.afterBlockId);
    if (targetIdx < 0) throw new Error(`Missing block: ${image.afterBlockId}`);
    return targetIdx + 1;
  }
  if (!isAddImageInput(image) && image.afterParagraph !== undefined) {
    const afterParagraph = (image as EditableEpubImage).afterParagraph as number;
    const paraIdx = nthParagraphBlockIndex(chapter, afterParagraph);
    if (paraIdx >= 0) return paraIdx + 1;
  }
  return chapter.blocks.length;
}

function assertAddImageTarget(
  chapter: EditableEpubChapter,
  image: AddImageInput | EditableEpubImage,
): void {
  resolveAddImageInsertIndex(chapter, image);
}

function isAddImageInput(image: AddImageInput | EditableEpubImage): image is AddImageInput {
  return 'filename' in image && image.filename !== undefined;
}

function assertImageInputFilename(image: AddImageInput | EditableEpubImage): string {
  const path = 'filename' in image ? image.filename : image.href;
  const filename = basename(path);
  if (!filename) throw new Error('Image filename must not be empty');
  return filename;
}

/**
 * Exports an edited EPUB. Existing files are preserved; edited chapter XHTML,
 * added image assets, and OPF manifest entries are written back.
 */
export async function exportEditableEpub(
  book: EditableEpub | EditableEpubBook,
  options?: EpubExportOptions,
): Promise<ArrayBuffer> {
  return exportEditableEpubBook(book instanceof EditableEpub ? book.book : book, options);
}

async function exportEditableEpubBook(
  book: EditableEpubBook,
  options: EpubExportOptions = {},
): Promise<ArrayBuffer> {
  const { onProgress, signal, assetResolver } = options;
  throwIfAborted(signal);

  const files = new Map(book.packageData.files);
  let opfXml = book.packageData.opfXml;
  const originalImageHrefs = new Set<string>();
  const retainedImageHrefs = new Set<string>();

  const total = Math.max(1, book.chapters.length);
  for (let i = 0; i < book.chapters.length; i++) {
    throwIfAborted(signal);
    const chapter = book.chapters[i];
    for (const href of chapter.originalImageHrefs ?? []) originalImageHrefs.add(href);
    files.set(chapter.href, encodeText(serializeChapterXhtml(chapter, book.packageData.opfDir)));

    for (const [assetKey, asset] of chapter.imageAssets) {
      throwIfAborted(signal);
      const assetHref = imageAssetHref(book, chapter, assetKey);
      retainedImageHrefs.add(assetHref);
      const bytes = await resolveAssetBytes(assetKey, asset, assetResolver, signal);
      files.set(assetHref, bytes);
      opfXml = ensureManifestItem(
        opfXml,
        asset.manifestId ?? manifestIdFromAssetKey(assetKey),
        asset.manifestHref ?? relativeZipPath(book.packageData.opfDir, assetHref),
        asset.mediaType ?? mediaTypeFromFilename(asset.filename),
      );
    }
    onProgress?.('serialize', (i + 1) / total);
  }

  for (const href of originalImageHrefs) {
    if (retainedImageHrefs.has(href)) continue;
    files.delete(href);
    opfXml = removeManifestItemByHref(
      opfXml,
      relativeZipPath(book.packageData.opfDir, href),
      href,
      book.packageData.opfDir,
    );
  }

  files.set(book.packageData.rootfilePath, encodeText(opfXml));

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', {
    binary: true,
    compression: 'STORE',
    createFolders: false,
  });
  for (const [path, bytes] of files) {
    if (path === 'mimetype') continue;
    zip.file(path, bytes);
  }
  return generateZip(zip, onProgress, signal);
}

/**
 * Generates the ZIP, forwarding JSZip's progress callback as a `'zip'`-phase
 * progress event and aborting promptly when `signal` triggers.
 */
export function generateZip(
  zip: JSZip,
  onProgress?: EpubExportOptions['onProgress'],
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const generation = zip.generateAsync(
    {
      type: 'arraybuffer',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
    },
    onProgress ? (metadata) => onProgress('zip', metadata.percent / 100) : undefined,
  );
  if (!signal) return generation;
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(makeAbortError(signal));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    generation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** Throws if the signal has already been aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw makeAbortError(signal);
}

function makeAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error('Export aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Resolves the bytes for one {@link EditableImageAsset}. When `asset.data` is
 * already present it is returned directly. Otherwise the asset must declare a
 * `url`, which is passed through `assetResolver` (or fetched via the global
 * `fetch` when no resolver is supplied).
 */
async function resolveAssetBytes(
  assetKey: string,
  asset: EditableImageAsset,
  resolver: AssetResolver | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (asset.data !== undefined) return toUint8Array(asset.data);
  if (!asset.url) {
    throw new Error(`Image asset "${assetKey}" has neither \`data\` nor \`url\``);
  }
  throwIfAborted(signal);
  const resolved = resolver
    ? await resolver({ assetKey, asset, url: asset.url, signal })
    : await defaultAssetFetch(asset.url, signal);
  return toUint8Array(resolved);
}

/**
 * Generic asset-bytes resolver used by both {@link EditableEpub.export} and
 * `EpubProject.export`. Picks `data` when present, otherwise routes through
 * `resolver` / `fetch` using `url`.
 *
 * Exposed for shared use across the EPUB module.
 */
export async function resolveAssetData(
  assetKey: string,
  asset: { data?: Uint8Array | ArrayBuffer; url?: string },
  resolver: AssetResolver | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  return resolveAssetBytes(assetKey, asset as EditableImageAsset, resolver, signal);
}

async function defaultAssetFetch(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`Failed to fetch image asset: ${url} (HTTP ${response.status})`);
  }
  return response.arrayBuffer();
}

/**
 * Rebuilds a chapter's XHTML from `blocks`. Pure `createElementNS` —
 * `innerHTML` is never invoked. Unrelated source attributes / asides from
 * the original document are dropped.
 */
function serializeChapterXhtml(chapter: EditableEpubChapter, opfDir: string): string {
  // Build XHTML from a clean DOMParser document. Using `createDocument`
  // (especially under happy-dom) auto-creates head/body which then duplicate
  // when we add our own — parsing an empty skeleton sidesteps that.
  const skeleton = `<?xml version="1.0" encoding="utf-8"?><html xmlns="${XHTML_NS}"><head/><body/></html>`;
  const doc = new DOMParser().parseFromString(skeleton, 'application/xhtml+xml');
  const html = doc.documentElement;
  const head = doc.getElementsByTagName('head')[0];
  const body = doc.getElementsByTagName('body')[0];

  // Clear any auto-populated children, then add a title node when known.
  while (head.firstChild) head.removeChild(head.firstChild);
  if (chapter.title) {
    const titleEl = doc.createElementNS(XHTML_NS, 'title');
    titleEl.appendChild(doc.createTextNode(chapter.title));
    head.appendChild(titleEl);
  }

  while (body.firstChild) body.removeChild(body.firstChild);
  for (const block of chapter.blocks) {
    body.appendChild(renderBlock(doc, chapter, block, opfDir));
  }

  // Strip any duplicate xmlns attributes the engine may have stamped onto
  // child elements; the root html already declares the namespace.
  for (const el of Array.from(html.getElementsByTagName('*'))) {
    if (el.getAttribute('xmlns') === XHTML_NS) el.removeAttribute('xmlns');
  }

  const xmlDecl = '<?xml version="1.0" encoding="utf-8"?>\n';
  return xmlDecl + new XMLSerializer().serializeToString(doc);
}

function renderBlock(
  doc: Document,
  chapter: EditableEpubChapter,
  block: EditableBlock,
  opfDir: string,
): Element {
  if (block.kind === 'image') return renderImageBlock(doc, chapter, block, opfDir);
  return renderParagraphBlock(doc, block);
}

function renderParagraphBlock(doc: Document, block: EditableParagraphBlock): Element {
  if (block.paragraphKind === 'sceneBreak') {
    return doc.createElementNS(XHTML_NS, 'hr');
  }
  const tagName = paragraphTagName(block);
  const el = doc.createElementNS(XHTML_NS, tagName);
  appendInlineContent(doc, el, block);
  return el;
}

function paragraphTagName(block: EditableParagraphBlock): string {
  if (block.paragraphKind === 'heading' && block.headingLevel) {
    return `h${Math.min(6, Math.max(1, block.headingLevel))}`;
  }
  if (block.headingLevel) {
    return `h${Math.min(6, Math.max(1, block.headingLevel))}`;
  }
  if (block.paragraphKind === 'blockquote') return 'blockquote';
  if (block.paragraphKind === 'pre') return 'pre';
  return 'p';
}

/** Appends a paragraph's text + inline annotations as DOM nodes. */
function appendInlineContent(doc: Document, parent: Element, block: EditableParagraphBlock): void {
  const chars = [...block.text];
  // Jukugo entries are layout-only; the segment-level ruby annotations carry
  // the serializable <ruby> markup.
  const annotations = block.inlineAnnotations
    .filter((ann) => ann.kind !== 'ruby' || ann.type !== 'jukugo')
    .slice()
    .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);

  let pos = 0;
  for (const ann of annotations) {
    if (ann.startIndex < pos || ann.endIndex <= ann.startIndex) continue;
    if (ann.startIndex > pos) {
      parent.appendChild(doc.createTextNode(chars.slice(pos, ann.startIndex).join('')));
    }
    parent.appendChild(
      renderInlineAnnotation(doc, ann, chars.slice(ann.startIndex, ann.endIndex).join('')),
    );
    pos = ann.endIndex;
  }
  if (pos < chars.length) {
    parent.appendChild(doc.createTextNode(chars.slice(pos).join('')));
  }
}

function renderInlineAnnotation(doc: Document, ann: InlineAnnotation, body: string): Node {
  switch (ann.kind) {
    case 'ruby': {
      const ruby = doc.createElementNS(XHTML_NS, 'ruby');
      ruby.appendChild(doc.createTextNode(body));
      const rt = doc.createElementNS(XHTML_NS, 'rt');
      rt.appendChild(doc.createTextNode(ann.rubyText));
      ruby.appendChild(rt);
      return ruby;
    }
    case 'emphasis': {
      const em = doc.createElementNS(XHTML_NS, 'em');
      em.setAttribute('class', 'mejiro-emphasis');
      em.setAttribute('data-style', ann.style ?? 'sesame');
      em.appendChild(doc.createTextNode(body));
      return em;
    }
    case 'tcy': {
      const span = doc.createElementNS(XHTML_NS, 'span');
      span.setAttribute('class', 'mejiro-tcy');
      span.appendChild(doc.createTextNode(body));
      return span;
    }
    case 'em': {
      const em = doc.createElementNS(XHTML_NS, 'em');
      em.appendChild(doc.createTextNode(body));
      return em;
    }
    case 'strong': {
      const strong = doc.createElementNS(XHTML_NS, 'strong');
      strong.appendChild(doc.createTextNode(body));
      return strong;
    }
    case 'link': {
      const anchor = doc.createElementNS(XHTML_NS, 'a');
      anchor.setAttribute('href', ann.href);
      if (ann.title) anchor.setAttribute('title', ann.title);
      anchor.appendChild(doc.createTextNode(body));
      return anchor;
    }
    case 'footnote': {
      const anchor = doc.createElementNS(XHTML_NS, 'a');
      anchor.setAttribute('class', 'mejiro-footnote-ref');
      anchor.setAttribute('href', `#${ann.noteId}`);
      anchor.appendChild(doc.createTextNode(body));
      return anchor;
    }
  }
}

function renderImageBlock(
  doc: Document,
  chapter: EditableEpubChapter,
  block: EditableImageBlock,
  opfDir: string,
): Element {
  const figure = doc.createElementNS(XHTML_NS, 'figure');
  if (block.placement) figure.setAttribute('data-placement', block.placement);
  const img = doc.createElementNS(XHTML_NS, 'img');
  img.setAttribute(
    'src',
    relativeZipPath(dirname(chapter.href), imageAssetHrefForBlock(chapter, block.assetKey, opfDir)),
  );
  img.setAttribute('alt', block.alt ?? '');
  figure.appendChild(img);
  if (block.caption) {
    const caption = doc.createElementNS(XHTML_NS, 'figcaption');
    caption.appendChild(doc.createTextNode(block.caption));
    figure.appendChild(caption);
  }
  return figure;
}

function imageAssetHref(
  book: EditableEpubBook,
  chapter: EditableEpubChapter,
  assetKey: string,
): string {
  const asset = chapter.imageAssets.get(assetKey);
  if (!asset) throw new Error(`Missing image asset: ${assetKey}`);
  if (asset.href) return asset.href;
  // Place new assets under the OPF directory so manifest hrefs are stable.
  return `${book.packageData.opfDir}Images/${asset.filename}`;
}

function imageAssetHrefForBlock(
  chapter: EditableEpubChapter,
  assetKey: string,
  opfDir: string,
): string {
  const asset = chapter.imageAssets.get(assetKey);
  if (!asset) throw new Error(`Missing image asset: ${assetKey}`);
  if (asset.href) return asset.href;
  return `${opfDir}Images/${asset.filename}`;
}

const EDITABLE_BLOCK_ELEMENTS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'li',
  'dt',
  'dd',
  'pre',
  'hr',
  'figure',
]);

function extractEditableBlocks(
  xhtml: string,
  chapterHref: string,
  files: Map<string, Uint8Array>,
  manifestItems: Map<string, ManifestItem>,
): {
  blocks: EditableBlock[];
  imageAssets: Map<string, EditableImageAsset>;
  originalImageHrefs: string[];
} {
  const doc = parseXml(stripStylesheetLinks(xhtml));
  const root = doc.body ?? doc.documentElement;
  const imageAssets = new Map<string, EditableImageAsset>();
  const originalImageHrefs = new Set<string>();
  const blocks: EditableBlock[] = [];

  const pushParagraph = (el: Element): void => {
    const paragraphs = extractRubyContent(wrapXhtml(new XMLSerializer().serializeToString(el)));
    for (const para of paragraphs) {
      if (!para.text) continue;
      const block: EditableParagraphBlock = {
        kind: 'paragraph',
        id: nextGeneratedBlockId(blocks),
        text: para.text,
        inlineAnnotations: para.inlineAnnotations,
      };
      const tag = el.localName.toLowerCase();
      if (para.headingLevel) {
        block.headingLevel = para.headingLevel;
        block.paragraphKind = 'heading';
      } else if (tag === 'blockquote') {
        block.paragraphKind = 'blockquote';
      } else if (tag === 'pre') {
        block.paragraphKind = 'pre';
      }
      blocks.push(block);
    }
  };

  const pushImage = (img: Element, figure?: Element): void => {
    const src = img.getAttribute('src');
    if (!src) return;
    const href = resolveZipPath(dirname(chapterHref), src);
    const data = files.get(href);
    if (!data) return;
    originalImageHrefs.add(href);
    const filename = basename(href);
    const manifestItem = manifestItems.get(href);
    const assetKey = uniqueAssetKey(filename, imageAssets);
    imageAssets.set(assetKey, {
      filename,
      href,
      manifestId: manifestItem?.id,
      manifestHref: manifestItem?.packageHref,
      data,
      mediaType: manifestItem?.mediaType ?? mediaTypeFromFilename(filename),
    });
    const block: EditableImageBlock = {
      kind: 'image',
      id: nextGeneratedBlockId(blocks),
      assetKey,
      alt: img.getAttribute('alt') ?? undefined,
      caption: figure
        ? firstChildElementByName(figure, 'figcaption')?.textContent?.trim()
        : undefined,
      placement: figure ? imagePlacement(figure.getAttribute('data-placement')) : undefined,
    };
    blocks.push(block);
  };

  const visit = (el: Element): void => {
    const tag = el.localName.toLowerCase();
    if (tag === 'figure') {
      const img = firstDescendantElementByName(el, 'img');
      if (img) {
        pushImage(img, el);
        return;
      }
    }
    if (tag === 'img') {
      pushImage(el);
      return;
    }
    if (tag === 'hr') {
      blocks.push({
        kind: 'paragraph',
        id: nextGeneratedBlockId(blocks),
        text: '',
        inlineAnnotations: [],
        paragraphKind: 'sceneBreak',
      });
      return;
    }

    const childBlocks = Array.from(el.children).filter((child) =>
      EDITABLE_BLOCK_ELEMENTS.has(child.localName.toLowerCase()),
    );
    if (EDITABLE_BLOCK_ELEMENTS.has(tag) && childBlocks.length === 0) {
      pushParagraph(el);
      return;
    }
    for (const child of Array.from(el.children)) visit(child);
  };

  visit(root);
  return { blocks, imageAssets, originalImageHrefs: [...originalImageHrefs] };
}

function stripStylesheetLinks(xhtml: string): string {
  return xhtml.replace(
    /<link\b(?=[^>]*\brel=["']?stylesheet["']?)[^>]*(?:\/>|>(?:\s*<\/link\s*>)?)/giu,
    '',
  );
}

function wrapXhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="${XHTML_NS}"><body>${body}</body></html>`;
}

function nextGeneratedBlockId(blocks: readonly EditableBlock[]): string {
  return `b-${blocks.length + 1}`;
}

function collectImageAssetKeys(book: EditableEpubBook): Set<string> {
  const keys = new Set<string>();
  for (const chapter of book.chapters) {
    for (const key of chapter.imageAssets.keys()) keys.add(key);
  }
  return keys;
}

function uniqueAssetKey(filename: string, assets: { has(key: string): boolean }): string {
  if (!assets.has(filename)) return filename;
  let index = 2;
  const extIndex = filename.lastIndexOf('.');
  const stem = extIndex > 0 ? filename.slice(0, extIndex) : filename;
  const ext = extIndex > 0 ? filename.slice(extIndex) : '';
  while (assets.has(`${stem}-${index}${ext}`)) index++;
  return `${stem}-${index}${ext}`;
}

function imagePlacement(value: string | null): EditableImageBlock['placement'] | undefined {
  if (value === 'inline' || value === 'fullspread') return value;
  return undefined;
}

function firstChildElementByName(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.children).find((el) => el.localName === localName);
}

function firstDescendantElementByName(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.getElementsByTagName('*')).find((el) => el.localName === localName);
}

/** Generates a unique block id within `chapter`. */
function nextBlockId(chapter: EditableEpubChapter): string {
  const used = new Set(chapter.blocks.map((b) => b.id));
  let n = chapter.blocks.length + 1;
  while (used.has(`b-${n}`)) n++;
  return `b-${n}`;
}

function requireChapter(book: EditableEpubBook, chapterIndex: number): EditableEpubChapter {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) throw new Error(`Missing chapter: ${chapterIndex}`);
  return chapter;
}

function findParagraphBlock(
  chapter: EditableEpubChapter,
  paragraphIndex: number,
): EditableParagraphBlock {
  let counter = 0;
  for (const block of chapter.blocks) {
    if (block.kind !== 'paragraph') continue;
    if (counter === paragraphIndex) return block;
    counter++;
  }
  throw new Error(`Missing paragraph: ${paragraphIndex}`);
}

function nthParagraphBlockIndex(chapter: EditableEpubChapter, paragraphIndex: number): number {
  let counter = 0;
  for (let i = 0; i < chapter.blocks.length; i++) {
    if (chapter.blocks[i].kind !== 'paragraph') continue;
    if (counter === paragraphIndex) return i;
    counter++;
  }
  return -1;
}

/** Regenerates the read-only `paragraphs` projection. */
function syncParagraphsView(chapter: EditableEpubChapter): void {
  chapter.paragraphs = chapter.blocks
    .filter((b): b is EditableParagraphBlock => b.kind === 'paragraph')
    .map((b) => ({
      text: b.text,
      inlineAnnotations: b.inlineAnnotations,
      ...(b.headingLevel ? { headingLevel: b.headingLevel } : {}),
    }));
}

function parseXml(xml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Failed to parse XML document');
  }
  return doc;
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing file in EPUB: ${path}`);
  return file.async('string');
}

function extractRootfilePath(containerXml: string): string {
  const doc = parseXml(containerXml);
  const fullPath = firstElementByName(doc, 'rootfile')?.getAttribute('full-path');
  if (!fullPath) throw new Error('Cannot find rootfile path in container.xml');
  return fullPath;
}

function extractChapterTitle(xhtml: string): string | undefined {
  const doc = parseXml(stripStylesheetLinks(xhtml));
  const explicitTitle = doc.getElementById('chapter-title');
  if (explicitTitle?.textContent?.trim()) return explicitTitle.textContent.trim();
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = firstElementByName(doc, tag);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return undefined;
}

function parseOpf(
  opfXml: string,
  opfDir: string,
): {
  title: string;
  author?: string;
  spineHrefs: string[];
  manifestItems: Map<string, ManifestItem>;
} {
  const doc = parseXml(opfXml);
  const title = findElementByName(doc, 'title')?.textContent?.trim() || 'Unknown Title';
  const author = findElementByName(doc, 'creator')?.textContent?.trim() || undefined;
  const manifest = new Map<string, string>();
  const manifestItems = new Map<string, ManifestItem>();
  const manifestEl = firstElementByName(doc, 'manifest');
  for (const item of childElementsByName(manifestEl, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      const resolvedHref = resolveZipPath(opfDir, href);
      manifest.set(id, resolvedHref);
      manifestItems.set(resolvedHref, {
        id,
        href: resolvedHref,
        packageHref: href,
        mediaType: item.getAttribute('media-type') ?? undefined,
      });
    }
  }
  const spineHrefs: string[] = [];
  const spineEl = firstElementByName(doc, 'spine');
  for (const itemref of childElementsByName(spineEl, 'itemref')) {
    const idref = itemref.getAttribute('idref');
    const href = idref ? manifest.get(idref) : undefined;
    if (href) spineHrefs.push(href);
  }
  return { title, author, spineHrefs, manifestItems };
}

interface ManifestItem {
  id: string;
  href: string;
  packageHref: string;
  mediaType?: string;
}

function ensureManifestItem(opfXml: string, id: string, href: string, mediaType: string): string {
  const doc = parseXml(opfXml);
  const manifest = firstElementByName(doc, 'manifest');
  if (!manifest) throw new Error('Cannot find OPF manifest');
  const items = childElementsByName(manifest, 'item');
  const existing = items.find((item) => item.getAttribute('href') === href);
  if (existing) {
    existing.setAttribute('media-type', mediaType);
  } else {
    // Inherit the manifest's namespace so the new <item> does not pick up a
    // stray xmlns from the document defaults (e.g. happy-dom defaulting to
    // XHTML for `createElement` on XML documents).
    const itemName = manifest.prefix ? `${manifest.prefix}:item` : 'item';
    const item = doc.createElementNS(manifest.namespaceURI, itemName);
    item.setAttribute(
      'id',
      uniqueManifestId(
        id,
        items.map((existingItem) => existingItem.getAttribute('id') ?? undefined),
      ),
    );
    item.setAttribute('href', href);
    item.setAttribute('media-type', mediaType);
    manifest.appendChild(item);
  }
  return new XMLSerializer().serializeToString(doc);
}

function removeManifestItemByHref(
  opfXml: string,
  href: string,
  resolvedHref: string,
  opfDir: string,
): string {
  const doc = parseXml(opfXml);
  const manifest = firstElementByName(doc, 'manifest');
  if (!manifest) return opfXml;
  const existing = childElementsByName(manifest, 'item').find(
    (item) =>
      item.getAttribute('href') === href ||
      resolveZipPath(opfDir, item.getAttribute('href') ?? '') === resolvedHref,
  );
  existing?.parentNode?.removeChild(existing);
  return new XMLSerializer().serializeToString(doc);
}

function firstElementByName(parent: Document | Element, localName: string): Element | undefined {
  return Array.from(parent.getElementsByTagName('*')).find(
    (el) => el.localName === localName || el.tagName === localName,
  );
}

function childElementsByName(parent: Element | undefined, localName: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.children).filter(
    (el) => el.localName === localName || el.tagName === localName,
  );
}

function findElementByName(doc: Document, localName: string): Element | undefined {
  const nsEl = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', localName)[0];
  if (nsEl) return nsEl;
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.localName === localName || el.tagName === `dc:${localName}`) return el;
  }
  return undefined;
}

function resolveZipPath(baseDir: string, href: string): string {
  const hrefPath = href.split('#', 1)[0].split('?', 1)[0];
  let decodedHref: string;
  try {
    decodedHref = decodeURIComponent(hrefPath);
  } catch {
    throw new Error(`Invalid EPUB href: ${href}`);
  }
  const parts = `${baseDir}${decodedHref}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/');
}

function dirname(path: string): string {
  return path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
}

function basename(path: string): string {
  return path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path;
}

function relativeZipPath(fromDir: string, target: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const to = target.split('/').filter(Boolean);
  while (from.length > 0 && to.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return `${'../'.repeat(from.length)}${to.join('/')}`;
}

function manifestIdFromAssetKey(assetKey: string): string {
  return `img-${assetKey.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function uniqueManifestId(base: string, existing: readonly (string | undefined)[]): string {
  const used = new Set(existing.filter((id): id is string => Boolean(id)));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

function mediaTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface ChapterSnapshot {
  blocks: EditableBlock[];
  imageAssets: Map<string, EditableImageAsset>;
}

type HistoryEntry = Map<number, ChapterSnapshot>;

function snapshotChapter(chapter: EditableEpubChapter): ChapterSnapshot {
  return {
    blocks: chapter.blocks.map(cloneBlock),
    imageAssets: new Map(chapter.imageAssets),
  };
}

function cloneBlock(block: EditableBlock): EditableBlock {
  if (block.kind === 'paragraph') {
    return {
      ...block,
      inlineAnnotations: block.inlineAnnotations.map((ann) => ({ ...ann })),
    };
  }
  return { ...block };
}
