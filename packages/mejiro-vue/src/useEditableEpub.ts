import type { BinaryInput, InlineAnnotation } from '@libraz/mejiro';
import {
  type AddImageInput,
  type AssetResolver,
  clampEditableEpubSelection,
  type EditableEpub,
  type EditableEpubBook,
  type EditableEpubExportOptions,
  type EditableEpubSelection,
  type EditableImageBlock,
  type EditableParagraphBlock,
  type EditHistoryState,
  type EpubBook,
  type EpubParseLimits,
  editableEpubToEpubBook,
  type ParagraphPatch,
  parseEditableEpub,
} from '@libraz/mejiro/epub';
import {
  type ComputedRef,
  computed,
  getCurrentScope,
  type MaybeRefOrGetter,
  markRaw,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toValue,
  type WatchStopHandle,
  watch,
} from 'vue';
import { markBookIdentity } from './bookIdentity.js';
import { fetchEpubBuffer, readEpubFile, toError } from './errors.js';
import type { FetchEpubOptions } from './useEpub.js';
import { createRequestToken } from './useRequestToken.js';

export type { EditableEpubSelection } from '@libraz/mejiro/epub';

/** Options for {@link useEditableEpub}. */
export interface UseEditableEpubOptions {
  /**
   * URL fetched and loaded once mounted. A ref or getter loads every new URL,
   * abandoning the load still in flight; an empty value loads nothing.
   */
  url?: MaybeRefOrGetter<string | null | undefined>;
  /** Called after a successful load. */
  onLoad?: (editor: EditableEpub) => void;
  /**
   * Called when a load or an export fails. A failed export also lands in
   * `error`, and its promise still rejects. A `MejiroError` arrives as thrown.
   */
  onError?: (error: Error) => void;
  /** Called with the EPUB bytes once an export completes. */
  onExport?: (bytes: Uint8Array<ArrayBuffer>) => void;
  /**
   * Extra options merged into the `fetch` call when loading by URL. Useful
   * for sending bearer tokens or cookies (`credentials: 'include'`). Its
   * `signal` is replaced by the composable's own.
   */
  fetchOptions?: RequestInit;
  /**
   * Custom EPUB fetcher used in place of the global `fetch`. Returns the raw
   * bytes. Overrides {@link UseEditableEpubOptions.fetchOptions} when set.
   */
  fetchEpub?: (url: string, options: FetchEpubOptions) => Promise<BinaryInput>;
  /**
   * Archive resource limits applied while opening an EPUB. Raise them for
   * trusted, image-heavy books; tighten them for a public drop zone. Omitted
   * fields keep their `DEFAULT_EPUB_PARSE_LIMITS` value.
   */
  limits?: Partial<EpubParseLimits>;
  /**
   * Resolves URL-only images into bytes when {@link UseEditableEpubReturn.exportEpub}
   * packages the book. An `assetResolver` passed to `exportEpub` itself wins.
   */
  assetResolver?: AssetResolver;
}

