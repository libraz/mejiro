import { onScopeDispose, type Ref, ref, watch } from 'vue';
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
  autosaveKey?: Ref<string> | string;
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
  chapters: Ref<ManuscriptEditorChapter[]>;
  /** Index of the chapter currently being edited. */
  selected: Ref<number>;
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
  autosaveError: Ref<Error | null>;
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

function unwrapKey(key: Ref<string> | string | undefined): string {
  if (key === undefined) return '';
  return typeof key === 'string' ? key : key.value;
}

/**
 * Reactive store for manuscript drafts. Mirrors the React `useManuscriptDraft`
 * hook with Vue refs and a `watch`-based debounced autosave.
 */
export function useManuscriptDraft<TAutosave = ManuscriptEditorChapter[]>(
  options: UseManuscriptDraftOptions<TAutosave> = {},
): UseManuscriptDraftReturn {
  const titleFor = options.defaultChapterTitle;
  const bodyFor = options.defaultChapterBody;
  const chapters = ref<ManuscriptEditorChapter[]>(
    options.initialChapters?.length
      ? [...options.initialChapters]
      : [defaultChapter([], titleFor, bodyFor)],
  );
  const selected = ref(0);
  const autosaveError = ref<Error | null>(null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  // `dirty` means "the current draft is not yet persisted". It is only cleared
  // by a save that resolved and that nothing superseded while it was in
  // flight, so a rejected save stays dirty and the next flush retries it.
  let dirty = false;
  let revision = 0;
  // Saves run one at a time, so they land in order; a flush requested while
  // one is in flight runs once it settles.
  let inFlight = false;
  let flushQueued = false;

  function flushAutosave(): void {
    const callback = options.onAutosave;
    if (!(callback && dirty)) return;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (inFlight) {
      flushQueued = true;
      return;
    }
    const savedRevision = revision;
    // Plain copies: reactive proxies are not structured-cloneable (IndexedDB, postMessage).
    const plain = snapshotChapters(chapters.value);
    const payload = options.autosavePayload ? options.autosavePayload(plain) : (plain as TAutosave);
    const markSaved = () => {
      if (revision === savedRevision) dirty = false;
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
    inFlight = true;
    void Promise.resolve(saved)
      .then(markSaved)
      .catch((err) => {
        autosaveError.value = toError(err);
      })
      .finally(() => {
        inFlight = false;
        if (!flushQueued) return;
        flushQueued = false;
        flushAutosave();
      });
  }

  // `onAutosave` is read at flush time, so a callback supplied or replaced
  // after setup still receives every later save.
  const tracker = createDraftChangeTracker(chapters.value, unwrapKey(options.autosaveKey));
  watch(
    () => [chapters.value, unwrapKey(options.autosaveKey)] as const,
    ([nextChapters, nextKey]) => {
      if (!tracker.changed(nextChapters, nextKey)) return;
      dirty = true;
      revision += 1;
      autosaveError.value = null;
      if (timer) clearTimeout(timer);
      if (!options.onAutosave) return;
      timer = setTimeout(() => {
        timer = undefined;
        flushAutosave();
      }, options.autosaveDelay ?? DEFAULT_DELAY);
    },
    { deep: true },
  );
  const detachPageHide = flushOnPageHide(flushAutosave);
  onScopeDispose(() => {
    detachPageHide();
    flushAutosave();
    if (timer) clearTimeout(timer);
  });

  function setChapters(next: ManuscriptEditorChapter[]): void {
    const selectedId = chapters.value[selected.value]?.id;
    chapters.value = next.length ? next : [defaultChapter([], titleFor, bodyFor)];
    const nextIndex = selectedId
      ? chapters.value.findIndex((chapter) => chapter.id === selectedId)
      : -1;
    selected.value =
      nextIndex >= 0 ? nextIndex : Math.max(0, Math.min(selected.value, chapters.value.length - 1));
  }
  function setSelected(index: number): void {
    selected.value = Math.max(0, Math.min(index, chapters.value.length - 1));
  }
  function patchChapter(index: number, patch: Partial<ManuscriptEditorChapter>): void {
    chapters.value = chapters.value.map((chapter, i) =>
      i === index ? { ...chapter, ...patch } : chapter,
    );
  }
  function addChapter(chapter: Partial<ManuscriptEditorChapter> = {}): void {
    const generated = defaultChapter(chapters.value, titleFor, bodyFor);
    chapters.value = [
      ...chapters.value,
      {
        id: chapter.id ?? generated.id,
        title: chapter.title ?? generated.title,
        body: chapter.body ?? generated.body,
      },
    ];
    selected.value = chapters.value.length - 1;
  }
  function removeChapter(index: number): void {
    if (chapters.value.length <= 1) return;
    chapters.value = chapters.value.filter((_, i) => i !== index);
    if (selected.value === index) {
      selected.value = Math.max(0, Math.min(index, chapters.value.length - 1));
    } else if (index < selected.value) {
      selected.value--;
    } else {
      selected.value = Math.max(0, Math.min(selected.value, chapters.value.length - 1));
    }
  }
  function reorderChapters(from: number, to: number): void {
    if (from < 0 || from >= chapters.value.length) return;
    const next = [...chapters.value];
    const [moved] = next.splice(from, 1);
    const target = Math.max(0, Math.min(next.length, to));
    next.splice(target, 0, moved);
    chapters.value = next;
    if (selected.value === from) {
      selected.value = target;
    } else if (from < selected.value && target >= selected.value) {
      selected.value--;
    } else if (from > selected.value && target <= selected.value) {
      selected.value++;
    }
  }

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
