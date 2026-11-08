import JSZip from 'jszip';
import { MejiroError } from '../errors.js';
import type { BinaryInput, HeadingLevel, InlineAnnotation } from '../types.js';
import {
  CHAPTER_TITLE_ID,
  chapterTitleCarrierMarkup,
  figureMarkup,
  inlineContentMarkup,
  sanitizeXmlText,
  XHTML_NS,
} from './chapter-markup.js';
import {
  assetSourceOf,
  attachAssetSource,
  attachPackageData,
  chapterStateOf,
  cloneEditableBlock,
  cloneEditableEpubBook,
  packageDataOf,
  writable,
} from './clone.js';
import {
  assertBinaryInput,
  assertEpubInputSize,
  EpubExpansionBudget,
  type EpubParseOptions,
  resolveEpubParseLimits,
  throwIfAborted,
} from './limits.js';
import {
  mediaTypeFromPath,
  relativeZipPath,
  uniqueManifestId,
  zipPathToHref,
} from './package-paths.js';
import {
  collectTocTitles,
  extractChapterTitleOrUndefined,
  type OpfManifestItem,
  openEpubArchive,
  packageDocumentLocation,
  parseOpfPackage,
  renderedText,
  resolveZipPath,
} from './parser.js';
import { contentBody, extractRubyContent, isNonRenderedElement } from './ruby-extractor.js';
import type {
  EditableBlock,
  EditableEpubBook,
  EditableEpubChapter,
  EditableImageAsset,
  EditableImageBlock,
  EditableParagraphBlock,
  NewParagraph,
  ParagraphPatch,
} from './types.js';
import {
  assertEpubDomAvailable,
  extractStylesheetLinks,
  stripStylesheetLinks,
} from './xml-utils.js';

/** Undo/redo state of an {@link EditableEpub}, read from {@link EditableEpub.history}. */
export interface EditHistoryState {
  /** Whether {@link EditableEpub.undo} has a change to revert. */
  readonly canUndo: boolean;
  /** Whether {@link EditableEpub.redo} has a reverted change to re-apply. */
  readonly canRedo: boolean;
  /** Number of changes that can be undone. */
  readonly depth: number;
  /** Number of reverted changes that can be re-applied. */
  readonly redoDepth: number;
}

/** The two adjacent paragraphs {@link EditableEpub.mergeParagraphs} joins. */
export interface MergeParagraphsInput {
  /** Id of the first paragraph; it survives the merge. */
  leftId: string;
  /** Id of the paragraph immediately after it; it is removed. */
  rightId: string;
}

/** Creates a session; the constructor stays private to the class. */
let openSession: (epub: EditableEpubBook) => EditableEpub;

/**
 * Editing session over a parsed EPUB: block-level edits with undo/redo, and
 * export back to an EPUB file. Created by {@link parseEditableEpub}.
 *
 * Existing blocks are addressed by `(chapterIndex, blockId)`; an index appears
 * only where a block is to be put. An unknown chapter index or block id, or the
 * id of a block of the wrong kind, throws `RangeError`. An edit that throws
 * changes and records nothing.
 */
export class EditableEpub {
  static {
    openSession = (epub) => new EditableEpub(epub);
  }

  /**
   * The live document model. Exposed for reading and for handing to a renderer
   * through {@link cloneEditableEpubBook}; changing it directly bypasses the
   * undo history and the change notifications, so route edits through the
   * session's methods.
   */
  readonly epub: EditableEpubBook;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private historyLimit = 50;
  private txnDepth = 0;
  private pendingEntry: HistoryEntry | undefined;
  private changePending = false;
  private listeners = new Set<() => void>();

  private constructor(epub: EditableEpubBook) {
    this.epub = epub;
  }

