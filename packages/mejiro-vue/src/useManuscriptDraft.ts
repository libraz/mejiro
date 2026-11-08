import type { ManuscriptChapter } from '@libraz/mejiro';
import {
  type MaybeRefOrGetter,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import { toError } from './errors.js';
import {
  createDraftChangeTracker,
  flushOnPageHide,
  snapshotChapters,
  uniqueChapterId,
} from './persistence.js';

/** Options for {@link useManuscriptDraft}. */
export interface UseManuscriptDraftOptions<TAutosave = ManuscriptChapter[]> {
  /** Initial chapters. Defaults to a single empty chapter. */
  initialChapters?: readonly ManuscriptChapter[];
  /**
   * Called when the draft changes (debounced). This is the persistence
   * channel: write to localStorage, IndexedDB, or upload to a server. Return
   * a promise for an asynchronous save; a rejected save stays dirty, lands in
   * `autosaveError` and is retried by the next flush.
   */
  onAutosave?: (draft: TAutosave) => void | Promise<void>;
  /** Maps chapters to the autosave payload. Defaults to the chapter array. */
  autosavePayload?: (chapters: readonly ManuscriptChapter[]) => TAutosave;
  /**
   * Values outside the chapters that also make the draft dirty — e.g. a title
   * or author kept elsewhere and folded in by `autosavePayload`. A change in
   * any element, compared with `Object.is`, schedules an autosave.
   */
  autosaveDeps?: MaybeRefOrGetter<readonly unknown[]>;
  /** Autosave debounce delay in milliseconds. @defaultValue 800 */
  autosaveDebounceMs?: number;
  /** Creates the title for a generated chapter. @defaultValue `''` */
  defaultChapterTitle?: (index: number) => string;
  /** Creates the body for a generated chapter. @defaultValue `''` */
  defaultChapterBody?: (index: number) => string;
}

/** Return value of {@link useManuscriptDraft}. */
export interface UseManuscriptDraftReturn {
  /** Current chapters, in reading order. Change them through the chapter methods. */
  chapters: Readonly<Ref<readonly ManuscriptChapter[]>>;
  /** Index of the chapter currently being edited. Change it through `setSelectedChapterIndex`. */
  selectedChapterIndex: Readonly<Ref<number>>;
  /** Selects a chapter, clamped to the chapter range. */
  setSelectedChapterIndex(index: number): void;
  /**
   * Replaces every chapter; an empty list becomes one generated chapter. The
   * selected chapter is kept by id when it survives.
   */
  setChapters(chapters: readonly ManuscriptChapter[]): void;
  /** Merges `patch` into the chapter at `index`. */
  updateChapter(index: number, patch: Partial<ManuscriptChapter>): void;
  /** Appends a chapter (generated defaults fill omitted fields) and selects it. */
  addChapter(chapter?: Partial<ManuscriptChapter>): void;
  /** Removes the chapter at `index`; the last remaining chapter is never removed. */
  removeChapter(index: number): void;
  /** Moves the chapter at `from` to `to`, keeping the same chapter selected. */
  reorderChapters(from: number, to: number): void;
  /** Last autosave failure, if any. */
  autosaveError: Readonly<Ref<Error | null>>;
  /** Immediately saves the latest dirty draft, if one exists. */
  flushAutosave(): void;
}

const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 800;
const NO_DEPS: readonly unknown[] = [];

function defaultChapter(
  existing: readonly ManuscriptChapter[],
  titleFor: (index: number) => string = () => '',
  bodyFor: (index: number) => string = () => '',
): ManuscriptChapter {
  const index = existing.length;
  return { id: uniqueChapterId(existing), title: titleFor(index), body: bodyFor(index) };
}

/**
 * Reactive store for manuscript drafts. Mirrors the React `useManuscriptDraft`
 * hook with Vue refs and a `watch`-based debounced autosave.
 *
 * Holds no sample content: an empty draft is one chapter with an empty title
 * and body. Supply visible defaults through `defaultChapterTitle` and
 * `defaultChapterBody`.
 */
export function useManuscriptDraft<TAutosave = ManuscriptChapter[]>(
  options: UseManuscriptDraftOptions<TAutosave> = {},
): UseManuscriptDraftReturn {
  const titleFor = options.defaultChapterTitle;
  const bodyFor = options.defaultChapterBody;
  const chapters = shallowRef<readonly ManuscriptChapter[]>(
    options.initialChapters?.length
      ? [...options.initialChapters]
      : [defaultChapter([], titleFor, bodyFor)],
  );
  const selectedChapterIndex = shallowRef(0);
  const autosaveError = shallowRef<Error | null>(null);
  const deps = (): readonly unknown[] => toValue(options.autosaveDeps) ?? NO_DEPS;

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
  const tracker = createDraftChangeTracker(chapters.value, deps());
  watch(
    () => [chapters.value, [...deps()]] as const,
    ([nextChapters, nextDeps]) => {
      if (!tracker.changed(nextChapters, nextDeps)) return;
      dirty = true;
      revision += 1;
      autosaveError.value = null;
      if (timer) clearTimeout(timer);
      if (!options.onAutosave) return;
      timer = setTimeout(() => {
        timer = undefined;
        flushAutosave();
      }, options.autosaveDebounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS);
    },
  );
  const detachPageHide = flushOnPageHide(flushAutosave);
  onScopeDispose(() => {
    detachPageHide();
    flushAutosave();
    if (timer) clearTimeout(timer);
  });

  function setChapters(next: readonly ManuscriptChapter[]): void {
    const selectedId = chapters.value[selectedChapterIndex.value]?.id;
    chapters.value = next.length ? [...next] : [defaultChapter([], titleFor, bodyFor)];
    const nextIndex =
      selectedId !== undefined
        ? chapters.value.findIndex((chapter) => chapter.id === selectedId)
        : -1;
    selectedChapterIndex.value =
      nextIndex >= 0
        ? nextIndex
        : Math.max(0, Math.min(selectedChapterIndex.value, chapters.value.length - 1));
  }
  function setSelectedChapterIndex(index: number): void {
    selectedChapterIndex.value = Math.max(0, Math.min(index, chapters.value.length - 1));
  }
  function updateChapter(index: number, patch: Partial<ManuscriptChapter>): void {
    chapters.value = chapters.value.map((chapter, i) =>
      i === index ? { ...chapter, ...patch } : chapter,
    );
  }
  function addChapter(chapter: Partial<ManuscriptChapter> = {}): void {
    const generated = defaultChapter(chapters.value, titleFor, bodyFor);
    chapters.value = [
      ...chapters.value,
      {
        id: chapter.id ?? generated.id,
        title: chapter.title ?? generated.title,
        body: chapter.body ?? generated.body,
      },
    ];
    selectedChapterIndex.value = chapters.value.length - 1;
  }
  function removeChapter(index: number): void {
    if (chapters.value.length <= 1) return;
    chapters.value = chapters.value.filter((_, i) => i !== index);
    if (selectedChapterIndex.value === index) {
      selectedChapterIndex.value = Math.max(0, Math.min(index, chapters.value.length - 1));
    } else if (index < selectedChapterIndex.value) {
      selectedChapterIndex.value--;
    } else {
      selectedChapterIndex.value = Math.max(
        0,
        Math.min(selectedChapterIndex.value, chapters.value.length - 1),
      );
    }
  }
  function reorderChapters(from: number, to: number): void {
    if (from < 0 || from >= chapters.value.length) return;
    const next = [...chapters.value];
    const [moved] = next.splice(from, 1);
    const target = Math.max(0, Math.min(next.length, to));
    next.splice(target, 0, moved);
    chapters.value = next;
    if (selectedChapterIndex.value === from) {
      selectedChapterIndex.value = target;
    } else if (from < selectedChapterIndex.value && target >= selectedChapterIndex.value) {
      selectedChapterIndex.value--;
    } else if (from > selectedChapterIndex.value && target <= selectedChapterIndex.value) {
      selectedChapterIndex.value++;
    }
  }

  return {
    chapters: shallowReadonly(chapters),
    selectedChapterIndex: shallowReadonly(selectedChapterIndex),
    setSelectedChapterIndex,
    setChapters,
    updateChapter,
    addChapter,
    removeChapter,
    reorderChapters,
    autosaveError: shallowReadonly(autosaveError),
    flushAutosave,
  };
}
