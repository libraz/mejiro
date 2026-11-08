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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { markBookIdentity } from './bookIdentity.js';
import { fetchEpubBytes, readEpubFile, toError } from './errors.js';
import type { FetchEpubOptions } from './useEpub.js';
import { useRequestToken } from './useRequestToken.js';

export type { EditableEpubSelection } from '@libraz/mejiro/epub';

/** Options for {@link useEditableEpub}. */
export interface UseEditableEpubOptions {
  /**
   * URL to load. Fetched on mount and again whenever it changes; clearing it
   * abandons a load still in flight and keeps the current editor.
   */
  url?: string;
  /** Called after a successful load. */
  onLoad?: (editor: EditableEpub) => void;
  /**
   * Called when a load or an export fails. A `MejiroError` is passed as
   * thrown; a failed export also rejects the promise `exportEpub` returned.
   */
  onError?: (error: Error) => void;
  /** Called with the EPUB bytes after an export completes. */
  onExport?: (bytes: Uint8Array<ArrayBuffer>) => void;
  /**
   * Extra options merged into the `fetch` call when loading by URL. Useful
   * for sending bearer tokens or cookies (`credentials: 'include'`).
   */
  fetchOptions?: RequestInit;
  /**
   * Custom EPUB fetcher used in place of the global `fetch`. Resolves to the
   * raw bytes. Overrides {@link UseEditableEpubOptions.fetchOptions} when set.
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
   * Loaded editing session, or `null` before any load. Edits made on it
   * directly are picked up like the hook's own: the hook subscribes to it and
   * advances `revision` on every change.
   */
  editor: EditableEpub | null;
  /** The editor's live document, or `null` before any load. */
  epub: EditableEpubBook | null;
  /**
   * The document projected onto the reader's {@link EpubBook} shape, rebuilt
   * on every change, for feeding a preview reader.
   */
  previewEpub: EpubBook | null;
  /** Whether a load is in progress. */
  loading: boolean;
  /** Whether an export is in progress. */
  exporting: boolean;
  /** Last load or export error, if any. */
  error: Error | null;
  /** Counter advanced on every load and every change to the document. */
  revision: number;
  /** Undo / redo availability, or `null` before any load. */
  history: EditHistoryState | null;
  /** Block targeted by the editing commands. */
  selection: EditableEpubSelection;
  /** The paragraph block at `selection`, or `null` when no paragraph is selected. */
  selectedParagraph: EditableParagraphBlock | null;
  /** Moves the selection, clamped to the loaded document. */
  setSelection: (selection: EditableEpubSelection) => void;
  /**
   * Loads an EPUB from in-memory bytes. A `Uint8Array` is read through its own
   * view and is neither retained nor modified.
   */
  loadBuffer: (bytes: BinaryInput) => Promise<EditableEpub | null>;
  /** Loads an EPUB from a {@link File}. */
  loadFile: (file: File) => Promise<EditableEpub | null>;
  /** Fetches and loads an EPUB; a non-2xx response is reported as `fetch-failed`. */
  loadUrl: (url: string) => Promise<EditableEpub | null>;
  /**
   * Applies `patch` to the selected paragraph, as
   * {@link EditableEpub.updateParagraph} does. Does nothing when no block is
   * selected.
   */
  updateParagraph: (patch: ParagraphPatch) => void;
  /** Replaces the selected paragraph's inline annotations. Does nothing when no block is selected. */
  setInlineAnnotations: (inlineAnnotations: readonly InlineAnnotation[]) => void;
  /**
   * Inserts an image into the selected chapter, as {@link EditableEpub.addImage}
   * does, and returns the stored block; `null` before any load.
   */
  addImage: (image: AddImageInput) => EditableImageBlock | null;
  /** Reverts the last edit. Returns `false` when there is nothing to undo. */
  undo: () => boolean;
  /** Re-applies the last undone edit. Returns `false` when there is nothing to redo. */
  redo: () => boolean;
  /**
   * Packages the edited document as EPUB bytes; `null` before any load. A
   * failure is stored in `error`, passed to `onError` and rejects.
   */
  exportEpub: (options?: EditableEpubExportOptions) => Promise<Uint8Array<ArrayBuffer> | null>;
}

/** Selection of the first block of the first chapter. */
function firstBlock(epub: EditableEpubBook): EditableEpubSelection {
  return { chapterIndex: 0, blockId: epub.chapters[0]?.blocks[0]?.id ?? null };
}

/**
 * Headless editable-EPUB state for custom proofreading/editor UIs.
 *
 * One load runs at a time: starting another, changing `url` or unmounting
 * aborts the one in flight — its fetch and parse included — and its result is
 * dropped.
 */