  /**
   * Groups a sequence of edits into one history entry and one change
   * notification. Nested calls fold into the outermost transaction. If `fn`
   * throws, the outermost transaction rewinds every edit made inside it and
   * rethrows.
   *
   * `fn` runs synchronously, and a callback returning a promise is rejected by
   * the type: edits made after its first `await` would land outside the
   * transaction.
   *
   * @example
   * ```ts
   * editor.transaction(() => {
   *   const right = editor.splitParagraph(0, blockId, 4);
   *   editor.updateParagraph(0, right.id, { paragraphKind: 'blockquote' });
   * });
   * ```
   *
   * @param fn - The edits to group.
   * @returns What `fn` returns.
   */
  transaction<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
    if (this.txnDepth === 0) this.pendingEntry = new Map();
    this.txnDepth++;
    try {
      const result = fn() as T;
      this.txnDepth--;
      if (this.txnDepth === 0) {
        const entry = this.pendingEntry;
        this.pendingEntry = undefined;
        if (entry && entry.size > 0) this.commitHistoryEntry(entry);
        this.flushChange();
      }
      return result;
    } catch (err) {
      this.txnDepth--;
      if (this.txnDepth === 0) {
        if (this.pendingEntry) this.restoreEntry(this.pendingEntry);
        this.pendingEntry = undefined;
        this.changePending = false;
      }
      throw err;
    }
  }

  /**
   * Reverts the last committed change (or transaction).
   *
   * @returns Whether there was a change to revert.
   */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const redoEntry = this.captureEntry(entry);
    this.restoreEntry(entry);
    this.redoStack.push(redoEntry);
    this.changed();
    return true;
  }

  /**
   * Re-applies the change most recently reverted by {@link EditableEpub.undo}.
   *
   * @returns Whether there was a reverted change to re-apply.
   */
  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const undoEntry = this.captureEntry(entry);
    this.restoreEntry(entry);
    this.undoStack.push(undoEntry);
    this.changed();
    return true;
  }

  /** Snapshot of the current undo/redo state. */
  get history(): EditHistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      depth: this.undoStack.length,
      redoDepth: this.redoStack.length,
    };
  }

  /**
   * Calls `listener` after every change to the document: each edit, each
   * completed transaction (once), and each undo or redo. Read what changed from
   * {@link EditableEpub.epub}.
   *
   * A listener that throws does not stop the others; its error is rethrown on
   * a microtask.
   *
   * @param listener - Called with no arguments after each change.
   * @returns A function that removes the listener. Idempotent.
   */
  subscribe(listener: () => void): () => void {
    const entry = () => listener();
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  /** Book title read from the package metadata. */
  get title(): string {
    return this.epub.title;
  }

  /** Primary creator from the package metadata, or undefined when absent. */
  get author(): string | undefined {
    return this.epub.author;
  }

  /**
   * Chapters in spine order. The live array, not a copy — it reflects
   * subsequent edits.
   */
  get chapters(): readonly EditableEpubChapter[] {
    return this.epub.chapters;
  }

  /**
   * Inserts a paragraph block at `index` in the chapter's `blocks`; pass
   * `chapter.blocks.length` to append. An out-of-range index is clamped.
   * Annotations outside the paragraph's text are dropped.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param index - Position in the chapter's `blocks` to insert at.
   * @param paragraph - The paragraph to insert.
   * @returns The stored block, carrying its generated `id`.
   * @throws {RangeError} When the chapter does not exist, `headingLevel` is
   *   not an integer from 1 to 6, or `paragraphKind` is unknown.
   * @throws {TypeError} When `text` is not a string, a heading has no
   *   `headingLevel`, a non-heading has one, or a scene break carries text.
   */
  insertParagraph(
    chapterIndex: number,
    index: number,
    paragraph: NewParagraph,
  ): EditableParagraphBlock {
    const chapter = requireChapter(this.epub, chapterIndex);
    const block = newParagraphBlock(nextBlockId(chapter), paragraph);
    this.recordChapterChange(chapterIndex);
    writable(chapter).blocks.splice(clamp(index, 0, chapter.blocks.length), 0, block);
    this.changed();
    return block;
  }

  /**
   * Updates one paragraph's text, annotations, heading level or kind.
   *
   * When `text` changes without new `inlineAnnotations`, the existing
   * annotations are re-anchored onto the new text: each one either keeps
   * covering exactly the same base characters or is dropped. Annotations
   * passed in explicitly are indexed into the new text, and any that fall
   * outside it are dropped.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param blockId - Id of the paragraph block.
   * @param patch - The change; see {@link ParagraphPatch}.
   * @throws {RangeError} When the chapter or paragraph does not exist, a
   *   heading level is not an integer from 1 to 6, or `paragraphKind` is unknown.
   * @throws {TypeError} When a scene break is given text without a new kind, a
   *   non-heading is given a `headingLevel`, or a new heading has none.
   */
  updateParagraph(chapterIndex: number, blockId: string, patch: ParagraphPatch): void {
    const chapter = requireChapter(this.epub, chapterIndex);
    const block = requireParagraphBlock(chapter, blockId);
    const updated = patchedParagraph(block, patch);
    this.recordChapterChange(chapterIndex);
    storeParagraph(block, updated);
    this.changed();
  }

  /**
   * Replaces the inline annotations of one paragraph. Annotations that do not
   * fall inside the paragraph's current text are dropped.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param blockId - Id of the paragraph block.
   * @param inlineAnnotations - The new annotations, indexed into the text.
   * @throws {RangeError} When the chapter or paragraph does not exist.
   */
  setInlineAnnotations(
    chapterIndex: number,
    blockId: string,
    inlineAnnotations: readonly InlineAnnotation[],
  ): void {
    const chapter = requireChapter(this.epub, chapterIndex);
    const block = requireParagraphBlock(chapter, blockId);
    const updated = paragraphBlock(
      block.id,
      block.text,
      inlineAnnotations,
      block.paragraphKind,
      block.headingLevel,
    );
    this.recordChapterChange(chapterIndex);
    storeParagraph(block, updated);
    this.changed();
  }

  /**
   * Removes a block, paragraph or image. Removing the last image block that
   * references an asset removes the asset too.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param blockId - Id of the block.
   * @throws {RangeError} When the chapter or block does not exist.
   */
  deleteBlock(chapterIndex: number, blockId: string): void {
    const chapter = writable(requireChapter(this.epub, chapterIndex));
    const index = requireBlockIndex(chapter, blockId);
    const removed = chapter.blocks[index];
    this.recordChapterChange(chapterIndex);
    chapter.blocks.splice(index, 1);
    if (
      removed.kind === 'image' &&
      !chapter.blocks.some((b) => b.kind === 'image' && b.assetKey === removed.assetKey)
    ) {
      chapter.imageAssets.delete(removed.assetKey);
    }
    this.changed();
  }

  /**
   * Splits a paragraph block at `charIndex` (code point index in `text`). The
   * block keeps its id and the text before the split; a new block after it
   * takes the rest. A fractional index is truncated and an out-of-range one
   * clamped. Inline annotations that straddle the split are dropped.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param blockId - Id of the paragraph block.
   * @param charIndex - Code point index to split at.
   * @returns The new block holding the text after the split.
   * @throws {RangeError} When the chapter or paragraph does not exist, or
   *   `charIndex` is not a finite number.
   */
  splitParagraph(chapterIndex: number, blockId: string, charIndex: number): EditableParagraphBlock {
    const chapter = writable(requireChapter(this.epub, chapterIndex));
    const index = requireBlockIndex(chapter, blockId);
    const target = chapter.blocks[index];
    if (target.kind !== 'paragraph') {
      throw new RangeError(`Cannot split non-paragraph block: ${blockId}`);
    }
    if (!Number.isFinite(charIndex)) throw new RangeError(`Invalid split index: ${charIndex}`);

    const chars = [...target.text];
    const cut = clamp(Math.trunc(charIndex), 0, chars.length);
    const leftAnns: InlineAnnotation[] = [];
    const rightAnns: InlineAnnotation[] = [];
    for (const ann of target.inlineAnnotations) {
      if (ann.endIndex <= cut) leftAnns.push(ann);
      else if (ann.startIndex >= cut)
        rightAnns.push({ ...ann, startIndex: ann.startIndex - cut, endIndex: ann.endIndex - cut });
      // Annotations spanning the cut are intentionally dropped.
    }

    const leftBlock = paragraphBlock(
      target.id,
      chars.slice(0, cut).join(''),
      leftAnns,
      target.paragraphKind,
      target.headingLevel,
    );
    const rightBlock = paragraphBlock(
      nextBlockId(chapter),
      chars.slice(cut).join(''),
      rightAnns,
      target.paragraphKind,
      target.headingLevel,
    );
    this.recordChapterChange(chapterIndex);
    chapter.blocks.splice(index, 1, leftBlock, rightBlock);
    this.changed();
    return rightBlock;
  }

  /**
   * Merges two adjacent paragraph blocks into the left one, which keeps its
   * id and kind.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param pair - The paragraph and the one immediately after it.
   * @returns The merged block.
   * @throws {RangeError} When the chapter or either block does not exist, a
   *   block is not a paragraph, or `rightId` does not immediately follow `leftId`.
   * @throws {TypeError} When the left block is a scene break and the right
   *   one carries text.
   */
  mergeParagraphs(chapterIndex: number, pair: MergeParagraphsInput): EditableParagraphBlock {
    const chapter = writable(requireChapter(this.epub, chapterIndex));
    const leftIndex = requireBlockIndex(chapter, pair.leftId);
    const rightIndex = requireBlockIndex(chapter, pair.rightId);
    if (rightIndex !== leftIndex + 1) throw new RangeError('Merge requires adjacent blocks');
    const left = chapter.blocks[leftIndex];
    const right = chapter.blocks[rightIndex];
    if (left.kind !== 'paragraph' || right.kind !== 'paragraph') {
      throw new RangeError('Merge requires two paragraph blocks');
    }

    const offset = [...left.text].length;
    const merged = paragraphBlock(
      left.id,
      left.text + right.text,
      [
        ...left.inlineAnnotations,
        ...right.inlineAnnotations.map((ann) => ({
          ...ann,
          startIndex: ann.startIndex + offset,
          endIndex: ann.endIndex + offset,
        })),
      ],
      left.paragraphKind,
      left.headingLevel,
    );
    this.recordChapterChange(chapterIndex);
    chapter.blocks.splice(leftIndex, 2, merged);
    this.changed();
    return merged;
  }

  /**
   * Moves a block to `toIndex` in the chapter's `blocks`; an out-of-range
   * index is clamped.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param blockId - Id of the block.
   * @param toIndex - Position the block ends up at.
   * @throws {RangeError} When the chapter or block does not exist.
   */
  moveBlock(chapterIndex: number, blockId: string, toIndex: number): void {
    const chapter = writable(requireChapter(this.epub, chapterIndex));
    const from = requireBlockIndex(chapter, blockId);
    this.recordChapterChange(chapterIndex);
    const [block] = chapter.blocks.splice(from, 1);
    chapter.blocks.splice(clamp(toIndex, 0, chapter.blocks.length), 0, block);
    this.changed();
  }

  /**
   * Adds an image asset and inserts an image block referencing it. The bytes
   * of a `data` input are copied, so the input can be reused.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param image - The image, carrying its bytes or the URL to fetch them from
   *   at export time.
   * @returns The stored image block; `block.assetKey` names the new asset,
   *   uniqued against the files and assets the book already has.
   * @throws {RangeError} When the chapter or `afterBlockId` does not exist, or
   *   `filename` has no basename.
   * @throws {TypeError} When the input carries neither `data` nor `url`.
   */
  addImage(chapterIndex: number, image: AddImageInput): EditableImageBlock {
    const chapter = writable(requireChapter(this.epub, chapterIndex));
    const requestedFilename = imageInputFilename(image);
    const data = imageInputData(image);
    const insertAt = addImageInsertIndex(chapter, image);
    const assetKey = uniqueAssetKey(requestedFilename, collectImageAssetKeys(this.epub));
    const mediaType = image.mediaType ?? mediaTypeFromPath(requestedFilename);
    const asset: EditableImageAsset = data
      ? { filename: assetKey, mediaType, data }
      : { filename: assetKey, mediaType, url: image.url as string };
    const block: EditableImageBlock = { kind: 'image', id: nextBlockId(chapter), assetKey };
    if (image.alt !== undefined) block.alt = image.alt;
    if (image.caption !== undefined) block.caption = image.caption;
    if (image.placement !== undefined) block.placement = image.placement;

    this.recordChapterChange(chapterIndex);
    chapter.imageAssets.set(assetKey, asset);
    chapter.blocks.splice(insertAt, 0, block);
    this.changed();
    return block;
  }

  /**
   * Removes an image asset together with every image block that references
   * it, in every chapter holding an asset under `assetKey`. Recorded as one
   * history entry.
   *
   * @param assetKey - Key of the asset in the chapters' `imageAssets`.
   * @throws {RangeError} When no chapter holds an asset under `assetKey`.
   */
  removeImageAsset(assetKey: string): void {
    const holders = this.epub.chapters.flatMap((chapter, index) =>
      chapter.imageAssets.has(assetKey) ? [index] : [],
    );
    if (holders.length === 0) throw new RangeError(`Missing image asset: ${assetKey}`);
    this.transaction(() => {
      for (const index of holders) {
        this.recordChapterChange(index);
        const chapter = writable(this.epub.chapters[index]);
        chapter.blocks = chapter.blocks.filter(
          (block) => !(block.kind === 'image' && block.assetKey === assetKey),
        );
        chapter.imageAssets.delete(assetKey);
      }
      this.changed();
    });
  }

  /**
   * Updates an image block's alt text, caption, or placement. A key present
   * with `undefined` removes that field; absent keys are left untouched.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param blockId - Id of the image block.
   * @param patch - Fields to change.
   * @throws {RangeError} When the chapter or image block does not exist.
   */
  updateImage(
    chapterIndex: number,
    blockId: string,
    patch: Partial<Omit<EditableImageBlock, 'kind' | 'id' | 'assetKey'>>,
  ): void {
    const chapter = requireChapter(this.epub, chapterIndex);
    const block = chapter.blocks[requireBlockIndex(chapter, blockId)];
    if (block.kind !== 'image') throw new RangeError(`Not an image block: ${blockId}`);
    const changed = IMAGE_PATCH_FIELDS.filter(
      (field) => Object.hasOwn(patch, field) && patch[field] !== block[field],
    );
    if (changed.length === 0) return;
    this.recordChapterChange(chapterIndex);
    for (const field of changed) {
      // A key present with `undefined` clears the field.
      if (patch[field] === undefined) delete block[field];
      else Object.assign(block, { [field]: patch[field] });
    }
    this.changed();
  }

  /**
   * Sets or clears the caption of an image block.
   *
   * @param chapterIndex - Zero-based chapter index.
   * @param blockId - Id of the image block.
   * @param caption - The new caption, or `null` to remove it.
   * @throws {RangeError} When the chapter or image block does not exist.
   */
  setImageCaption(chapterIndex: number, blockId: string, caption: string | null): void {
    this.updateImage(chapterIndex, blockId, { caption: caption ?? undefined });
  }

  /**
   * Exports the edited EPUB. Unedited files are written back as they were;
   * edited chapter XHTML, added image assets and their OPF manifest entries are
   * written out.
   *
   * The document is captured synchronously on entry, so an edit made while the
   * export is still awaiting asset bytes lands in the next export, never
   * part-way through this one.
   *
   * @param options - Progress, cancellation, asset resolution and watermark.
   * @returns The EPUB file.
   * @throws {MejiroError} `epub-unsupported-content` when an edited chapter
   *   holds content the block model cannot write back, `asset-fetch-failed`
   *   when the default fetch of a URL-only asset fails.
   * @throws {TypeError} When `options.signal` is not an `AbortSignal`.
   * @throws The `signal.reason` when `options.signal` aborts, and whatever
   *   `options.assetResolver` throws.
   */
  export(options?: EditableEpubExportOptions): Promise<Uint8Array<ArrayBuffer>> {
    return exportEditableEpubBook(this.epub, options);
  }

  private changed(): void {
    if (this.txnDepth > 0) this.changePending = true;
    else this.notify();
  }

  private flushChange(): void {
    if (!this.changePending) return;
    this.changePending = false;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  /**
   * Records the current state of `chapterIndex` into the active history
   * entry. Called by every mutating method before it changes a chapter.
   */
  private recordChapterChange(chapterIndex: number): void {
    const chapter = this.epub.chapters[chapterIndex];
    if (!chapter) return;
    if (this.pendingEntry) {
      // Already inside an explicit transaction.
      if (!this.pendingEntry.has(chapterIndex)) {
        this.pendingEntry.set(chapterIndex, snapshotChapter(chapter));
      }
      chapterStateOf(chapter).dirty = true;
      return;
    }
    const entry: HistoryEntry = new Map();
    entry.set(chapterIndex, snapshotChapter(chapter));
    this.commitHistoryEntry(entry);
    chapterStateOf(chapter).dirty = true;
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
      const chapter = this.epub.chapters[chapterIndex];
      if (chapter) entry.set(chapterIndex, snapshotChapter(chapter));
    }
    return entry;
  }

  /** Writes an entry's chapter state back onto the live book. */
  private restoreEntry(entry: HistoryEntry): void {
    for (const [chapterIndex, snapshot] of entry) {
      const chapter = this.epub.chapters[chapterIndex];
      if (!chapter) continue;
      writable(chapter).blocks = snapshot.blocks.map(cloneEditableBlock);
      writable(chapter).imageAssets = new Map(snapshot.imageAssets);
      chapterStateOf(chapter).dirty = snapshot.dirty;
    }
  }
}

