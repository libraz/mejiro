import type { InlineAnnotation } from '@libraz/mejiro/browser';
import {
  type AddImageInput,
  type AnnotatedParagraph,
  EditableEpub,
  type EditableEpubBook,
  type EditableEpubImage,
  type EpubExportOptions,
} from '@libraz/mejiro/epub';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface EditableEpubSelection {
  chapter: number;
  paragraph: number;
}

export interface UseEditableEpubOptions {
  /** URL fetched and loaded on mount. */
  defaultUrl?: string;
  /** Called after a successful load. */
  onLoad?: (editor: EditableEpub) => void;
  /** Called when a load fails. */
  onError?: (error: Error) => void;
  /** Called after export completes. */
  onExport?: (buffer: ArrayBuffer) => void;
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
  onLoadRef.current = options.onLoad;
  onErrorRef.current = options.onError;
  onExportRef.current = options.onExport;

  const loadBufferWithRequest = useCallback(
    async (buffer: ArrayBuffer, requestId: number): Promise<EditableEpub | null> => {
      setLoading(true);
      setError(null);
      try {
        const next = await EditableEpub.load(buffer);
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
    return book ? cloneBook(book) : null;
  }, [book, revision]);
  const history = editor?.history ?? null;

  const setSelection = useCallback(
    (nextSelection: EditableEpubSelection) => {
      setSelectionState(clampSelection(book, nextSelection));
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

function cloneBook(book: EditableEpubBook): EditableEpubBook {
  return {
    ...book,
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      blocks: chapter.blocks.map((block) =>
        block.kind === 'paragraph'
          ? { ...block, inlineAnnotations: [...block.inlineAnnotations] }
          : { ...block },
      ),
      imageAssets: new Map(chapter.imageAssets),
      originalImageHrefs: chapter.originalImageHrefs ? [...chapter.originalImageHrefs] : undefined,
      paragraphs: chapter.paragraphs.map((paragraph) => ({
        ...paragraph,
        inlineAnnotations: [...paragraph.inlineAnnotations],
      })),
      paragraphRefs: chapter.paragraphRefs ? [...chapter.paragraphRefs] : undefined,
    })),
    packageData: {
      ...book.packageData,
      files: new Map(book.packageData.files),
    },
  };
}

function clampSelection(
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