export function useEditableEpub(options: UseEditableEpubOptions = {}): UseEditableEpubReturn {
  const [editor, setEditor] = useState<EditableEpub | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [selection, setSelectionState] = useState<EditableEpubSelection>({
    chapterIndex: 0,
    blockId: null,
  });
  const request = useRequestToken();
  const controllerRef = useRef<AbortController | null>(null);
  const exportsInFlightRef = useRef(0);

  const onLoadRef = useRef(options.onLoad);
  const onErrorRef = useRef(options.onError);
  const onExportRef = useRef(options.onExport);
  const limitsRef = useRef(options.limits);
  const assetResolverRef = useRef(options.assetResolver);
  const fetchOptionsRef = useRef(options.fetchOptions);
  const fetchEpubRef = useRef(options.fetchEpub);
  onLoadRef.current = options.onLoad;
  onErrorRef.current = options.onError;
  onExportRef.current = options.onExport;
  limitsRef.current = options.limits;
  assetResolverRef.current = options.assetResolver;
  fetchOptionsRef.current = options.fetchOptions;
  fetchEpubRef.current = options.fetchEpub;

  // Actions read the editor and selection through these refs, which loads and
  // setSelection update synchronously, so a call in the same tick sees them.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  /** Aborts the load in flight, if any, and makes its result stale. */
  const abandon = useCallback(() => {
    request.invalidate();
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, [request]);

  useEffect(() => abandon, [abandon]);

  // Every change to the document, through the hook or the editor itself,
  // advances `revision`. The subscription is taken as the session is loaded, so
  // an edit in the same tick is not missed, and released with the hook.
  const unsubscribeRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    },
    [],
  );

  const reportError = useCallback((cause: unknown) => {
    const nextError = toError(cause);
    setError(nextError);
    onErrorRef.current?.(nextError);
  }, []);

  /** Opens whatever `read` yields; every failure lands in `error` and `onError` once. */
  const load = useCallback(
    async (read: (signal: AbortSignal) => Promise<BinaryInput>): Promise<EditableEpub | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const currentRequest = request.begin();
      const { signal } = controller;
      setLoading(true);
      setError(null);
      try {
        const next = await parseEditableEpub(await read(signal), {
          limits: limitsRef.current,
          signal,
        });
        if (!request.isCurrent(currentRequest)) return null;
        const first = firstBlock(next.epub);
        unsubscribeRef.current?.();
        unsubscribeRef.current = next.subscribe(() => setRevision((value) => value + 1));
        editorRef.current = next;
        selectionRef.current = first;
        setEditor(next);
        setSelectionState(first);
        setRevision((value) => value + 1);
        onLoadRef.current?.(next);
        return next;
      } catch (err) {
        if (request.isCurrent(currentRequest)) reportError(err);
        return null;
      } finally {
        if (request.isCurrent(currentRequest)) {
          setLoading(false);
          controllerRef.current = null;
        }
      }
    },
    [request, reportError],
  );

  const loadBuffer = useCallback((bytes: BinaryInput) => load(async () => bytes), [load]);

  const loadFile = useCallback(
    (file: File) => load(() => readEpubFile(file, limitsRef.current)),
    [load],
  );

  const loadUrl = useCallback(
    (url: string) =>
      load((signal) =>
        fetchEpubBytes(
          url,
          { fetchEpub: fetchEpubRef.current, fetchOptions: fetchOptionsRef.current },
          signal,
        ),
      ),
    [load],
  );

  // A URL load still in flight when the URL changes or clears is abandoned.
  const url = options.url;
  useEffect(() => {
    if (!url) return;
    void loadUrl(url);
    const urlRequest = request.current();
    return () => {
      if (!request.isCurrent(urlRequest)) return;
      abandon();
      setLoading(false);
    };
  }, [url, loadUrl, request, abandon]);

  const epub = editor?.epub ?? null;
  const chapter = epub?.chapters[selection.chapterIndex];
  const selectedBlock = chapter?.blocks.find((block) => block.id === selection.blockId);
  const selectedParagraph = selectedBlock?.kind === 'paragraph' ? selectedBlock : null;
  const previewEpub = useMemo(() => {
    void revision;
    return epub && editor ? markBookIdentity(editableEpubToEpubBook(epub), editor) : null;
  }, [epub, editor, revision]);
  const history = editor?.history ?? null;

  const setSelection = useCallback((nextSelection: EditableEpubSelection) => {
    const next = clampEditableEpubSelection(editorRef.current?.epub ?? null, nextSelection);
    selectionRef.current = next;
    setSelectionState(next);
  }, []);

  const updateParagraph = useCallback((patch: ParagraphPatch) => {
    const current = editorRef.current;
    const { chapterIndex, blockId } = selectionRef.current;
    if (!(current && blockId !== null)) return;
    current.updateParagraph(chapterIndex, blockId, patch);
  }, []);

  const setInlineAnnotations = useCallback((inlineAnnotations: readonly InlineAnnotation[]) => {
    const current = editorRef.current;
    const { chapterIndex, blockId } = selectionRef.current;
    if (!(current && blockId !== null)) return;
    current.setInlineAnnotations(chapterIndex, blockId, inlineAnnotations);
  }, []);

  const addImage = useCallback((image: AddImageInput): EditableImageBlock | null => {
    const current = editorRef.current;
    if (!current) return null;
    return current.addImage(selectionRef.current.chapterIndex, image);
  }, []);

  const undo = useCallback((): boolean => editorRef.current?.undo() ?? false, []);

  const redo = useCallback((): boolean => editorRef.current?.redo() ?? false, []);

  const exportEpub = useCallback(
    async (exportOptions?: EditableEpubExportOptions): Promise<Uint8Array<ArrayBuffer> | null> => {
      const current = editorRef.current;
      if (!current) return null;
      exportsInFlightRef.current++;
      setExporting(true);
      try {
        const bytes = await current.export(
          withAssetResolver(exportOptions, assetResolverRef.current),
        );
        onExportRef.current?.(bytes);
        return bytes;
      } catch (err) {
        reportError(err);
        throw err;
      } finally {
        setExporting(--exportsInFlightRef.current > 0);
      }
    },
    [reportError],
  );

  return {
    editor,
    epub,
    previewEpub,
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
  options: EditableEpubExportOptions | undefined,
  resolver: AssetResolver | undefined,
): EditableEpubExportOptions | undefined {
  if (!resolver || options?.assetResolver) return options;
  return { ...options, assetResolver: resolver };
}