const IMAGE_PATCH_FIELDS = ['alt', 'caption', 'placement'] as const;

/**
 * Request passed to {@link EpubExportOptions.assetResolver} for one asset that
 * declares a URL and no inline bytes.
 */
export interface AssetResolverRequest {
  /** URL declared on the asset. */
  url: string;
  /** ZIP path the resolved bytes are written to inside the exported EPUB. */
  href: string;
  /** Media type declared on the asset, when it has one. */
  mediaType?: string;
  /** The export's `AbortSignal`, when one was passed. */
  signal?: AbortSignal;
}

/**
 * Resolves an asset to its bytes at export time. Called once per asset that
 * declares a `url` and has no inline `data`. Throw to abort the export.
 */
export type AssetResolver = (request: AssetResolverRequest) => Promise<BinaryInput> | BinaryInput;

/** Options shared by EPUB export entry points. */
export interface EpubExportOptions {
  /**
   * Notifies progress during export. `ratio` runs from 0 to 1 within each
   * phase and starts again from 0 when the next phase begins. Not called once
   * the export has been aborted.
   *
   * - `phase: 'serialize'` — chapter XHTML rebuild and asset staging (including
   *   any asset URL resolution), advancing per chapter.
   * - `phase: 'zip'` — DEFLATE compression.
   */
  onProgress?: (phase: 'serialize' | 'zip', ratio: number) => void;
  /**
   * Cancels the export. The returned promise rejects with `signal.reason` (an
   * `AbortError` `DOMException` unless the caller passed its own reason); a
   * signal that is already aborted rejects without exporting.
   */
  signal?: AbortSignal;
  /**
   * Resolves URL-only image assets into bytes at export time. When omitted, a
   * default resolver uses the runtime `fetch` with the export `signal`.
   * Override to inject auth headers, pull from non-HTTP sources (IndexedDB, S3
   * SDK), or short-circuit with a cached buffer.
   */
  assetResolver?: AssetResolver;
}

/** Options of {@link EditableEpub.export}. */
export interface EditableEpubExportOptions extends EpubExportOptions {
  /**
   * Text of a paragraph inserted at the top of every exported chapter. Only
   * the exported copy carries it; the edited document is left as it is. An
   * empty string inserts nothing.
   */
  watermark?: string;
}

/** Common fields of the {@link AddImageInput} variants. */
export interface AddImageInputCommon {
  /**
   * Filename used inside the EPUB ZIP (e.g. `figure-01.png`). The returned
   * block's `assetKey` starts from this basename and is uniqued when needed.
   * The image is written to `<OPF directory>/Images/<assetKey>`.
   */
  filename: string;
  /**
   * OPF media type for the manifest entry. Inferred from the `filename`
   * extension when omitted.
   */
  mediaType?: string;
  /** Alternative text for the generated `<img>`. */
  alt?: string;
  /** Text for the generated `<figcaption>`. Omitted produces no caption element. */
  caption?: string;
  /**
   * Layout hint stored verbatim on the resulting block for renderers to act on;
   * it does not change the exported markup. Left unset when omitted, so the
   * renderer's own default applies.
   */
  placement?: 'inline' | 'fullspread';
  /**
   * Insert the block immediately after this block id. Defaults to the end of
   * the chapter.
   */
  afterBlockId?: string;
}

/** {@link AddImageInput} variant carrying the image bytes. */
export interface AddImageInputBytes extends AddImageInputCommon {
  /** Image bytes. A `Uint8Array` is read through its own view. */
  data: BinaryInput;
  /** Never set on this variant — it is what makes the union discriminate. */
  url?: never;
}

