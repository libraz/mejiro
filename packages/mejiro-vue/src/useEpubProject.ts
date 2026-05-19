import {
  type AssetResolver,
  type EpubBook,
  EpubProject,
  type EpubProjectMetadata,
  parseEpub,
} from '@libraz/mejiro/epub';
import { type ComputedRef, computed, type Ref, ref, shallowRef, watch } from 'vue';

export interface EpubProjectChapterDraft {
  id: string;
  title: string;
  body: string;
}

export interface UseEpubProjectOptions {
  metadata?: Partial<EpubProjectMetadata>;
  chapters?: EpubProjectChapterDraft[];
  debounceMs?: number;
  /**
   * Resolves URL-only project assets into bytes when the preview or export
   * pipeline materializes them. Forwarded to `project.export()`.
   */
  assetResolver?: AssetResolver;
  onPreview?: (book: EpubBook) => void;
  onExport?: (buffer: ArrayBuffer) => void;
}

export interface UseEpubProjectReturn {
  metadata: Ref<EpubProjectMetadata>;
  chapters: Ref<EpubProjectChapterDraft[]>;
  selectedChapter: Ref<number>;
  currentChapter: ComputedRef<EpubProjectChapterDraft | null>;
  previewBook: Ref<EpubBook | null>;
  previewError: Ref<Error | null>;
  previewing: Ref<boolean>;
  setMetadata: (patch: Partial<EpubProjectMetadata>) => void;
  setChapters: (chapters: EpubProjectChapterDraft[]) => void;
  setSelectedChapter: (index: number) => void;
  patchChapter: (index: number, patch: Partial<EpubProjectChapterDraft>) => void;
  addChapter: (chapter?: Partial<EpubProjectChapterDraft>) => void;
  removeChapter: (index?: number) => void;
  reorderChapters: (from: number, to: number) => void;
  buildProject: () => EpubProject;
  exportEpub: () => Promise<ArrayBuffer>;
}

/** Vue composable for custom manuscript-to-EPUB authoring UIs. */
export function useEpubProject(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  const metadata = ref<EpubProjectMetadata>({
    title: '新しい作品',
    language: 'ja',
    ...options.metadata,
  });
  const chapters = ref<EpubProjectChapterDraft[]>(
    options.chapters?.length ? options.chapters : [defaultChapter(0)],
  );
  const selectedChapter = ref(0);
  const previewBook = shallowRef<EpubBook | null>(null);
  const previewError = shallowRef<Error | null>(null);
  const previewing = ref(false);
  let previewRequestId = 0;
  const currentChapter = computed(
    () => chapters.value[selectedChapter.value] ?? chapters.value[0] ?? null,
  );

  function buildProject(): EpubProject {
    return EpubProject.fromManuscript({
      metadata: metadata.value,
      includeTitlePage: false,
      includeTitleInFirstChapter: true,
      chapters: chapters.value.map((chapter) => ({
        id: chapter.id,
        title: chapter.title || 'Untitled',
        body: chapter.body,
      })),
    });
  }

  watch(
    [metadata, chapters],
    (_values, _oldValues, onCleanup) => {
      const requestId = ++previewRequestId;
      previewing.value = true;
      const timer = setTimeout(() => {
        void (async () => {
          try {
            const resolver = options.assetResolver;
            const book = await parseEpub(
              await buildProject().export(resolver ? { assetResolver: resolver } : undefined),
            );
            if (requestId !== previewRequestId) return;
            previewBook.value = book;
            previewError.value = null;
            options.onPreview?.(book);
          } catch (err) {
            if (requestId === previewRequestId) {
              previewError.value = err instanceof Error ? err : new Error(String(err));
            }
          } finally {
            if (requestId === previewRequestId) previewing.value = false;
          }
        })();
      }, options.debounceMs ?? 250);
      onCleanup(() => {
        previewRequestId++;
        clearTimeout(timer);
      });
    },
    { deep: true, immediate: true },
  );

  function setMetadata(patch: Partial<EpubProjectMetadata>): void {
    metadata.value = { ...metadata.value, ...patch };
  }

  function setChapters(next: EpubProjectChapterDraft[]): void {
    const selectedId = chapters.value[selectedChapter.value]?.id;
    chapters.value = next.length ? next : [defaultChapter(0)];
    const nextIndex = selectedId
      ? chapters.value.findIndex((chapter) => chapter.id === selectedId)
      : -1;
    selectedChapter.value =
      nextIndex >= 0
        ? nextIndex
        : Math.max(0, Math.min(selectedChapter.value, chapters.value.length - 1));
  }

  function setSelectedChapter(index: number): void {
    selectedChapter.value = Math.max(0, Math.min(index, chapters.value.length - 1));
  }

  function patchChapter(index: number, patch: Partial<EpubProjectChapterDraft>): void {
    chapters.value = chapters.value.map((chapter, chapterIndex) =>
      chapterIndex === index ? { ...chapter, ...patch } : chapter,
    );
  }

  function addChapter(chapter: Partial<EpubProjectChapterDraft> = {}): void {
    const generated = defaultChapter(chapters.value.length);
    chapters.value = [
      ...chapters.value,
      {
        id: chapter.id ?? generated.id,
        title: chapter.title ?? generated.title,
        body: chapter.body ?? generated.body,
      },
    ];
    selectedChapter.value = chapters.value.length - 1;
  }

  function removeChapter(index = selectedChapter.value): void {
    if (chapters.value.length <= 1) return;
    chapters.value = chapters.value.filter((_, chapterIndex) => chapterIndex !== index);
    if (selectedChapter.value === index) {
      selectedChapter.value = Math.max(0, Math.min(index, chapters.value.length - 1));
    } else if (index < selectedChapter.value) {
      selectedChapter.value--;
    } else {
      selectedChapter.value = Math.max(
        0,
        Math.min(selectedChapter.value, chapters.value.length - 1),
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
    if (selectedChapter.value === from) {
      selectedChapter.value = target;
    } else if (from < selectedChapter.value && target >= selectedChapter.value) {
      selectedChapter.value--;
    } else if (from > selectedChapter.value && target <= selectedChapter.value) {
      selectedChapter.value++;
    }
  }

  async function exportEpub(): Promise<ArrayBuffer> {
    const resolver = options.assetResolver;
    const buffer = await buildProject().export(resolver ? { assetResolver: resolver } : undefined);
    options.onExport?.(buffer);
    return buffer;
  }

  return {
    metadata,
    chapters,
    selectedChapter,
    currentChapter,
    previewBook,
    previewError,
    previewing,
    setMetadata,
    setChapters,
    setSelectedChapter,
    patchChapter,
    addChapter,
    removeChapter,
    reorderChapters,
    buildProject,
    exportEpub,
  };
}

function defaultChapter(index: number): EpubProjectChapterDraft {
  return {
    id: `chapter-${Date.now()}-${index}`,
    title: index === 0 ? '第一話' : `第${index + 1}話`,
    body: index === 0 ? 'これは｜漢字《かんじ》のルビ例です。\n\n本文をここに貼り付けます。' : '',
  };
}
