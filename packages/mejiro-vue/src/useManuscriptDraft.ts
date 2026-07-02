import { onScopeDispose, type Ref, ref, watch } from 'vue';
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
  /** Creates the default title for a generated chapter. */
  defaultChapterTitle?: (index: number) => string;
  /** Creates the default body for a generated chapter. */
  defaultChapterBody?: (index: number) => string;
}

/** Return value of {@link useManuscriptDraft}. */
export interface UseManuscriptDraftReturn {
  chapters: Ref<ManuscriptEditorChapter[]>;
  selected: Ref<number>;
  setSelected(index: number): void;
  setChapters(chapters: ManuscriptEditorChapter[]): void;
  patchChapter(index: number, patch: Partial<ManuscriptEditorChapter>): void;
  addChapter(chapter?: Partial<ManuscriptEditorChapter>): void;
  removeChapter(index: number): void;
  reorderChapters(from: number, to: number): void;
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
 * Reactive store for manuscript drafts. Mirrors the React `useManuscriptDraft`
 * hook with Vue refs and a `watch`-based debounced autosave.
 */
export function useManuscriptDraft(
  options: UseManuscriptDraftOptions = {},
): UseManuscriptDraftReturn {
  const autosaveDelay = options.autosaveDelay ?? DEFAULT_DELAY;
  const titleFor = options.defaultChapterTitle;
  const bodyFor = options.defaultChapterBody;
  const chapters = ref<ManuscriptEditorChapter[]>(
    options.initialChapters?.length
      ? [...options.initialChapters]
      : [defaultChapter(0, titleFor, bodyFor)],
  );
  const selected = ref(0);

  if (options.onAutosave) {
    const onAutosave = options.onAutosave;
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(
      chapters,
      (current) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void onAutosave([...current]);
        }, autosaveDelay);
      },
      { deep: true },
    );
    onScopeDispose(() => {
      if (timer) clearTimeout(timer);
    });
  }

  function setChapters(next: ManuscriptEditorChapter[]): void {
    const selectedId = chapters.value[selected.value]?.id;
    chapters.value = next.length ? next : [defaultChapter(0, titleFor, bodyFor)];
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
    const generated = defaultChapter(chapters.value.length, titleFor, bodyFor);
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
  };
}