/** {@link AddImageInput} variant naming a URL to fetch the bytes from. */
export interface AddImageInputUrl extends AddImageInputCommon {
  /**
   * External URL. Bytes are fetched at export time via the
   * {@link EpubExportOptions.assetResolver} (or the runtime `fetch`).
   */
  url: string;
  /** Never set on this variant — it is what makes the union discriminate. */
  data?: never;
}

/**
 * Input of {@link EditableEpub.addImage}. Pick the `data` variant to embed
 * bytes immediately, or the `url` variant to defer fetching until export.
 */
export type AddImageInput = AddImageInputBytes | AddImageInputUrl;

/**
 * Parses an EPUB and starts an editing session over it, retaining the package
 * data needed to export the edits back into an EPUB file.
 *
 * Requires host DOM globals (`DOMParser`, `XMLSerializer`, `Node`). Node and
 * SSR runtimes must register a DOM implementation (happy-dom, jsdom) first.
 *
 * @param data - EPUB file contents. A `Uint8Array` (a Node `Buffer` included)
 *   is read through its own view. The input is neither retained nor modified.
 * @param options - Resource limits applied while reading the archive, and a
 *   signal that cancels the parse.
 * @returns An editing session over the parsed book.
 * @throws {TypeError} When `data` is not an `ArrayBuffer` or `Uint8Array`, or
 *   `options.signal` is not an `AbortSignal`.
 * @throws {RangeError} When a limit in `options.limits` is not a positive integer.
 * @throws {MejiroError} `epub-invalid-archive` when `data` is not a readable ZIP
 *   archive, `epub-invalid-package` when the container, package document or a
 *   chapter is malformed or no chapter is readable, `epub-limit-exceeded` when
 *   the archive passes one of the limits, `dom-unavailable` when the host has
 *   no DOM implementation.
 * @throws The `signal.reason` when `options.signal` aborts.
 */
export async function parseEditableEpub(
  data: BinaryInput,
  options: EpubParseOptions = {},
): Promise<EditableEpub> {
  const limits = resolveEpubParseLimits(options);
  assertBinaryInput(data);
  const { signal } = options;
  throwIfAborted(signal);
  assertEpubInputSize(data.byteLength, limits);
  const zip = await openEpubArchive(data, limits, signal);
  const budget = new EpubExpansionBudget(limits, signal);
  const files = new Map<string, Uint8Array>();

  // Entries are expanded one at a time so the running total is charged before
  // the next entry starts, keeping peak memory at the configured limits even
  // when the archive under-reports its own sizes.
  for (const path of Object.keys(zip.files)) {
    const file = zip.file(path);
    if (!file) continue;
    files.set(path, await budget.readBytes(file));
  }
  throwIfAborted(signal);

  const containerXml = readEntryText(files, 'META-INF/container.xml');
  const { rootfilePath, opfDir } = packageDocumentLocation(containerXml);
  const opfXml = readEntryText(files, rootfilePath);
  const { title, author, spineHrefs, manifestItems, navHref, ncxHref, pageProgressionDirection } =
    parseOpfPackage(opfXml, opfDir);
  const navTitles = collectTocTitles({
    navHref,
    navXhtml: navHref ? readEntryTextOrNull(files, navHref) : null,
    ncxHref,
    ncxXml: ncxHref ? readEntryTextOrNull(files, ncxHref) : null,
  });

  const chapters: EditableEpubChapter[] = [];
  for (const href of spineHrefs) {
    const xhtml = readEntryTextOrNull(files, href);
    if (xhtml == null) continue;
    let extracted: ExtractedChapter;
    try {
      extracted = extractEditableBlocks(xhtml, href, files, manifestItems);
    } catch (err) {
      throw new MejiroError(
        'epub-invalid-package',
        `Failed to parse chapter XHTML: ${href} (${err instanceof Error ? err.message : String(err)})`,
        { cause: err },
      );
    }
    const chapterTitle = extractChapterTitleOrUndefined(xhtml) ?? navTitles.get(href);
    if (extracted.blocks.length > 0) {
      const chapter: EditableEpubChapter = {
        href,
        originalXhtml: xhtml,
        title: chapterTitle,
        blocks: extracted.blocks,
        imageAssets: extracted.imageAssets,
      };
      chapterStateOf(chapter).originalImageHrefs = extracted.originalImageHrefs;
      chapters.push(chapter);
    }
  }
  if (chapters.length === 0) {
    throw new MejiroError('epub-invalid-package', 'EPUB has no readable chapters');
  }

  const epub: EditableEpubBook = {
    title,
    author,
    chapters,
    ...(pageProgressionDirection ? { pageProgressionDirection } : {}),
  };
  attachPackageData(epub, { rootfilePath, opfDir, opfXml, files });
  return openSession(epub);
}

/** Loosely typed view of a paragraph input, for the checks behind the static types. */
interface ParagraphFields {
  paragraphKind?: string;
  text?: unknown;
  inlineAnnotations?: readonly InlineAnnotation[];
  headingLevel?: number;
}

/** Kinds a paragraph may take besides heading and scene break. */
const PLAIN_PARAGRAPH_KINDS = new Set(['body', 'blockquote', 'pre']);

/** Builds the block `insertParagraph` stores; throws before anything is recorded. */
function newParagraphBlock(id: string, paragraph: NewParagraph): EditableParagraphBlock {
  const { paragraphKind, text, inlineAnnotations, headingLevel } = paragraph as ParagraphFields;
  if (paragraphKind === 'sceneBreak') {
    if (text || inlineAnnotations?.length || headingLevel !== undefined) {
      throw new TypeError('A sceneBreak paragraph takes no text, annotations or headingLevel');
    }
    return paragraphBlock(id, '', [], 'sceneBreak', undefined);
  }
  if (typeof text !== 'string') throw new TypeError('A new paragraph needs its text as a string');
  return paragraphBlock(
    id,
    text,
    inlineAnnotations ?? [],
    requestedKind(paragraphKind, headingLevel),
    headingLevel,
  );
}

/** Builds the block an update leaves behind; throws before anything is recorded. */
function patchedParagraph(
  block: EditableParagraphBlock,
  patch: ParagraphPatch,
): EditableParagraphBlock {
  const { paragraphKind, text, inlineAnnotations, headingLevel } = patch as ParagraphFields;
  if (text !== undefined && typeof text !== 'string') {
    throw new TypeError('A paragraph text must be a string');
  }
  if (paragraphKind === 'sceneBreak') {
    if (text !== undefined || inlineAnnotations !== undefined || headingLevel !== undefined) {
      throw new TypeError('A sceneBreak paragraph takes no text, annotations or headingLevel');
    }
    return paragraphBlock(block.id, '', [], 'sceneBreak', undefined);
  }
  let kind = block.paragraphKind;
  let level: number | undefined = block.headingLevel;
  if (paragraphKind === undefined) {
    if (kind === 'sceneBreak' && (text !== undefined || inlineAnnotations !== undefined)) {
      throw new TypeError(
        'A sceneBreak paragraph takes no text; pass a paragraphKind to change it',
      );
    }
    if (headingLevel !== undefined) {
      if (kind !== 'heading') {
        throw new TypeError("Only a heading takes a headingLevel; pass paragraphKind: 'heading'");
      }
      level = headingLevel;
    }
  } else {
    kind = requestedKind(paragraphKind, headingLevel);
    level = headingLevel;
  }
  const annotations =
    inlineAnnotations ??
    (text === undefined
      ? block.inlineAnnotations
      : reanchorInlineAnnotations(block.inlineAnnotations, block.text, text));
  return paragraphBlock(block.id, text ?? block.text, annotations, kind, level);
}

/**
 * Validates a requested non-scene-break kind against the level that comes with it.
 *
 * @returns The kind to store; `undefined` for body text.
 */
function requestedKind(
  kind: string | undefined,
  level: number | undefined,
): EditableParagraphBlock['paragraphKind'] {
  if (kind === 'heading') {
    if (level === undefined) throw new TypeError('A heading paragraph needs a headingLevel');
    return 'heading';
  }
  if (kind !== undefined && !PLAIN_PARAGRAPH_KINDS.has(kind)) {
    throw new RangeError(`Unknown paragraphKind: ${kind}`);
  }
  if (level !== undefined) throw new TypeError('Only a heading paragraph takes a headingLevel');
  return kind === 'body' ? undefined : (kind as 'blockquote' | 'pre' | undefined);
}

/**
 * The one constructor for stored paragraph blocks. Every mutator and the
 * loader build blocks here, so a stored block always has a `headingLevel` that
 * is an integer from 1 to 6 exactly when it is a heading, annotations with
 * integer offsets inside its text, and no text on a scene break.
 */