/** Return value of {@link useEditableEpub}. */
export interface UseEditableEpubReturn {
  /**
   * Loaded editor, or `null` before any load. Edits made on it directly are
   * picked up like the composable's own: `revision`, `history` and
   * `previewEpub` follow every change it reports.
   */
  editor: Readonly<Ref<EditableEpub | null>>;
  /** The editor's live document, or `null` before any load. */
  epub: ComputedRef<EditableEpubBook | null>;
  /**
   * The edited document as an {@link EpubBook}, rebuilt on every change, for
   * feeding a preview reader. `null` before any load.
   */
  previewEpub: ComputedRef<EpubBook | null>;
  /** Whether a load is in progress. */
  loading: Readonly<Ref<boolean>>;
  /** Whether an export is in progress. */
  exporting: Readonly<Ref<boolean>>;
  /** Last load or export error, if any. */
  error: Readonly<Ref<Error | null>>;
  /** Counter bumped on every load and every change the editor reports. */
  revision: Readonly<Ref<number>>;
  /** Undo / redo availability, or `null` before any load. */
  history: ComputedRef<EditHistoryState | null>;
  /** Block targeted by the editing commands. Change it through `setSelection`. */
  selection: Readonly<Ref<EditableEpubSelection>>;
  /** The paragraph block at `selection`, or `null` when none is selected or it is an image. */
  selectedParagraph: ComputedRef<EditableParagraphBlock | null>;
  /** Moves the selection, clamped to the loaded book. */
  setSelection: (selection: EditableEpubSelection) => void;
  /** Loads an EPUB from in-memory bytes. */
  loadBuffer: (bytes: BinaryInput) => Promise<EditableEpub | null>;
  /** Loads an EPUB from a {@link File}. */
  loadFile: (file: File) => Promise<EditableEpub | null>;
  /** Fetches and loads an EPUB; a non-2xx response is reported as an error. */
  loadUrl: (url: string) => Promise<EditableEpub | null>;
  /**
   * Applies `patch` to the selected paragraph. No-op without a loaded editor
   * or a selected block.
   * @throws RangeError when the selected block is not a paragraph.
   */
  updateParagraph: (patch: ParagraphPatch) => void;
  /**
   * Replaces the selected paragraph's inline annotations. No-op without a
   * loaded editor or a selected block.
   * @throws RangeError when the selected block is not a paragraph.
   */
  setInlineAnnotations: (inlineAnnotations: readonly InlineAnnotation[]) => void;
  /**
   * Inserts an image into the selected chapter and returns the block it
   * created, or `null` without a loaded editor.
   */
  addImage: (image: AddImageInput) => EditableImageBlock | null;
  /** Reverts the last edit. Returns `false` when there is nothing to undo. */
  undo: () => boolean;
  /** Re-applies the last undone edit. Returns `false` when there is nothing to redo. */
  redo: () => boolean;
  /**
   * Packages the edited document as EPUB bytes; `null` without a loaded
   * editor. A failure lands in `error` and `onError` and the promise rejects.
   */
  exportEpub: (options?: EditableEpubExportOptions) => Promise<Uint8Array<ArrayBuffer> | null>;
}

/** The selection a freshly loaded book starts with: its first block. */
function initialSelection(epub: EditableEpubBook): EditableEpubSelection {
  return { chapterIndex: 0, blockId: epub.chapters[0]?.blocks[0]?.id ?? null };
}

/**
 * Vue composable for custom editable-EPUB UIs.
 *
 * Starting a load aborts the one still in flight — its fetch and parse are
 * cancelled through their `signal`, and it settles to `null` without
 * reporting — and so does disposing the owning scope. When `options.url` is
 * set, it is fetched and loaded once mounted, and again whenever a reactive
 * `url` changes.
 */
