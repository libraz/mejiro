import type { InlineAnnotation } from '@libraz/mejiro/browser';
import {
  type AddImageInput,
  type AnnotatedParagraph,
  type AssetResolver,
  clampEditableEpubSelection,
  cloneEditableEpubBook,
  EditableEpub,
  type EditableEpubBook,
  type EditableEpubImage,
  type EditableEpubSelection,
  type EpubExportOptions,
  type EpubParseLimits,
} from '@libraz/mejiro/epub';
import {
  type ComputedRef,
  computed,
  onBeforeUnmount,
  onMounted,
  type Ref,
  ref,
  shallowRef,
  type WatchStopHandle,
  watch,
} from 'vue';
import { fetchEpubBuffer, readEpubFile, toError } from './errors.js';

export type { EditableEpubSelection } from '@libraz/mejiro/epub';

/** Options for {@link useEditableEpub}. */
export interface UseEditableEpubOptions {
  /** URL fetched and loaded on mount. */
  defaultUrl?: string;
  /** Called after a successful load. */
  onLoad?: (editor: EditableEpub) => void;
  /** Called when a load fails. */
  onError?: (error: Error) => void;
  /** Called after export completes. */
  onExport?: (buffer: ArrayBuffer) => void;
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
  /** Loaded editor, or `null` before any load. */
  editor: Ref<EditableEpub | null>;
  /** The editor's live document, or `null` before any load. */
  book: ComputedRef<EditableEpubBook | null>;
  /** Snapshot of `book` re-cloned on every edit, for feeding a preview reader. */
  previewBook: ComputedRef<EditableEpubBook | null>;
  /** Whether a load is in progress. */
  loading: Ref<boolean>;
  /** Whether an export is in progress. */
  exporting: Ref<boolean>;
  /** Last load error, if any. */
  error: Ref<Error | null>;
  /** Counter bumped on every load, edit, undo and redo. */
  revision: Ref<number>;
  /** Undo / redo availability, or `null` before any load. */
  history: ComputedRef<{
    canUndo: boolean;
    canRedo: boolean;
    depth: number;
    redoDepth: number;
  } | null>;
  /** Paragraph targeted by the editing commands. */
  selection: Ref<EditableEpubSelection>;
  /** The paragraph at `selection`, or `null` when there is none. */
  selectedParagraph: ComputedRef<AnnotatedParagraph | null>;
  /** Moves the selection, clamped to the loaded book. */
  setSelection: (selection: EditableEpubSelection) => void;
  /** Loads an EPUB from an in-memory buffer. */
  loadBuffer: (buffer: ArrayBuffer) => Promise<EditableEpub | null>;
  /** Loads an EPUB from a {@link File}. */
  loadFile: (file: File) => Promise<EditableEpub | null>;
  /** Fetches and loads an EPUB; a non-2xx response is reported as an error. */
  loadUrl: (url: string) => Promise<EditableEpub | null>;
  /** Replaces the selected paragraph's text and, optionally, its inline annotations. */
  updateParagraph: (text: string, inlineAnnotations?: readonly InlineAnnotation[]) => void;
  /** Replaces the selected paragraph's inline annotations. */
  setInlineAnnotations: (inlineAnnotations: readonly InlineAnnotation[]) => void;
  /** Inserts an image into the selected chapter. */
  addImage: (image: AddImageInput | EditableEpubImage) => void;
  /** Reverts the last edit. Returns `false` when there is nothing to undo. */
  undo: () => boolean;
  /** Re-applies the last undone edit. Returns `false` when there is nothing to redo. */
  redo: () => boolean;
  /** Packages the edited document as an EPUB buffer. */
  exportEpub: (options?: EpubExportOptions) => Promise<ArrayBuffer | null>;
}