function paragraphBlock(
  id: string,
  text: string,
  annotations: readonly InlineAnnotation[],
  paragraphKind: EditableParagraphBlock['paragraphKind'],
  requestedLevel: number | undefined,
): EditableParagraphBlock {
  const level = normalizeHeadingLevel(paragraphKind, requestedLevel);
  // A heading level turns any kind, a scene break included, into a heading.
  const kind = level ? 'heading' : paragraphKind;
  assertSceneBreakText(kind, text);
  const inlineAnnotations = validInlineAnnotations(annotations, text);
  const block: EditableParagraphBlock = { kind: 'paragraph', id, text, inlineAnnotations };
  if (kind && kind !== 'body') block.paragraphKind = kind;
  if (level) block.headingLevel = level;
  return block;
}

/**
 * Validates a heading level against its paragraph kind.
 *
 * @returns The level for a heading, `undefined` otherwise.
 * @throws {RangeError} When the level is not an integer from 1 to 6.
 * @throws {TypeError} When a heading has no level.
 */
function normalizeHeadingLevel(
  kind: EditableParagraphBlock['paragraphKind'],
  level: number | undefined,
): HeadingLevel | undefined {
  if (level == null) {
    if (kind === 'heading') throw new TypeError('A heading block must carry a headingLevel');
    return undefined;
  }
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new RangeError(`Invalid headingLevel ${level}: expected an integer from 1 to 6`);
  }
  return level as HeadingLevel;
}

/** A scene break exports as a bare `<hr/>`, so it cannot carry text. */
function assertSceneBreakText(kind: EditableParagraphBlock['paragraphKind'], text: string): void {
  if (kind === 'sceneBreak' && text !== '') {
    throw new TypeError('A sceneBreak block cannot carry text');
  }
}

/** Writes `next` into `block` in place, keeping the object callers may hold. */
function storeParagraph(block: EditableParagraphBlock, next: EditableParagraphBlock): void {
  delete block.paragraphKind;
  delete block.headingLevel;
  Object.assign(block, next);
}

/**
 * Keeps only the annotations whose range addresses real characters of `text`,
 * i.e. integer `0 <= startIndex < endIndex <= [...text].length`. The input
 * array is returned unchanged when nothing has to be dropped.
 */
function validInlineAnnotations(
  annotations: readonly InlineAnnotation[],
  text: string,
): readonly InlineAnnotation[] {
  const length = [...text].length;
  const kept = annotations.filter(
    (ann) =>
      Number.isInteger(ann.startIndex) &&
      Number.isInteger(ann.endIndex) &&
      ann.startIndex >= 0 &&
      ann.startIndex < ann.endIndex &&
      ann.endIndex <= length,
  );
  return kept.length === annotations.length ? annotations : kept;
}

/**
 * Moves annotations indexed into `oldText` onto `newText`.
 *
 * The untouched head and tail of the paragraph are matched character by
 * character. An annotation living entirely in one of them keeps covering the
 * exact same base characters; one overlapping the edited span is dropped
 * rather than silently re-pointed at different characters.
 */
function reanchorInlineAnnotations(
  annotations: readonly InlineAnnotation[],
  oldText: string,
  newText: string,
): readonly InlineAnnotation[] {
  if (oldText === newText || annotations.length === 0) return annotations;
  const oldChars = [...oldText];
  const newChars = [...newText];
  const common = Math.min(oldChars.length, newChars.length);
  let prefix = 0;
  while (prefix < common && oldChars[prefix] === newChars[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < common - prefix &&
    oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]
  ) {
    suffix++;
  }

  const tailStart = oldChars.length - suffix;
  const shift = newChars.length - oldChars.length;
  const kept: InlineAnnotation[] = [];
  for (const ann of annotations) {
    if (ann.endIndex <= prefix) {
      kept.push(ann);
    } else if (ann.startIndex >= tailStart) {
      kept.push({ ...ann, startIndex: ann.startIndex + shift, endIndex: ann.endIndex + shift });
    }
  }
  return validInlineAnnotations(kept, newText);
}

/** Position `addImage` inserts at; throws when `afterBlockId` names no block. */
function addImageInsertIndex(chapter: EditableEpubChapter, image: AddImageInput): number {
  if (image.afterBlockId === undefined) return chapter.blocks.length;
  return requireBlockIndex(chapter, image.afterBlockId) + 1;
}

/** Bytes of a `data` input, copied; `undefined` for a URL input. */
function imageInputData(image: AddImageInput): Uint8Array | undefined {
  if (image.data !== undefined) {
    if (!isBinaryInput(image.data)) {
      throw new TypeError('Image data must be an ArrayBuffer or a Uint8Array');
    }
    return toUint8Array(image.data).slice();
  }
  if (typeof image.url !== 'string') {
    throw new TypeError('Image input must include either `data` or `url`');
  }
  return undefined;
}

function imageInputFilename(image: AddImageInput): string {
  if (typeof image.filename !== 'string') throw new TypeError('Image filename must be a string');
  const filename = basename(image.filename);
  if (!filename) throw new RangeError('Image filename must not be empty');
  return filename;
}

/** Block id the watermark paragraph takes, suffixed when the chapter already uses it. */
const WATERMARK_BLOCK_ID = 'mejiro-watermark';

/**
 * Puts a watermark paragraph at the top of every chapter of an export copy. An
 * unedited chapter keeps being written back verbatim, with the paragraph
 * inserted right after its `<body>`; a chapter whose XHTML cannot take that is
 * rebuilt from its blocks instead.
 */
function applyWatermark(epub: EditableEpubBook, text: string): void {
  for (const chapter of epub.chapters) {
    const state = chapterStateOf(chapter);
    if (!state.dirty && chapter.originalXhtml) {
      const injected = injectWatermarkXhtml(chapter.originalXhtml, text);
      if (injected) {
        writable(chapter).originalXhtml = injected;
        continue;
      }
      state.dirty = true;
    }
    const used = new Set(chapter.blocks.map((block) => block.id));
    let id = WATERMARK_BLOCK_ID;
    for (let suffix = 2; used.has(id); suffix++) id = `${WATERMARK_BLOCK_ID}-${suffix}`;
    writable(chapter).blocks.unshift(paragraphBlock(id, text, [], undefined, undefined));
  }
}

/**
 * Inserts a paragraph right after the opening `<body>` tag of namespaced
 * XHTML.
 *
 * @returns The new XHTML, or `null` when the markup is not shaped that way.
 */
