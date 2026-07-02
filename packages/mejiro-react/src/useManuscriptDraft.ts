import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManuscriptEditorChapter } from './MejiroManuscriptEditor.js';

/** Options for {@link useManuscriptDraft}. */
export interface UseManuscriptDraftOptions<TAutosave = ManuscriptEditorChapter[]> {
  /** Initial chapters. Defaults to a single empty chapter. */
  initialChapters?: ManuscriptEditorChapter[];
  /**
   * Called when the draft changes (debounced). Use to persist to
   * localStorage, IndexedDB, or upload to a server.
   */
  onAutosave?: (draft: TAutosave) => void | Promise<void>;
  /** Maps chapters to the autosave payload. Defaults to the chapter array. */
  autosavePayload?: (chapters: ManuscriptEditorChapter[]) => TAutosave;
  /** Extra key that triggers autosave when non-chapter metadata changes. */
  autosaveKey?: string;
  /** Debounce delay in milliseconds. @defaultValue 800 */
  autosaveDelay?: number;
  /** Creates the default title for a generated chapter. */
  defaultChapterTitle?: (index: number) => string;
  /** Creates the default body for a generated chapter. */
  defaultChapterBody?: (index: number) => string;
}

/** Return value of {@link useManuscriptDraft}. */
export interface UseManuscriptDraftReturn {
  chapters: ManuscriptEditorChapter[];
  /** Index of the chapter currently being edited. */
  selected: number;
  setSelected(index: number): void;
  setChapters(chapters: ManuscriptEditorChapter[]): void;
  patchChapter(index: number, patch: Partial<ManuscriptEditorChapter>): void;
  addChapter(chapter?: Partial<ManuscriptEditorChapter>): void;
  removeChapter(index: number): void;
  reorderChapters(from: number, to: number): void;
  /** Last autosave failure, if any. */
  autosaveError: Error | null;
  /** Immediately saves the latest dirty draft, if one exists. */
  flushAutosave(): void;
}

const DEFAULT_DELAY = 800;

function defaultChapter(
  index: number,
  titleFor: (index: number) => string = (i) => `第${i + 1}話`,
  bodyFor: (index: number) => string = () => '',
): ManuscriptEditorChapter {
  return { id: `chapter-${Date.now()}-${index}`, title: titleFor(index), body: bodyFor(index) };
}

/**
 * Reactive store for manuscript drafts.
 *
 * Wraps the chapter array with helpers for adding, removing, reordering, and
 * patching individual chapters, plus a debounced autosave hook that fires
 * `onAutosave` whenever the chapter list settles.
 */
export function useManuscriptDraft<TAutosave = ManuscriptEditorChapter[]>(
  options: UseManuscriptDraftOptions<TAutosave> = {},
): UseManuscriptDraftReturn {
  const {
    onAutosave,
    autosaveDelay = DEFAULT_DELAY,
    autosavePayload,
    autosaveKey,
    defaultChapterTitle,
    defaultChapterBody,
  } = options;
  const titleForRef = useRef(defaultChapterTitle);
  titleForRef.current = defaultChapterTitle;
  const bodyForRef = useRef(defaultChapterBody);
  bodyForRef.current = defaultChapterBody;
  const [chapters, setChaptersState] = useState<ManuscriptEditorChapter[]>(() =>
    options.initialChapters?.length
      ? options.initialChapters
      : [defaultChapter(0, defaultChapterTitle, defaultChapterBody)],
  );
  const [selected, setSelectedState] = useState(0);
  const [autosaveError, setAutosaveError] = useState<Error | null>(null);

  const saveRef = useRef(onAutosave);
  saveRef.current = onAutosave;
  const payloadRef = useRef(autosavePayload);
  payloadRef.current = autosavePayload;
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const didMountRef = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);

  const flushAutosave = useCallback(() => {
    const callback = saveRef.current;
    if (!(callback && dirtyRef.current)) return;
    dirtyRef.current = false;
    const payload = payloadRef.current
      ? payloadRef.current(chaptersRef.current)
      : (chaptersRef.current as TAutosave);
    void Promise.resolve(callback(payload)).catch((err) => {
      if (!mountedRef.current) return;
      setAutosaveError(err instanceof Error ? err : new Error(String(err)));
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: chapters/autosaveKey intentionally schedule autosave; latest payload is read from refs.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return undefined;
    }
    if (!saveRef.current) return undefined;
    dirtyRef.current = true;
    setAutosaveError(null);
    const timer = setTimeout(() => {
      flushAutosave();
    }, autosaveDelay);
    return () => clearTimeout(timer);
  }, [chapters, autosaveKey, autosaveDelay, flushAutosave]);

  useEffect(() => {
    mountedRef.current = true;
    const handleBeforeUnload = () => flushAutosave();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      flushAutosave();
      mountedRef.current = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushAutosave]);

  const setSelected = useCallback(
    (index: number) => {
      setSelectedState(() => Math.max(0, Math.min(index, chapters.length - 1)));
    },
    [chapters.length],
  );

  const setChapters = useCallback(
    (next: ManuscriptEditorChapter[]) => {
      const normalized = next.length
        ? next
        : [defaultChapter(0, titleForRef.current, bodyForRef.current)];
      setChaptersState(normalized);
      setSelectedState((current) => {
        const selectedId = chapters[current]?.id;
        const nextIndex = selectedId
          ? normalized.findIndex((chapter) => chapter.id === selectedId)
          : -1;
        return nextIndex >= 0 ? nextIndex : Math.max(0, Math.min(current, normalized.length - 1));
      });
    },
    [chapters],
  );

  const patchChapter = useCallback((index: number, patch: Partial<ManuscriptEditorChapter>) => {
    setChaptersState((current) =>
      current.map((chapter, i) => (i === index ? { ...chapter, ...patch } : chapter)),
    );
  }, []);

  const addChapter = useCallback((chapter: Partial<ManuscriptEditorChapter> = {}) => {
    setChaptersState((current) => {
      const generated = defaultChapter(current.length, titleForRef.current, bodyForRef.current);
      const next = [
        ...current,
        {
          id: chapter.id ?? generated.id,
          title: chapter.title ?? generated.title,
          body: chapter.body ?? generated.body,
        },
      ];
      setSelectedState(next.length - 1);
      return next;
    });
  }, []);

  const removeChapter = useCallback((index: number) => {
    setChaptersState((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((_, i) => i !== index);
      setSelectedState((prev) => {
        if (prev === index) return Math.max(0, Math.min(index, next.length - 1));
        if (index < prev) return prev - 1;
        return Math.max(0, Math.min(prev, next.length - 1));
      });
      return next;
    });
  }, []);

  const reorderChapters = useCallback((from: number, to: number) => {
    setChaptersState((current) => {
      if (from < 0 || from >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      const target = Math.max(0, Math.min(next.length, to));
      next.splice(target, 0, moved);
      setSelectedState((prev) => {
        if (prev === from) return target;
        if (from < prev && target >= prev) return prev - 1;
        if (from > prev && target <= prev) return prev + 1;
        return prev;
      });
      return next;
    });
  }, []);

  return {
    chapters,
    selected,
    setSelected,
    setChapters,
    patchChapter,
    addChapter,
    removeChapter,
    reorderChapters,
    autosaveError,
    flushAutosave,
  };
}
