import {
  type AssetResolver,
  type EpubBook,
  EpubProject,
  type EpubProjectAsset,
  type EpubProjectMetadata,
  parseEpub,
} from '@libraz/mejiro/epub';
import { type ComputedRef, computed, type Ref, ref, shallowRef, watch } from 'vue';

/** One chapter of the manuscript draft the composable keeps in reactive state. */
export interface EpubProjectChapterDraft {
  id: string;
  title: string;
  body: string;
}

/** Options for {@link useEpubProject}. */
export interface UseEpubProjectOptions {
  /** Initial package metadata, merged over the composable's Japanese defaults. */
  metadata?: Partial<EpubProjectMetadata>;
  /** Initial chapter drafts. A single generated chapter is used when empty. */
  chapters?: EpubProjectChapterDraft[];
  /** Preview rebuild debounce in milliseconds. @defaultValue 250 */
  debounceMs?: number;
  /**
   * Initial cover asset. Pass `{ href, url }` to keep the bytes remote until
   * export, or `{ href, data }` to embed them straight away.
   */
  cover?: EpubProjectAsset;
  /**
   * Initial non-cover assets (illustrations, extra stylesheets). Same
   * `data` / `url` choice as {@link UseEpubProjectOptions.cover}.
   */
  assets?: EpubProjectAsset[];
  /**
   * Resolves URL-only project assets into bytes when the preview or export
   * pipeline materializes them. Forwarded to `project.export()`. Register the
   * URLs through {@link UseEpubProjectReturn.setCover} /
   * {@link UseEpubProjectReturn.setAssets} and let the host (not the client)
   * provide auth headers here.
   */
  assetResolver?: AssetResolver;
  /** Called with each successfully rebuilt preview book. */
  onPreview?: (book: EpubBook) => void;
  /** Called with the EPUB bytes produced by {@link UseEpubProjectReturn.exportEpub}. */
  onExport?: (buffer: ArrayBuffer) => void;
  /** Creates the default title for a generated chapter. */
  defaultChapterTitle?: (index: number) => string;
  /** Creates the default body for a generated chapter. */
  defaultChapterBody?: (index: number) => string;
}

/** State and actions returned by {@link useEpubProject}. */
export interface UseEpubProjectReturn {
  metadata: Ref<EpubProjectMetadata>;
  chapters: Ref<EpubProjectChapterDraft[]>;
  selectedChapter: Ref<number>;
  currentChapter: ComputedRef<EpubProjectChapterDraft | null>;
  /** Current cover asset, or `null` when the project has no cover. */
  cover: Ref<EpubProjectAsset | null>;
  /** Current non-cover assets, in registration order. */
  assets: Ref<EpubProjectAsset[]>;
  previewBook: Ref<EpubBook | null>;
  previewError: Ref<Error | null>;
  previewing: Ref<boolean>;
  setMetadata: (patch: Partial<EpubProjectMetadata>) => void;
  setChapters: (chapters: EpubProjectChapterDraft[]) => void;
  setSelectedChapter: (index: number) => void;
  /**
   * Replaces the cover asset, or drops it when passed `null`. The new cover is
   * reflected by both the debounced preview and {@link UseEpubProjectReturn.exportEpub}.
   */
  setCover: (asset: EpubProjectAsset | null) => void;
  /**
   * Replaces the non-cover asset list. Assets are registered on every rebuilt
   * project, so URL-only entries reach `assetResolver` at export time.
   */
  setAssets: (assets: EpubProjectAsset[]) => void;
  patchChapter: (index: number, patch: Partial<EpubProjectChapterDraft>) => void;
  addChapter: (chapter?: Partial<EpubProjectChapterDraft>) => void;
  removeChapter: (index?: number) => void;
  reorderChapters: (from: number, to: number) => void;
  buildProject: () => EpubProject;
  exportEpub: () => Promise<ArrayBuffer>;
}

/** Vue composable for custom manuscript-to-EPUB authoring UIs. */
export function useEpubProject(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  const defaultTitle = options.defaultChapterTitle;
  const defaultBody = options.defaultChapterBody;
  const metadata = ref<EpubProjectMetadata>({
    title: '新しい作品',
    language: 'ja',
    ...options.metadata,
  });
  const chapters = ref<EpubProjectChapterDraft[]>(
    options.chapters?.length ? options.chapters : [defaultChapter(0, defaultTitle, defaultBody)],
  );
  const selectedChapter = ref(0);
  // Assets carry binary payloads and are always replaced wholesale, so they are
  // held shallowly — deep reactivity would proxy every byte.
  const cover = shallowRef<EpubProjectAsset | null>(options.cover ?? null);
  const assets = shallowRef<EpubProjectAsset[]>(options.assets ?? []);
  const previewBook = shallowRef<EpubBook | null>(null);
  const previewError = shallowRef<Error | null>(null);
  const previewing = ref(false);
  let previewRequestId = 0;
  const currentChapter = computed(
    () => chapters.value[selectedChapter.value] ?? chapters.value[0] ?? null,
  );

  function buildProject(): EpubProject {
    const project = EpubProject.fromManuscript({
      metadata: metadata.value,
      includeTitlePage: false,
      includeTitleInFirstChapter: true,
      chapters: chapters.value.map((chapter) => ({
        id: chapter.id,
        title: chapter.title || 'Untitled',
        body: chapter.body,
      })),
      ...(cover.value ? { cover: cover.value } : {}),
    });
    for (const asset of assets.value) project.addAsset(asset);
    return project;
  }

  // Asset changes rebuild the preview through this counter rather than through
  // the deep watch below, which would otherwise walk the asset bytes on every
  // keystroke.
  const assetGeneration = ref(0);
  watch([cover, assets], () => assetGeneration.value++, { flush: 'sync' });

  watch(
    [metadata, chapters, assetGeneration],
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
    chapters.value = next.length ? next : [defaultChapter(0, defaultTitle, defaultBody)];
    const nextIndex = selectedId
      ? chapters.value.findIndex((chapter) => chapter.id === selectedId)
      : -1;
    selectedChapter.value =
      nextIndex >= 0
        ? nextIndex
        : Math.max(0, Math.min(selectedChapter.value, chapters.value.length - 1));
  }

  function setCover(asset: EpubProjectAsset | null): void {
    cover.value = asset;
  }

  function setAssets(next: EpubProjectAsset[]): void {
    assets.value = next;
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
    const generated = defaultChapter(chapters.value.length, defaultTitle, defaultBody);
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
    cover,
    assets,
    previewBook,
    previewError,
    previewing,
    setMetadata,
    setChapters,
    setSelectedChapter,
    setCover,
    setAssets,
    patchChapter,
    addChapter,
    removeChapter,
    reorderChapters,
    buildProject,
    exportEpub,
  };
}

function defaultChapter(
  index: number,
  titleFor: (index: number) => string = (i) => (i === 0 ? '第一話' : `第${i + 1}話`),
  bodyFor: (index: number) => string = (i) =>
    i === 0 ? 'これは｜漢字《かんじ》のルビ例です。\n\n本文をここに貼り付けます。' : '',
): EpubProjectChapterDraft {
  return {
    id: `chapter-${Date.now()}-${index}`,
    title: titleFor(index),
    body: bodyFor(index),
  };
}