function injectWatermarkXhtml(xhtml: string, text: string): string | null {
  if (!/<html\b[^>]*\sxmlns\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xhtml["']/iu.test(xhtml)) {
    return null;
  }
  const body = xhtml.match(/<body\b(?:[^>]*[^/>])?>/iu);
  if (body?.index === undefined) return null;
  const end = body.index + body[0].length;
  return `${xhtml.slice(0, end)}<p>${inlineContentMarkup(text, [])}</p>${xhtml.slice(end)}`;
}

async function exportEditableEpubBook(
  epub: EditableEpubBook,
  options: EditableEpubExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const { onProgress, signal, assetResolver, watermark } = options;
  throwIfAborted(signal);
  if (watermark !== undefined && typeof watermark !== 'string') {
    throw new TypeError('Export option watermark must be a string');
  }
  const progress: EpubExportOptions['onProgress'] = onProgress
    ? (phase, ratio) => {
        if (!signal?.aborted) onProgress(phase, ratio);
      }
    : undefined;

  // Asset resolution can await for seconds, and the live book stays editable
  // meanwhile. Copy the whole book synchronously so the export reflects one
  // point in time instead of a mix of pre- and mid-export states.
  const snapshot = cloneEditableEpubBook(epub);
  if (watermark) applyWatermark(snapshot, watermark);
  const packageData = packageDataOf(snapshot);
  const files = packageData.files;
  const rebuilt = (chapter: EditableEpubChapter): boolean =>
    chapterStateOf(chapter).dirty || !chapter.originalXhtml;
  for (const chapter of snapshot.chapters) {
    if (rebuilt(chapter)) assertEditableChapterStructure(chapter, files);
  }
  let opfXml = packageData.opfXml;
  const originalImageHrefs = new Set<string>();
  const retainedImageHrefs = new Set<string>();

  progress?.('serialize', 0);
  const total = Math.max(1, snapshot.chapters.length);
  for (let i = 0; i < snapshot.chapters.length; i++) {
    throwIfAborted(signal);
    const chapter = snapshot.chapters[i];
    for (const href of chapterStateOf(chapter).originalImageHrefs) originalImageHrefs.add(href);
    for (const assetKey of chapter.imageAssets.keys()) {
      retainedImageHrefs.add(imageAssetHref(chapter, assetKey, packageData.opfDir));
    }

    files.set(
      chapter.href,
      encodeText(
        rebuilt(chapter)
          ? serializeChapterXhtml(chapter, packageData.opfDir)
          : chapter.originalXhtml,
      ),
    );

    for (const [assetKey, asset] of chapter.imageAssets) {
      throwIfAborted(signal);
      const assetHref = imageAssetHref(chapter, assetKey, packageData.opfDir);
      const bytes = await resolveAssetData(assetHref, asset, assetResolver, signal);
      files.set(assetHref, bytes);
      const source = assetSourceOf(asset);
      opfXml = ensureManifestItem(
        opfXml,
        source.manifestId ?? manifestIdFromAssetKey(assetKey),
        source.manifestHref ?? zipPathToHref(relativeZipPath(packageData.opfDir, assetHref)),
        asset.mediaType ?? mediaTypeFromPath(asset.filename),
      );
    }
    progress?.('serialize', (i + 1) / total);
  }

  for (const href of originalImageHrefs) {
    if (retainedImageHrefs.has(href)) continue;
    files.delete(href);
    opfXml = removeManifestItemByHref(
      opfXml,
      zipPathToHref(relativeZipPath(packageData.opfDir, href)),
      href,
      packageData.opfDir,
    );
  }

  files.set(packageData.rootfilePath, encodeText(opfXml));

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
  return generateZip(zip, progress, signal);
}

/**
 * @internal
 * Generates the ZIP, forwarding JSZip's progress callback as a `'zip'`-phase
 * progress event and rejecting with `signal.reason` as soon as `signal` aborts.
 * No progress is reported once `signal` has aborted.
 */
export function generateZip(
  zip: JSZip,
  onProgress?: EpubExportOptions['onProgress'],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const generation = zip
    .generateAsync(
      {
        type: 'uint8array',
        mimeType: 'application/epub+zip',
        compression: 'DEFLATE',
      },
      onProgress
        ? (metadata) => {
            if (!signal?.aborted) onProgress('zip', metadata.percent / 100);
          }
        : undefined,
    )
    .then((bytes) =>
      bytes.buffer instanceof ArrayBuffer &&
      bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength
        ? new Uint8Array(bytes.buffer)
        : new Uint8Array(bytes),
    );
  if (!signal) return generation;
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
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

/** @internal The fields of an asset that its bytes are resolved from. */
export interface AssetBytesSource {
  data?: BinaryInput;
  url?: string;
  mediaType?: string;
}

/**
 * @internal
 * Resolves the bytes of one asset for both export paths. Inline `data` is used
 * as it is; otherwise the asset's `url` goes through `resolver`, or the
 * runtime `fetch` when there is none.
 *
 * @param href - ZIP path the bytes are written to.
 * @throws {MejiroError} `asset-fetch-failed` when the default fetch fails.
 * @throws {TypeError} When the asset has neither `data` nor `url`, or the
 *   resolver returns something other than bytes.
 */
export async function resolveAssetData(
  href: string,
  asset: AssetBytesSource,
  resolver: AssetResolver | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (asset.data !== undefined) return toUint8Array(asset.data);
  const { url } = asset;
  if (!url) throw new TypeError(`Image asset ${href} has neither \`data\` nor \`url\``);
  throwIfAborted(signal);
  let resolved: BinaryInput;
  try {
    resolved = resolver
      ? await resolver({
          url,
          href,
          ...(asset.mediaType !== undefined ? { mediaType: asset.mediaType } : {}),
          ...(signal ? { signal } : {}),
        })
      : await defaultAssetFetch(url, signal);
  } catch (err) {
    // Once aborted, the abort is the outcome whatever the resolver threw.
    throwIfAborted(signal);
    throw err;
  }
  throwIfAborted(signal);
  if (!isBinaryInput(resolved)) {
    throw new TypeError(`assetResolver must return an ArrayBuffer or a Uint8Array for ${href}`);
  }
  return toUint8Array(resolved);
}

async function defaultAssetFetch(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : undefined);
  } catch (err) {
    throwIfAborted(signal);
    throw new MejiroError('asset-fetch-failed', `Failed to fetch image asset: ${url}`, {
      cause: err,
    });
  }
  if (!response.ok) {
    throw new MejiroError(
      'asset-fetch-failed',
      `Failed to fetch image asset: ${url} (HTTP ${response.status})`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Checked by tag so bytes from another realm are accepted too. */
function isBinaryInput(value: unknown): value is BinaryInput {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object ArrayBuffer]' || tag === '[object Uint8Array]';
}

/**
 * Rebuilds a chapter's XHTML from `blocks`. Pure `createElementNS` —
 * `innerHTML` is never invoked. The document shell and the wrapper chain
 * around the content (see {@link contentRoot}) are kept; source attributes of
 * the rebuilt blocks are dropped.
 *
 * The result always begins with exactly one XML declaration, so it stays
 * well-formed XHTML regardless of the host DOM implementation.
 */
function serializeChapterXhtml(chapter: EditableEpubChapter, opfDir: string): string {
  const stylesheetLinks = extractStylesheetLinks(chapter.originalXhtml);
  const doc = createSerializationDocument(chapter);
  const html = doc.documentElement;
  const head = ensureChildElement(doc, html, 'head', html.firstChild);
  const body = contentRoot(ensureChildElement(doc, html, 'body'));
  const hadTitleCarrier = findChapterTitleCarrier(body) !== undefined;

  if (chapter.title && !findFirstDescendant(doc, 'title')) {
    const titleEl = doc.createElementNS(XHTML_NS, 'title');
    titleEl.appendChild(doc.createTextNode(sanitizeXmlText(chapter.title)));
    head.appendChild(titleEl);
  }

  while (body.firstChild) body.removeChild(body.firstChild);
  const markup =
    (hadTitleCarrier ? chapterTitleCarrierMarkup(chapter.title ?? '') : '') +
    chapter.blocks.map((block) => blockMarkup(chapter, block, opfDir)).join('');
  // The shared serializer writes the blocks as markup; parsing it once moves them into the shell.
  const fragment = parseXml(`<div xmlns="${XHTML_NS}">${markup}</div>`).documentElement;
  for (const node of Array.from(fragment.childNodes)) {
    body.appendChild(doc.importNode(node, true));
  }

  // Strip any duplicate xmlns attributes the engine may have stamped onto
  // child elements; the root html already declares the namespace.
  for (const el of Array.from(html.getElementsByTagName('*'))) {
    if (el.getAttribute('xmlns') === XHTML_NS) el.removeAttribute('xmlns');
  }

  // Some DOM implementations (happy-dom among them) re-emit the declaration of
  // the source document, so drop any leading one before prepending ours.
  const serialized = stripXmlDeclaration(new XMLSerializer().serializeToString(doc));
  return XML_DECLARATION + restoreStylesheetLinks(serialized, stylesheetLinks);
}

const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>\n';

/** Removes a leading XML declaration (and the whitespace that follows it). */
function stripXmlDeclaration(xml: string): string {
  return xml.replace(/^\s*<\?xml\s[\s\S]*?\?>\s*/u, '');
}

function createSerializationDocument(chapter: EditableEpubChapter): Document {
  if (chapter.originalXhtml) {
    try {
      return parseXml(stripStylesheetLinks(chapter.originalXhtml));
    } catch {
      // Fall through to the clean skeleton. Some real EPUBs contain HTML-ish
      // void tags that are accepted on import after stylesheet stripping but
      // are not well-formed XML for full-document reuse.
    }
  }
  assertEpubDomAvailable();
  const skeleton = `<?xml version="1.0" encoding="utf-8"?><html xmlns="${XHTML_NS}"><head/><body/></html>`;
  return new DOMParser().parseFromString(skeleton, 'application/xhtml+xml');
}

function restoreStylesheetLinks(xhtml: string, links: readonly string[]): string {
  if (links.length === 0) return xhtml;
  if (links.every((link) => xhtml.includes(link))) return xhtml;
  return xhtml.replace(/<\/head>/iu, `${links.join('')}</head>`);
}

function findFirstElement(root: ParentNode, localName: string): Element | null {
  return (
    Array.from(root.childNodes).find(
      (node): node is Element =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).localName.toLowerCase() === localName,
    ) ?? null
  );
}

function findFirstDescendant(root: ParentNode, localName: string): Element | null {
  return (
    Array.from((root as Element | Document).getElementsByTagName('*')).find(
      (el) => el.localName.toLowerCase() === localName,
    ) ?? null
  );
}

function ensureChildElement(
  doc: Document,
  parent: Element,
  localName: 'head' | 'body',
  before?: ChildNode | null,
): Element {
  const existing = findFirstElement(parent, localName);
  if (existing) return existing;
  const el = doc.createElementNS(XHTML_NS, localName);
  parent.insertBefore(el, before ?? null);
  return el;
}

function blockMarkup(chapter: EditableEpubChapter, block: EditableBlock, opfDir: string): string {
  if (block.kind === 'image') {
    return figureMarkup({
      src: zipPathToHref(
        relativeZipPath(dirname(chapter.href), imageAssetHref(chapter, block.assetKey, opfDir)),
      ),
      alt: block.alt ?? '',
      caption: block.caption,
      placement: block.placement,
    });
  }
  if (block.paragraphKind === 'sceneBreak') return '<hr />';
  const tagName = paragraphTagName(block);
  return `<${tagName}>${inlineContentMarkup(block.text, block.inlineAnnotations)}</${tagName}>`;
}

function paragraphTagName(block: EditableParagraphBlock): string {
  const level = normalizeHeadingLevel(block.paragraphKind, block.headingLevel);
  if (level) return `h${level}`;
  if (block.paragraphKind === 'blockquote') return 'blockquote';
  if (block.paragraphKind === 'pre') return 'pre';
  return 'p';
}

/**
 * Rejects a chapter whose source carries content the block model cannot write
 * back, as {@link classifyEditableElement} reports it.
 */
function assertEditableChapterStructure(
  chapter: EditableEpubChapter,
  files: ReadonlyMap<string, Uint8Array>,
): void {
  if (!chapter.originalXhtml) return;
  const doc = parseXml(stripStylesheetLinks(chapter.originalXhtml));
  const resolveImage = archiveImageResolver(chapter.href, files);
  const check = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      const { role, loss } = classifyEditableElement(child, resolveImage);
      if (loss) {
        throw new MejiroError(
          'epub-unsupported-content',
          `Cannot export edited chapter with ${loss}: ${chapter.href}`,
        );
      }
      if (role !== 'skip') check(child);
    }
  };
  check(contentRoot(contentBody(doc)));
}

