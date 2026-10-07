import { useCallback, useEffect, useRef, useState } from 'react';
import { toError } from './errors.js';
import type { ManuscriptEditorChapter } from './MejiroManuscriptEditor.js';
import {
  createDraftChangeTracker,
  flushOnPageHide,
  snapshotChapters,
  uniqueChapterId,
} from './persistence.js';

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
  /** Current chapters, in reading order. */
  chapters: ManuscriptEditorChapter[];
  /** Index of the chapter currently being edited. */
  selected: number;
  /** Selects a chapter, clamped to the chapter range. */
  setSelected(index: number): void;
  /**
   * Replaces every chapter; an empty list becomes one generated chapter. The
   * selected chapter is kept by id when it survives.
   */
  setChapters(chapters: ManuscriptEditorChapter[]): void;
  /** Merges `patch` into the chapter at `index`. */
  patchChapter(index: number, patch: Partial<ManuscriptEditorChapter>): void;
  /** Appends a chapter (generated defaults fill omitted fields) and selects it. */
  addChapter(chapter?: Partial<ManuscriptEditorChapter>): void;
  /** Removes the chapter at `index`; the last remaining chapter is never removed. */
  removeChapter(index: number): void;
  /** Moves the chapter at `from` to `to`, keeping the same chapter selected. */
  reorderChapters(from: number, to: number): void;
  /** Last autosave failure, if any. */
  autosaveError: Error | null;
  /** Immediately saves the latest dirty draft, if one exists. */
  flushAutosave(): void;
}

const DEFAULT_DELAY = 800;

