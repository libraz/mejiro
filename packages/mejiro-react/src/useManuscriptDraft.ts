import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManuscriptEditorChapter } from './MejiroManuscriptEditor.js';

/** Options for {@link useManuscriptDraft}. */
export interface UseManuscriptDraftOptions {
  /** Initial chapters. Defaults to a single empty chapter. */
  initialChapters?: ManuscriptEditorChapter[];
  /**
   * Called when the draft changes (debounced). Use to persist to
   * localStorage, IndexedDB, or upload to a server.
   */
  onAutosave?: (chapters: ManuscriptEditorChapter[]) => void | Promise<void>;
  /** Debounce delay in milliseconds. @defaultValue 800 */
  autosaveDelay?: number;
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
}

const DEFAULT_DELAY = 800;

function defaultChapter(index: number): ManuscriptEditorChapter {
  return { id: `chapter-${Date.now()}-${index}`, title: `第${index + 1}話`, body: '' };
}

/**
 * Reactive store for manuscript drafts.
 *
 * Wraps the chapter array with helpers for adding, removing, reordering, and
 * patching individual chapters, plus a debounced autosave hook that fires
 * `onAutosave` whenever the chapter list settles.
 */
export function useManuscriptDraft(
  options: UseManuscriptDraftOptions = {},
): UseManuscriptDraftReturn {
  const { onAutosave, autosaveDelay = DEFAULT_DELAY } = options;
  const [chapters, setChaptersState] = useState<ManuscriptEditorChapter[]>(() =>
    options.initialChapters?.length ? options.initialChapters : [defaultChapter(0)],
  );
  const [selected, setSelectedState] = useState(0);

  const saveRef = useRef(onAutosave);
  saveRef.current = onAutosave;
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return undefined;
    }
    const callback = saveRef.current;
    if (!callback) return undefined;
    const timer = setTimeout(() => {
      void callback(chapters);
    }, autosaveDelay);
    return () => clearTimeout(timer);
  }, [chapters, autosaveDelay]);

  const setSelected = useCallback(
    (index: number) => {
      setSelectedState(() => Math.max(0, Math.min(index, chapters.length - 1)));
    },
    [chapters.length],
  );

  const setChapters = useCallback(
    (next: ManuscriptEditorChapter[]) => {
      const normalized = next.length ? next : [defaultChapter(0)];
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
      const generated = defaultChapter(current.length);
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
  };
}