/** How the block model reads one source element. */
interface EditableElementClass {
  /**
   * `image` and `sceneBreak` become one block; `skip` contributes nothing;
   * `quote` gives every paragraph below it the blockquote kind; `flow` is read
   * for paragraphs and nested structure.
   */
  role: 'image' | 'sceneBreak' | 'skip' | 'quote' | 'flow';
  /** The image to import, for the `image` role. */
  image?: { img: Element; href: string; figure?: Element };
  /** What rebuilding an edited chapter would drop; its export throws naming it. */
  loss?: string;
}

/**
 * The one classification of source elements, shared by the block extractor and
 * the edited-chapter guard: anything extraction skips or collapses carries a
 * `loss`, so an edited chapter either round-trips the element or fails to export.
 */
function classifyEditableElement(
  el: Element,
  resolveImage: (img: Element) => string | undefined,
): EditableElementClass {
  // The chapter-title carrier is rewritten from `chapter.title`.
  if (isChapterTitleCarrier(el)) return { role: 'skip' };
  const cls = classifyByName(el, resolveImage);
  const id = el.getAttribute('id');
  return cls.loss || !id ? cls : { ...cls, loss: `element id "${id}"` };
}

function classifyByName(
  el: Element,
  resolveImage: (img: Element) => string | undefined,
): EditableElementClass {
  const localName = el.localName.toLowerCase();
  if (!RUBY_PARTS.has(localName) && isNonRenderedElement(el)) {
    const hasContent = Boolean(el.textContent?.trim()) || descendantsByName(el, 'img').length > 0;
    return hasContent
      ? { role: 'skip', loss: `non-rendered <${localName}> content` }
      : { role: 'skip' };
  }
  if (UNSUPPORTED_EDITABLE_ELEMENTS.has(localName)) {
    return { role: 'flow', loss: `<${localName}> structure` };
  }
  if (localName === 'img') {
    const href = resolveImage(el);
    if (!href) {
      return { role: 'skip', loss: `unresolved <img src="${el.getAttribute('src') ?? ''}">` };
    }
    return { role: 'image', image: { img: el, href } };
  }
  if (localName === 'hr') return { role: 'sceneBreak' };
  if (localName === 'figure') {
    const images = descendantsByName(el, 'img');
    if (images.length === 0) return { role: 'flow' };
    if (images.length > 1 || figureHasExtraContent(el)) {
      return { role: 'flow', loss: '<figure> content beyond one image and its caption' };
    }
    const href = resolveImage(images[0]);
    // An unresolvable image reports its own loss when the figure is read as flow.
    return href ? { role: 'image', image: { img: images[0], href, figure: el } } : { role: 'flow' };
  }
  if (localName === 'blockquote') {
    const nested = descendantsByName(el).find((child) => {
      const name = child.localName.toLowerCase();
      return name !== 'p' && (EDITABLE_BLOCK_ELEMENTS.has(name) || name === 'img');
    });
    return nested
      ? { role: 'flow', loss: `<blockquote> around <${nested.localName.toLowerCase()}>` }
      : { role: 'quote' };
  }
  return { role: 'flow' };
}

/** Whether a figure holds text outside its one `<figcaption>`. */
function figureHasExtraContent(figure: Element): boolean {
  const captions = Array.from(figure.children).filter(
    (child) => child.localName.toLowerCase() === 'figcaption',
  );
  if (captions.length > 1) return true;
  const textOutside = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node === captions[0]) return '';
    return Array.from(node.childNodes).map(textOutside).join('');
  };
  return textOutside(figure).trim() !== '';
}

/**
 * Resolves an `<img>` to the archive entry it shows, or `undefined` when it has
 * no `src`, a malformed one, or one naming no file in the archive.
 */
function archiveImageResolver(
  chapterHref: string,
  files: ReadonlyMap<string, Uint8Array>,
): (img: Element) => string | undefined {
  return (img) => {
    const src = img.getAttribute('src');
    if (!src) return undefined;
    let href: string;
    try {
      href = resolveZipPath(dirname(chapterHref), src);
    } catch {
      return undefined;
    }
    return files.has(href) ? href : undefined;
  };
}

const RUBY_PARTS = new Set(['rt', 'rp', 'rtc']);

function isChapterTitleCarrier(el: Element): boolean {
  return el.getAttribute('id') === CHAPTER_TITLE_ID;
}

function findChapterTitleCarrier(root: Element): Element | undefined {
  return Array.from(root.getElementsByTagName('*')).find(isChapterTitleCarrier);
}

/** Elements that only wrap the chapter content and are kept around the rebuilt blocks. */
const CONTENT_WRAPPER_ELEMENTS = new Set(['section', 'article', 'main', 'div']);

/**
 * Innermost element of a chain of single wrappers below `body` (for example
 * `<section id>` around the whole chapter). Blocks are rebuilt inside it, so
 * the wrappers and their attributes survive an edit.
 */
function contentRoot(body: Element): Element {
  let root = body;
  for (;;) {
    const children = Array.from(root.children);
    const only = children[0];
    if (
      children.length !== 1 ||
      !CONTENT_WRAPPER_ELEMENTS.has(only.localName.toLowerCase()) ||
      Array.from(root.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      ) ||
      !Array.from(only.children).some((child) =>
        EDITABLE_BLOCK_ELEMENTS.has(child.localName.toLowerCase()),
      )
    ) {
      return root;
    }
    root = only;
  }
}