export function useEditableEpub(options: UseEditableEpubOptions = {}): UseEditableEpubReturn {
  const editor = shallowRef<EditableEpub | null>(null);
  const loading = shallowRef(false);
  const exporting = shallowRef(false);
  const error = shallowRef<Error | null>(null);
  const revision = shallowRef(0);
  const selection = shallowRef<EditableEpubSelection>({ chapterIndex: 0, blockId: null });
  const request = createRequestToken();
  let controller: AbortController | null = null;
  let unsubscribe: (() => void) | null = null;
  let exportsInFlight = 0;

  const epub = computed(() => editor.value?.epub ?? null);
  // Edits, undo and redo change the document in place, so the revision counter
  // is what re-evaluates the derived values below.
  const selectedParagraph = computed(() => {
    void revision.value;
    const { chapterIndex, blockId } = selection.value;
    const block = epub.value?.chapters[chapterIndex]?.blocks.find((b) => b.id === blockId);
    return block?.kind === 'paragraph' ? block : null;
  });
  const previewEpub = computed(() => {
    void revision.value;
    return epub.value && editor.value
      ? markBookIdentity(editableEpubToEpubBook(epub.value), editor.value)
      : null;
  });
  const history = computed(() => {
    void revision.value;
    return editor.value?.history ?? null;
  });

  /** Makes `next` the current editor, following every change it reports. */
  function adopt(next: EditableEpub): void {
    unsubscribe?.();
    editor.value = next;
    selection.value = initialSelection(next.epub);
    revision.value++;
    unsubscribe = next.subscribe(() => {
      revision.value++;
    });
  }

  /** Aborts the load in flight, if any, and makes its result stale. */
  function abandon(): void {
    request.invalidate();
    controller?.abort();
    controller = null;
  }

  async function load(
    read: (signal: AbortSignal) => Promise<BinaryInput>,
  ): Promise<EditableEpub | null> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    const currentRequest = request.begin();
    loading.value = true;
    error.value = null;
    try {
      const next = markRaw(
        await parseEditableEpub(await read(own.signal), {
          limits: options.limits,
          signal: own.signal,
        }),
      );
      if (!request.isCurrent(currentRequest)) return null;
      adopt(next);
      options.onLoad?.(next);
      return next;
    } catch (err) {
      if (request.isCurrent(currentRequest)) {
        error.value = toError(err);
        options.onError?.(error.value);
      }
      return null;
    } finally {
      if (request.isCurrent(currentRequest)) {
        loading.value = false;
        controller = null;
      }
    }
  }

  function loadBuffer(bytes: BinaryInput): Promise<EditableEpub | null> {
    return load(async () => bytes);
  }

  function loadFile(file: File): Promise<EditableEpub | null> {
    return load(() => readEpubFile(file, options.limits));
  }

  function loadUrl(url: string): Promise<EditableEpub | null> {
    return load((signal) =>
      options.fetchEpub
        ? options.fetchEpub(url, { signal })
        : fetchEpubBuffer(url, { ...options.fetchOptions, signal }),
    );
  }

  // Deferred to mount so server-side setup never fetches.
  let stopUrlWatch: WatchStopHandle | undefined;
  onMounted(() => {
    stopUrlWatch = watch(
      () => toValue(options.url),
      (url, _previous, onCleanup) => {
        if (!url) return;
        void loadUrl(url);
        const urlRequest = request.current();
        // A URL load still in flight when the URL changes or clears is abandoned.
        onCleanup(() => {
          if (!request.isCurrent(urlRequest)) return;
          abandon();
          loading.value = false;
        });
      },
      { immediate: true },
    );
  });
  onBeforeUnmount(() => {
    stopUrlWatch?.();
  });
  if (getCurrentScope()) {
    onScopeDispose(() => {
      abandon();
      unsubscribe?.();
      unsubscribe = null;
    });
  }

  function setSelection(nextSelection: EditableEpubSelection): void {
    selection.value = clampEditableEpubSelection(epub.value, nextSelection);
  }

  function updateParagraph(patch: ParagraphPatch): void {
    const { chapterIndex, blockId } = selection.value;
    if (!(editor.value && blockId !== null)) return;
    editor.value.updateParagraph(chapterIndex, blockId, patch);
  }

  function setInlineAnnotations(inlineAnnotations: readonly InlineAnnotation[]): void {
    const { chapterIndex, blockId } = selection.value;
    if (!(editor.value && blockId !== null)) return;
    editor.value.setInlineAnnotations(chapterIndex, blockId, inlineAnnotations);
  }

  function addImage(image: AddImageInput): EditableImageBlock | null {
    if (!editor.value) return null;
    return editor.value.addImage(selection.value.chapterIndex, image);
  }

  function undo(): boolean {
    return editor.value ? editor.value.undo() : false;
  }

  function redo(): boolean {
    return editor.value ? editor.value.redo() : false;
  }

  async function exportEpub(
    exportOptions?: EditableEpubExportOptions,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!editor.value) return null;
    exportsInFlight++;
    exporting.value = true;
    try {
      const bytes = await editor.value.export(
        withAssetResolver(exportOptions, options.assetResolver),
      );
      options.onExport?.(bytes);
      return bytes;
    } catch (err) {
      error.value = toError(err);
      options.onError?.(error.value);
      throw err;
    } finally {
      exporting.value = --exportsInFlight > 0;
    }
  }

  return {
    editor: shallowReadonly(editor),
    epub,
    previewEpub,
    loading: shallowReadonly(loading),
    exporting: shallowReadonly(exporting),
    error: shallowReadonly(error),
    revision: shallowReadonly(revision),
    history,
    selection: shallowReadonly(selection),
    selectedParagraph,
    setSelection,
    loadBuffer,
    loadFile,
    loadUrl,
    updateParagraph,
    setInlineAnnotations,
    addImage,
    undo,
    redo,
    exportEpub,
  };
}

/** Applies the composable-level `resolver` unless the per-call options carry their own. */
function withAssetResolver(
  options: EditableEpubExportOptions | undefined,
  resolver: AssetResolver | undefined,
): EditableEpubExportOptions | undefined {
  if (!resolver || options?.assetResolver) return options;
  return { ...options, assetResolver: resolver };
}