/** Vue composable for custom editable-EPUB UIs. */
export function useEditableEpub(options: UseEditableEpubOptions = {}): UseEditableEpubReturn {
  const editor = shallowRef<EditableEpub | null>(null);
  const loading = ref(false);
  const exporting = ref(false);
  const error = shallowRef<Error | null>(null);
  const revision = ref(0);
  const selection = ref<EditableEpubSelection>({ chapter: 0, paragraph: 0 });
  let requestId = 0;
  const book = computed(() => editor.value?.book ?? null);
  const selectedParagraph = computed(() => {
    // Edits, undo and redo replace the paragraph mirror in place, so the
    // revision counter is what re-evaluates this computed.
    void revision.value;
    return (
      book.value?.chapters[selection.value.chapter]?.paragraphs[selection.value.paragraph] ?? null
    );
  });
  const previewBook = computed(() => {
    void revision.value;
    return book.value ? cloneEditableEpubBook(book.value) : null;
  });
  const history = computed(() => {
    void revision.value;
    return editor.value?.history ?? null;
  });

  async function loadBufferWithRequest(
    buffer: ArrayBuffer,
    currentRequest: number,
  ): Promise<EditableEpub | null> {
    loading.value = true;
    error.value = null;
    try {
      const next = await EditableEpub.load(buffer, { limits: options.limits });
      if (currentRequest !== requestId) return null;
      editor.value = next;
      selection.value = { chapter: 0, paragraph: 0 };
      revision.value++;
      options.onLoad?.(next);
      return next;
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = toError(err);
        options.onError?.(error.value);
      }
      return null;
    } finally {
      if (currentRequest === requestId) loading.value = false;
    }
  }

  async function loadBuffer(buffer: ArrayBuffer): Promise<EditableEpub | null> {
    const currentRequest = ++requestId;
    return loadBufferWithRequest(buffer, currentRequest);
  }

  async function loadFile(file: File): Promise<EditableEpub | null> {
    const currentRequest = ++requestId;
    loading.value = true;
    error.value = null;
    try {
      return await loadBufferWithRequest(await readEpubFile(file, options.limits), currentRequest);
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = toError(err);
        options.onError?.(error.value);
        loading.value = false;
      }
      return null;
    }
  }

  async function loadUrl(url: string): Promise<EditableEpub | null> {
    const currentRequest = ++requestId;
    loading.value = true;
    error.value = null;
    try {
      return await loadBufferWithRequest(await fetchEpubBuffer(url), currentRequest);
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = toError(err);
        options.onError?.(error.value);
        loading.value = false;
      }
      return null;
    }
  }

  // Deferred to mount so server-side setup never fetches.
  let stopDefaultUrlWatch: WatchStopHandle | undefined;
  onMounted(() => {
    stopDefaultUrlWatch = watch(
      () => options.defaultUrl,
      (url) => {
        if (url) void loadUrl(url);
      },
      { immediate: true },
    );
  });
  onBeforeUnmount(() => {
    stopDefaultUrlWatch?.();
  });

  function setSelection(nextSelection: EditableEpubSelection): void {
    selection.value = clampEditableEpubSelection(book.value, nextSelection);
  }

  function updateParagraph(text: string, inlineAnnotations?: readonly InlineAnnotation[]): void {
    if (!editor.value) return;
    editor.value.updateParagraph(selection.value.chapter, selection.value.paragraph, {
      text,
      inlineAnnotations,
    });
    revision.value++;
  }

  function setInlineAnnotations(inlineAnnotations: readonly InlineAnnotation[]): void {
    if (!editor.value) return;
    editor.value.setInlineAnnotations(
      selection.value.chapter,
      selection.value.paragraph,
      inlineAnnotations,
    );
    revision.value++;
  }

  function addImage(image: AddImageInput | EditableEpubImage): void {
    if (!editor.value) return;
    editor.value.addImage(selection.value.chapter, image);
    revision.value++;
  }

  function undo(): boolean {
    if (!editor.value) return false;
    const changed = editor.value.undo();
    if (changed) revision.value++;
    return changed;
  }

  function redo(): boolean {
    if (!editor.value) return false;
    const changed = editor.value.redo();
    if (changed) revision.value++;
    return changed;
  }

  async function exportEpub(exportOptions?: EpubExportOptions): Promise<ArrayBuffer | null> {
    if (!editor.value) return null;
    exporting.value = true;
    try {
      const buffer = await editor.value.export(
        withAssetResolver(exportOptions, options.assetResolver),
      );
      options.onExport?.(buffer);
      return buffer;
    } finally {
      exporting.value = false;
    }
  }

  return {
    editor,
    book,
    previewBook,
    loading,
    exporting,
    error,
    revision,
    history,
    selection,
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
  options: EpubExportOptions | undefined,
  resolver: AssetResolver | undefined,
): EpubExportOptions | undefined {
  if (!resolver || options?.assetResolver) return options;
  return { ...options, assetResolver: resolver };
}