function imageAssetHref(chapter: EditableEpubChapter, assetKey: string, opfDir: string): string {
  const asset = chapter.imageAssets.get(assetKey);
  if (!asset) throw new Error(`Missing image asset: ${assetKey}`);
  if (asset.href) return asset.href;
  // Place new assets under the OPF directory so manifest hrefs are stable.
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

/** Source elements an edited chapter cannot be rebuilt with. */
const UNSUPPORTED_EDITABLE_ELEMENTS = new Set([
  'ul',
  'ol',
  'dl',
  'table',
  'thead',
  'tbody',
  'svg',
  'math',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'canvas',
]);

/** Blocks and assets read from one source chapter. */
interface ExtractedChapter {
  blocks: EditableBlock[];
  imageAssets: Map<string, EditableImageAsset>;
  originalImageHrefs: string[];
}

function extractEditableBlocks(
  xhtml: string,
  chapterHref: string,
  files: Map<string, Uint8Array>,
  manifestItems: Map<string, OpfManifestItem>,
): ExtractedChapter {
  const doc = parseXml(stripStylesheetLinks(xhtml));
  const root = contentBody(doc);
  const resolveImage = archiveImageResolver(chapterHref, files);
  const imageAssets = new Map<string, EditableImageAsset>();
  const originalImageHrefs = new Set<string>();
  const blocks: EditableBlock[] = [];

  const pushParagraph = (el: Element, quoted: boolean, nodes: readonly Node[] = [el]): void => {
    const serializer = new XMLSerializer();
    const paragraphs = extractRubyContent(
      wrapXhtml(nodes.map((node) => serializer.serializeToString(node)).join('')),
    );
    const tag = el.localName.toLowerCase();
    const kind = quoted || tag === 'blockquote' ? 'blockquote' : tag === 'pre' ? 'pre' : undefined;
    for (const para of paragraphs) {
      if (!para.text) continue;
      blocks.push(
        paragraphBlock(
          nextGeneratedBlockId(blocks),
          para.text,
          para.inlineAnnotations,
          kind,
          para.headingLevel,
        ),
      );
    }
  };

  const addImageBlock = ({ img, href, figure }: NonNullable<EditableElementClass['image']>) => {
    originalImageHrefs.add(href);
    const filename = basename(href);
    const manifestItem = manifestItems.get(href);
    const assetKey = uniqueAssetKey(filename, imageAssets);
    // The resolver only accepts images whose file the archive holds.
    const asset: EditableImageAsset = {
      filename,
      href,
      data: files.get(href) as Uint8Array,
      mediaType: manifestItem?.mediaType ?? mediaTypeFromPath(filename),
    };
    attachAssetSource(asset, {
      manifestId: manifestItem?.id,
      manifestHref: manifestItem?.packageHref,
    });
    imageAssets.set(assetKey, asset);
    const figcaption = figure ? firstChildElementByName(figure, 'figcaption') : undefined;
    blocks.push({
      kind: 'image',
      id: nextGeneratedBlockId(blocks),
      assetKey,
      alt: img.getAttribute('alt') ?? undefined,
      caption: figcaption ? renderedText(figcaption) : undefined,
      placement: figure ? imagePlacement(figure.getAttribute('data-placement')) : undefined,
    });
  };

  const structureMemo = new Map<Node, boolean>();
  const containsStructure = (node: Node): boolean => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const cached = structureMemo.get(node);
    if (cached !== undefined) return cached;
    const tag = (node as Element).localName.toLowerCase();
    const result =
      EDITABLE_BLOCK_ELEMENTS.has(tag) ||
      tag === 'img' ||
      Array.from(node.childNodes).some(containsStructure);
    structureMemo.set(node, result);
    return result;
  };

  const visit = (el: Element, inQuote: boolean): void => {
    const { role, image } = classifyEditableElement(el, resolveImage);
    if (role === 'skip') return;
    if (image) {
      addImageBlock(image);
      return;
    }
    if (role === 'sceneBreak') {
      blocks.push(paragraphBlock(nextGeneratedBlockId(blocks), '', [], 'sceneBreak', undefined));
      return;
    }
    const quoted = inQuote || role === 'quote';
    const tag = el.localName.toLowerCase();
    const childBlocks = Array.from(el.children).filter((child) =>
      EDITABLE_BLOCK_ELEMENTS.has(child.localName.toLowerCase()),
    );
    const isParagraphElement = EDITABLE_BLOCK_ELEMENTS.has(tag) && childBlocks.length === 0;
    if (isParagraphElement && descendantsByName(el, 'img').length === 0) {
      pushParagraph(el, quoted);
      return;
    }
    // Runs of loose text and inline markup between structural children are
    // paragraphs too, whatever element owns them. A paragraph element split
    // around its images wraps each run in a copy of itself to keep its kind.
    let run: Node[] = [];
    const flush = (): void => {
      if (run.length > 0 && isParagraphElement) {
        const wrapper = el.cloneNode(false) as Element;
        for (const node of run) wrapper.appendChild(node.cloneNode(true));
        pushParagraph(el, quoted, [wrapper]);
      } else if (run.length > 0) {
        pushParagraph(el, quoted, run);
      }
      run = [];
    };
    for (const child of Array.from(el.childNodes)) {
      if (containsStructure(child)) {
        flush();
        visit(child as Element, quoted);
      } else {
        run.push(child);
      }
    }
    flush();
  };

  visit(root, false);
  return { blocks, imageAssets, originalImageHrefs: [...originalImageHrefs] };
}

function wrapXhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="${XHTML_NS}"><body>${body}</body></html>`;
}

function nextGeneratedBlockId(blocks: readonly EditableBlock[]): string {
  return `b-${blocks.length + 1}`;
}

function collectImageAssetKeys(book: EditableEpubBook): Set<string> {
  const keys = new Set<string>();
  for (const path of packageDataOf(book).files.keys()) {
    const name = basename(path);
    if (name) keys.add(name);
  }
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

/** Descendant elements of `parent`, optionally only those named `localName`. */
function descendantsByName(parent: Element, localName?: string): Element[] {
  const all = Array.from(parent.getElementsByTagName('*'));
  return localName ? all.filter((el) => el.localName.toLowerCase() === localName) : all;
}

/** Generates a unique block id within `chapter`. */
function nextBlockId(chapter: EditableEpubChapter): string {
  const used = new Set(chapter.blocks.map((b) => b.id));
  let n = chapter.blocks.length + 1;
  while (used.has(`b-${n}`)) n++;
  return `b-${n}`;
}

function requireChapter(book: EditableEpubBook, chapterIndex: number): EditableEpubChapter {
  const chapter = Number.isInteger(chapterIndex) ? book.chapters[chapterIndex] : undefined;
  if (!chapter) throw new RangeError(`Missing chapter: ${chapterIndex}`);
  return chapter;
}

function requireBlockIndex(chapter: EditableEpubChapter, blockId: string): number {
  const index = chapter.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) throw new RangeError(`Missing block: ${blockId}`);
  return index;
}

function requireParagraphBlock(
  chapter: EditableEpubChapter,
  blockId: string,
): EditableParagraphBlock {
  const block = chapter.blocks[requireBlockIndex(chapter, blockId)];
  if (block.kind !== 'paragraph') throw new RangeError(`Not a paragraph block: ${blockId}`);
  return block;
}

function parseXml(xml: string): Document {
  assertEpubDomAvailable();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new MejiroError('epub-invalid-package', 'Failed to parse XML document');
  }
  return doc;
}

function readEntryText(files: Map<string, Uint8Array>, path: string): string {
  const text = readEntryTextOrNull(files, path);
  if (text == null) throw new MejiroError('epub-invalid-package', `Missing file in EPUB: ${path}`);
  return text;
}

/** Decodes a ZIP entry, or returns `null` when the archive omits it. */
function readEntryTextOrNull(files: Map<string, Uint8Array>, path: string): string | null {
  const bytes = files.get(path);
  if (!bytes) return null;
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

function ensureManifestItem(opfXml: string, id: string, href: string, mediaType: string): string {
  const doc = parseXml(opfXml);
  const manifest = firstElementByName(doc, 'manifest');
  if (!manifest) throw new MejiroError('epub-invalid-package', 'Cannot find OPF manifest');
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

function dirname(path: string): string {
  return path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
}

function basename(path: string): string {
  return path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path;
}

function manifestIdFromAssetKey(assetKey: string): string {
  return `img-${assetKey.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toUint8Array(data: BinaryInput): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface ChapterSnapshot {
  blocks: EditableBlock[];
  imageAssets: Map<string, EditableImageAsset>;
  dirty: boolean;
}

type HistoryEntry = Map<number, ChapterSnapshot>;

function snapshotChapter(chapter: EditableEpubChapter): ChapterSnapshot {
  return {
    blocks: chapter.blocks.map(cloneEditableBlock),
    imageAssets: new Map(chapter.imageAssets),
    dirty: chapterStateOf(chapter).dirty,
  };
}
