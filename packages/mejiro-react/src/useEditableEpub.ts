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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  editor: EditableEpub | null;
  book: EditableEpubBook | null;
  previewBook: EditableEpubBook | null;
  loading: boolean;
  exporting: boolean;
  error: Error | null;
  revision: number;
  history: { canUndo: boolean; canRedo: boolean; depth: number; redoDepth: number } | null;
  selection: EditableEpubSelection;
  selectedParagraph: AnnotatedParagraph | null;
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

/** Headless editable-EPUB state for custom proofreading/editor UIs. */
export function useEditableEpub(options: UseEditableEpubOptions = {}): UseEditableEpubReturn {
  const [editor, setEditor] = useState<EditableEpub | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [selection, setSelectionState] = useState<EditableEpubSelection>({
    chapter: 0,
    paragraph: 0,
  });
  const requestIdRef = useRef(0);

  const onLoadRef = useRef(options.onLoad);
  const onErrorRef = useRef(options.onError);
  const onExportRef = useRef(options.onExport);
  const limitsRef = useRef(options.limits);
  onLoadRef.current = options.onLoad;
  onErrorRef.current = options.onError;
  onExportRef.current = options.onExport;
  limitsRef.current = options.limits;

  const loadBufferWithRequest = useCallback(
    async (buffer: ArrayBuffer, requestId: number): Promise<EditableEpub | null> => {
      setLoading(true);
      setError(null);
      try {
        const next = await EditableEpub.load(buffer, { limits: limitsRef.current });
        if (requestId !== requestIdRef.current) return null;
        setEditor(next);
        setSelectionState({ chapter: 0, paragraph: 0 });
        setRevision((value) => value + 1);
        onLoadRef.current?.(next);
        return next;
      } catch (err) {
        if (requestId === requestIdRef.current) {
          const nextError = err instanceof Error ? err : new Error(String(err));
          setError(nextError);
          onErrorRef.current?.(nextError);
        }
        return null;
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [],
  );

  const loadBuffer = useCallback(
    async (buffer: ArrayBuffer): Promise<EditableEpub | null> => {
      const requestId = ++requestIdRef.current;
      return loadBufferWithRequest(buffer, requestId);
    },
    [loadBufferWithRequest],
  );

  const loadFile = useCallback(
    async (file: File): Promise<EditableEpub | null> => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        return await loadBufferWithRequest(await file.arrayBuffer(), requestId);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          const nextError = err instanceof Error ? err : new Error(String(err));
          setError(nextError);
          onErrorRef.current?.(nextError);
          setLoading(false);
        }
        return null;
      }
    },
    [loadBufferWithRequest],
  );

  const loadUrl = useCallback(
    async (url: string): Promise<EditableEpub | null> => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load EPUB: ${res.status}`);
        return await loadBufferWithRequest(await res.arrayBuffer(), requestId);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          const nextError = err instanceof Error ? err : new Error(String(err));
          setError(nextError);
          onErrorRef.current?.(nextError);
          setLoading(false);
        }
        return null;
      }
    },
    [loadBufferWithRequest],
  );

  useEffect(() => {
    if (options.defaultUrl) void loadUrl(options.defaultUrl);
  }, [options.defaultUrl, loadUrl]);

  const book = editor?.book ?? null;
  const selectedParagraph =
    book?.chapters[selection.chapter]?.paragraphs[selection.paragraph] ?? null;
  const previewBook = useMemo(() => {
    void revision;
    return book ? cloneEditableEpubBook(book) : null;
  }, [book, revision]);
  const history = editor?.history ?? null;

  const setSelection = useCallback(
    (nextSelection: EditableEpubSelection) => {
      setSelectionState(clampEditableEpubSelection(book, nextSelection));
    },
    [book],
  );

  const updateParagraph = useCallback(
    (text: string, inlineAnnotations?: readonly InlineAnnotation[]) => {
      if (!editor) return;
      editor.updateParagraph(selection.chapter, selection.paragraph, {
        text,
        inlineAnnotations,
      });
      setRevision((value) => value + 1);
    },
    [editor, selection.chapter, selection.paragraph],
  );

  const setInlineAnnotations = useCallback(
    (inlineAnnotations: readonly InlineAnnotation[]) => {
      if (!editor) return;
      editor.setInlineAnnotations(selection.chapter, selection.paragraph, inlineAnnotations);
      setRevision((value) => value + 1);
    },
    [editor, selection.chapter, selection.paragraph],
  );

  const addImage = useCallback(
    (image: AddImageInput | EditableEpubImage) => {
      if (!editor) return;
      editor.addImage(selection.chapter, image);
      setRevision((value) => value + 1);
    },
    [editor, selection.chapter],
  );

  const undo = useCallback((): boolean => {
    if (!editor) return false;
    const changed = editor.undo();
    if (changed) setRevision((value) => value + 1);
    return changed;
  }, [editor]);

  const redo = useCallback((): boolean => {
    if (!editor) return false;
    const changed = editor.redo();
    if (changed) setRevision((value) => value + 1);
    return changed;
  }, [editor]);

  const exportEpub = useCallback(
    async (options?: EpubExportOptions): Promise<ArrayBuffer | null> => {
      if (!editor) return null;
      setExporting(true);
      try {
        const buffer = await editor.export(options);
        onExportRef.current?.(buffer);
        return buffer;
      } finally {
        setExporting(false);
      }
    },
    [editor],
  );

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
