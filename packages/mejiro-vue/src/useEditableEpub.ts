import type { InlineAnnotation } from '@libraz/mejiro/browser';
import {
  type AddImageInput,
  type AnnotatedParagraph,
  clampEditableEpubSelection,
  cloneEditableEpubBook,
  EditableEpub,
  type EditableEpubBook,
  type EditableEpubImage,
  type EditableEpubSelection,
  type EpubExportOptions,
  type EpubParseLimits,
} from '@libraz/mejiro/epub';
import { type ComputedRef, computed, type Ref, ref, shallowRef, watch } from 'vue';

export type { EditableEpubSelection } from '@libraz/mejiro/epub';

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
}

export interface UseEditableEpubReturn {
  editor: Ref<EditableEpub | null>;
  book: ComputedRef<EditableEpubBook | null>;
  previewBook: ComputedRef<EditableEpubBook | null>;
  loading: Ref<boolean>;
  exporting: Ref<boolean>;
  error: Ref<Error | null>;
  revision: Ref<number>;
  history: ComputedRef<{
    canUndo: boolean;
    canRedo: boolean;
    depth: number;
    redoDepth: number;
  } | null>;
  selection: Ref<EditableEpubSelection>;
  selectedParagraph: ComputedRef<AnnotatedParagraph | null>;
  setSelection: (selection: EditableEpubSelection) => void;
  loadBuffer: (buffer: ArrayBuffer) => Promise<EditableEpub | null>;
  loadFile: (file: File) => Promise<EditableEpub | null>;
  loadUrl: (url: string) => Promise<EditableEpub | null>;
  updateParagraph: (text: string, inlineAnnotations?: readonly InlineAnnotation[]) => void;
  setInlineAnnotations: (inlineAnnotations: readonly InlineAnnotation[]) => void;
  addImage: (image: AddImageInput | EditableEpubImage) => void;
  undo: () => boolean;
  redo: () => boolean;
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
        error.value = err instanceof Error ? err : new Error(String(err));
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
      return await loadBufferWithRequest(await file.arrayBuffer(), currentRequest);
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = err instanceof Error ? err : new Error(String(err));
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
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load EPUB: ${res.status}`);
      return await loadBufferWithRequest(await res.arrayBuffer(), currentRequest);
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = err instanceof Error ? err : new Error(String(err));
        options.onError?.(error.value);
        loading.value = false;
      }
      return null;
    }
  }

  watch(
    () => options.defaultUrl,
    (url) => {
      if (url) void loadUrl(url);
    },
    { immediate: true },
  );

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
      const buffer = await editor.value.export(exportOptions);
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
