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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  editor: EditableEpub | null;
  /** The editor's live document, or `null` before any load. */
  book: EditableEpubBook | null;
  /** Snapshot of `book` re-cloned on every edit, for feeding a preview reader. */
  previewBook: EditableEpubBook | null;
  /** Whether a load is in progress. */
  loading: boolean;
  /** Whether an export is in progress. */
  exporting: boolean;
  /** Last load error, if any. */
  error: Error | null;
  /** Counter bumped on every load, edit, undo and redo. */
  revision: number;
  /** Undo / redo availability, or `null` before any load. */
  history: { canUndo: boolean; canRedo: boolean; depth: number; redoDepth: number } | null;
  /** Paragraph targeted by the editing commands. */
  selection: EditableEpubSelection;
  /** The paragraph at `selection`, or `null` when there is none. */
  selectedParagraph: AnnotatedParagraph | null;
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
  const assetResolverRef = useRef(options.assetResolver);
  onLoadRef.current = options.onLoad;
  onErrorRef.current = options.onError;
  onExportRef.current = options.onExport;
  limitsRef.current = options.limits;
  assetResolverRef.current = options.assetResolver;

  // Actions read the editor and selection through these refs, which loads and
  // setSelection update synchronously, so a call in the same tick sees them.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const loadBufferWithRequest = useCallback(
    async (buffer: ArrayBuffer, requestId: number): Promise<EditableEpub | null> => {
      setLoading(true);
      setError(null);
      try {
        const next = await EditableEpub.load(buffer, { limits: limitsRef.current });
        if (requestId !== requestIdRef.current) return null;
        const firstParagraph = { chapter: 0, paragraph: 0 };
        editorRef.current = next;
        selectionRef.current = firstParagraph;
        setEditor(next);
        setSelectionState(firstParagraph);
        setRevision((value) => value + 1);
        onLoadRef.current?.(next);
        return next;
      } catch (err) {
        if (requestId === requestIdRef.current) {
          const nextError = toError(err);
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
        return await loadBufferWithRequest(await readEpubFile(file, limitsRef.current), requestId);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          const nextError = toError(err);
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
        return await loadBufferWithRequest(await fetchEpubBuffer(url), requestId);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          const nextError = toError(err);
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

  const setSelection = useCallback((nextSelection: EditableEpubSelection) => {
    const next = clampEditableEpubSelection(editorRef.current?.book ?? null, nextSelection);
    selectionRef.current = next;
    setSelectionState(next);
  }, []);

  const updateParagraph = useCallback(
    (text: string, inlineAnnotations?: readonly InlineAnnotation[]) => {
      const current = editorRef.current;
      if (!current) return;
      const { chapter, paragraph } = selectionRef.current;
      current.updateParagraph(chapter, paragraph, { text, inlineAnnotations });
      setRevision((value) => value + 1);
    },
    [],
  );

  const setInlineAnnotations = useCallback((inlineAnnotations: readonly InlineAnnotation[]) => {
    const current = editorRef.current;
    if (!current) return;
    const { chapter, paragraph } = selectionRef.current;
    current.setInlineAnnotations(chapter, paragraph, inlineAnnotations);
    setRevision((value) => value + 1);
  }, []);

  const addImage = useCallback((image: AddImageInput | EditableEpubImage) => {
    const current = editorRef.current;
    if (!current) return;
    current.addImage(selectionRef.current.chapter, image);
    setRevision((value) => value + 1);
  }, []);

  const undo = useCallback((): boolean => {
    const current = editorRef.current;
    if (!current) return false;
    const changed = current.undo();
    if (changed) setRevision((value) => value + 1);
    return changed;
  }, []);

  const redo = useCallback((): boolean => {
    const current = editorRef.current;
    if (!current) return false;
    const changed = current.redo();
    if (changed) setRevision((value) => value + 1);
    return changed;
  }, []);

  const exportEpub = useCallback(
    async (exportOptions?: EpubExportOptions): Promise<ArrayBuffer | null> => {
      const current = editorRef.current;
      if (!current) return null;
      setExporting(true);
      try {
        const buffer = await current.export(
          withAssetResolver(exportOptions, assetResolverRef.current),
        );
        onExportRef.current?.(buffer);
        return buffer;
      } finally {
        setExporting(false);
      }
    },
    [],
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

/** Applies the hook-level `resolver` unless the per-call options carry their own. */
function withAssetResolver(
  options: EpubExportOptions | undefined,
  resolver: AssetResolver | undefined,
): EpubExportOptions | undefined {
  if (!resolver || options?.assetResolver) return options;
  return { ...options, assetResolver: resolver };
}