function defaultChapter(
  existing: readonly ManuscriptEditorChapter[],
  titleFor: (index: number) => string = (i) => `第${i + 1}話`,
  bodyFor: (index: number) => string = () => '',
): ManuscriptEditorChapter {
  const index = existing.length;
  return { id: uniqueChapterId(existing), title: titleFor(index), body: bodyFor(index) };
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
      : [defaultChapter([], defaultChapterTitle, defaultChapterBody)],
  );
  const [selected, setSelectedState] = useState(0);
  const [autosaveError, setAutosaveError] = useState<Error | null>(null);

  const saveRef = useRef(onAutosave);
  saveRef.current = onAutosave;
  const payloadRef = useRef(autosavePayload);
  payloadRef.current = autosavePayload;
  // Mutators derive the next chapters / selection from these refs and set both
  // states with plain values. Computing them inside a state updater would make
  // the derivation run once per updater evaluation, which React is free to
  // repeat.
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Seeded with the mount-time draft, so a re-run mount effect (StrictMode)
  // is not mistaken for an edit.
  const trackerRef = useRef<ReturnType<typeof createDraftChangeTracker> | null>(null);
  if (!trackerRef.current)
    trackerRef.current = createDraftChangeTracker(chapters, autosaveKey ?? '');
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  // Bumped on every change that needs persisting. A save only clears the dirty
  // flag when no further change landed while it was in flight.
  const revisionRef = useRef(0);
  // Saves run one at a time, so they land in order; a flush requested while
  // one is in flight runs once it settles.
  const inFlightRef = useRef(false);
  const flushQueuedRef = useRef(false);

  const flushAutosave = useCallback(() => {
    const callback = saveRef.current;
    if (!(callback && dirtyRef.current)) return;
    if (inFlightRef.current) {
      flushQueuedRef.current = true;
      return;
    }
    const revision = revisionRef.current;
    const plain = snapshotChapters(chaptersRef.current);
    const payload = payloadRef.current ? payloadRef.current(plain) : (plain as TAutosave);
    const markSaved = () => {
      if (revisionRef.current === revision) dirtyRef.current = false;
    };
    let saved: void | Promise<void>;
    try {
      saved = callback(payload);
    } catch (err) {
      saved = Promise.reject(err);
    }
    // A callback that returns nothing has finished saving when it returns.
    if (saved === undefined) {
      markSaved();
      return;
    }
    inFlightRef.current = true;
    void Promise.resolve(saved)
      .then(markSaved)
      .catch((err) => {
        // Keep the draft dirty so a later flush retries the failed save.
        if (!mountedRef.current) return;
        setAutosaveError(toError(err));
      })
      .finally(() => {
        inFlightRef.current = false;
        if (!flushQueuedRef.current) return;
        flushQueuedRef.current = false;
        flushAutosave();
      });
  }, []);

  useEffect(() => {
    if (trackerRef.current?.changed(chapters, autosaveKey ?? '')) {
      dirtyRef.current = true;
      revisionRef.current += 1;
      setAutosaveError(null);
    }
    if (!(saveRef.current && dirtyRef.current)) return undefined;
    const timer = setTimeout(() => {
      flushAutosave();
    }, autosaveDelay);
    return () => clearTimeout(timer);
  }, [chapters, autosaveKey, autosaveDelay, flushAutosave]);

  useEffect(() => {
    mountedRef.current = true;
    const detachPageHide = flushOnPageHide(flushAutosave);
    return () => {
      flushAutosave();
      mountedRef.current = false;
      detachPageHide();
    };
  }, [flushAutosave]);

  const commit = useCallback((nextChapters: ManuscriptEditorChapter[], nextSelected: number) => {
    chaptersRef.current = nextChapters;
    selectedRef.current = nextSelected;
    setChaptersState(nextChapters);
    setSelectedState(nextSelected);
  }, []);

  const setSelected = useCallback((index: number) => {
    const next = Math.max(0, Math.min(index, chaptersRef.current.length - 1));
    selectedRef.current = next;
    setSelectedState(next);
  }, []);

  const setChapters = useCallback(
    (next: ManuscriptEditorChapter[]) => {
      const normalized = next.length
        ? next
        : [defaultChapter([], titleForRef.current, bodyForRef.current)];
      const prev = selectedRef.current;
      const selectedId = chaptersRef.current[prev]?.id;
      const nextIndex = selectedId
        ? normalized.findIndex((chapter) => chapter.id === selectedId)
        : -1;
      commit(
        normalized,
        nextIndex >= 0 ? nextIndex : Math.max(0, Math.min(prev, normalized.length - 1)),
      );
    },
    [commit],
  );

  const patchChapter = useCallback((index: number, patch: Partial<ManuscriptEditorChapter>) => {
    const next = chaptersRef.current.map((chapter, i) =>
      i === index ? { ...chapter, ...patch } : chapter,
    );
    chaptersRef.current = next;
    setChaptersState(next);
  }, []);

  const addChapter = useCallback(
    (chapter: Partial<ManuscriptEditorChapter> = {}) => {
      const current = chaptersRef.current;
      const generated = defaultChapter(current, titleForRef.current, bodyForRef.current);
      const next = [
        ...current,
        {
          id: chapter.id ?? generated.id,
          title: chapter.title ?? generated.title,
          body: chapter.body ?? generated.body,
        },
      ];
      commit(next, next.length - 1);
    },
    [commit],
  );

  const removeChapter = useCallback(
    (index: number) => {
      const current = chaptersRef.current;
      if (current.length <= 1) return;
      const next = current.filter((_, i) => i !== index);
      const prev = selectedRef.current;
      let nextSelected: number;
      if (prev === index) nextSelected = Math.max(0, Math.min(index, next.length - 1));
      else if (index < prev) nextSelected = prev - 1;
      else nextSelected = Math.max(0, Math.min(prev, next.length - 1));
      commit(next, nextSelected);
    },
    [commit],
  );

  const reorderChapters = useCallback(
    (from: number, to: number) => {
      const current = chaptersRef.current;
      if (from < 0 || from >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      const target = Math.max(0, Math.min(next.length, to));
      next.splice(target, 0, moved);
      const prev = selectedRef.current;
      let nextSelected = prev;
      if (prev === from) nextSelected = target;
      else if (from < prev && target >= prev) nextSelected = prev - 1;
      else if (from > prev && target <= prev) nextSelected = prev + 1;
      commit(next, nextSelected);
    },
    [commit],
  );

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
