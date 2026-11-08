import type { ManuscriptChapter } from '@libraz/mejiro';
import {
  type AssetResolver,
  type CoverInput,
  type EpubBook,
  type EpubExportOptions,
  EpubProject,
  type EpubProjectAsset,
  type EpubProjectMetadata,
  parseEpub,
} from '@libraz/mejiro/epub';
import {
  type ComputedRef,
  computed,
  markRaw,
  onMounted,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  type WatchStopHandle,
  watch,
} from 'vue';
import { toError } from './errors.js';
import { mergeDefined, uniqueChapterId } from './persistence.js';
import { createRequestToken } from './useRequestToken.js';

/** Options for {@link useEpubProject}. */
export interface UseEpubProjectOptions {
  /** Initial package metadata, merged over an empty title. */
  initialMetadata?: Partial<EpubProjectMetadata>;
  /** Initial chapters. A single generated chapter is used when empty. */
  initialChapters?: readonly ManuscriptChapter[];
  /** Preview rebuild debounce in milliseconds. @defaultValue 250 */
  debounceMs?: number;
  /**
   * Initial cover image. Pass `{ url, mediaType }` to keep the bytes remote
   * until export, or `{ data, mediaType }` to embed them straight away.
   */
  initialCover?: CoverInput;
  /**
   * Initial non-cover assets (illustrations, extra stylesheets). Same
   * `data` / `url` choice as {@link UseEpubProjectOptions.initialCover}.
   */
  initialAssets?: readonly EpubProjectAsset[];
  /**
   * Resolves URL-only project assets into bytes when the preview or export
   * pipeline materializes them. Forwarded to `project.export()`. Register the
   * URLs through {@link UseEpubProjectReturn.setCover} /
   * {@link UseEpubProjectReturn.setAssets} and let the host (not the client)
   * provide auth headers here.
   */
  assetResolver?: AssetResolver;
  /** Called with each successfully rebuilt preview. */
  onPreview?: (epub: EpubBook) => void;
  /** Called with the EPUB bytes produced by {@link UseEpubProjectReturn.exportEpub}. */
  onExport?: (bytes: Uint8Array<ArrayBuffer>) => void;
  /**
   * Called when an export fails. The failure also lands in `error`, and the
   * promise `exportEpub` returned still rejects. A `MejiroError` arrives as
   * thrown. Preview failures go to `previewError` instead.
   */
  onError?: (error: Error) => void;
  /** Creates the title for a generated chapter. @defaultValue `''` */
  defaultChapterTitle?: (index: number) => string;
  /** Creates the body for a generated chapter. @defaultValue `''` */
  defaultChapterBody?: (index: number) => string;
}

/** State and actions returned by {@link useEpubProject}. */
export interface UseEpubProjectReturn {
  /** Current book metadata. Change it through `updateMetadata`. */
  metadata: Readonly<Ref<EpubProjectMetadata>>;
  /** Current chapters, in reading order. Change them through the chapter methods. */
  chapters: Readonly<Ref<readonly ManuscriptChapter[]>>;
  /** Index of the chapter being edited. Change it through `setSelectedChapterIndex`. */
  selectedChapterIndex: Readonly<Ref<number>>;
  /** The chapter at `selectedChapterIndex`, or `null` when there is none. */
  currentChapter: ComputedRef<ManuscriptChapter | null>;
  /** Current cover image, or `null` when the project has no cover. */
  cover: Readonly<Ref<CoverInput | null>>;
  /** Current non-cover assets, in registration order. */
  assets: Readonly<Ref<readonly EpubProjectAsset[]>>;
  /** Parsed EPUB built from the current project, refreshed after each debounced change. */
  previewEpub: Readonly<Ref<EpubBook | null>>;
  /** Last preview build failure, if any. */
  previewError: Readonly<Ref<Error | null>>;
  /** Whether a preview build is pending or running. */
  previewing: Readonly<Ref<boolean>>;
  /** Whether an export is in progress. */
  exporting: Readonly<Ref<boolean>>;
  /** Last export failure, if any; cleared when an export starts. */
  error: Readonly<Ref<Error | null>>;
  /**
   * Merges `patch` into the metadata. A missing or blank `identifier` keeps the
   * current one.
   */
  updateMetadata: (patch: Partial<EpubProjectMetadata>) => void;
  /** Replaces every chapter; an empty list becomes one generated chapter. */
  setChapters: (chapters: readonly ManuscriptChapter[]) => void;
  /** Selects a chapter, clamped to the chapter range. */
  setSelectedChapterIndex: (index: number) => void;
  /**
   * Replaces the cover image, or drops it when passed `null`. The new cover is
   * reflected by both the debounced preview and {@link UseEpubProjectReturn.exportEpub}.
   */
  setCover: (cover: CoverInput | null) => void;
  /**
   * Replaces the non-cover asset list. Assets are registered on every rebuilt
   * project, so URL-only entries reach `assetResolver` at export time.
   */
  setAssets: (assets: readonly EpubProjectAsset[]) => void;
  /** Merges `patch` into the chapter at `index`. */
  updateChapter: (index: number, patch: Partial<ManuscriptChapter>) => void;
  /** Appends a chapter (generated defaults fill omitted fields) and selects it. */
  addChapter: (chapter?: Partial<ManuscriptChapter>) => void;
  /** Removes the chapter at `index`; the last remaining chapter is never removed. */
  removeChapter: (index: number) => void;
  /** Moves the chapter at `from` to `to`, keeping the same chapter selected. */
  reorderChapters: (from: number, to: number) => void;
  /** Builds an `EpubProject` from the current state. */
  buildProject: () => EpubProject;
  /**
   * Packages the current project as EPUB bytes. A failure lands in `error` and
   * `onError`, and the promise rejects.
   */
  exportEpub: () => Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * Vue composable for custom manuscript-to-EPUB authoring UIs.
 *
 * Holds no sample content: an empty project has an empty title and one empty
 * chapter. Supply visible defaults through `initialMetadata`,
 * `defaultChapterTitle` and `defaultChapterBody`.
 */
export function useEpubProject(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  const defaultTitle = options.defaultChapterTitle;
  const defaultBody = options.defaultChapterBody;
  const metadata = shallowRef<EpubProjectMetadata>(initialMetadata(options.initialMetadata));
  const chapters = shallowRef<readonly ManuscriptChapter[]>(
    options.initialChapters?.length
      ? [...options.initialChapters]
      : [defaultChapter([], defaultTitle, defaultBody)],
  );
  const selectedChapterIndex = shallowRef(0);
  // Assets carry binary payloads and are always replaced wholesale, so they are
  // held shallowly — deep reactivity would proxy every byte.
  const cover = shallowRef<CoverInput | null>(options.initialCover ?? null);
  const assets = shallowRef<readonly EpubProjectAsset[]>(options.initialAssets ?? []);
  const previewEpub = shallowRef<EpubBook | null>(null);
  const previewError = shallowRef<Error | null>(null);
  const previewing = shallowRef(false);
  const exporting = shallowRef(false);
  const error = shallowRef<Error | null>(null);
  const previewRequest = createRequestToken();
  let exportsInFlight = 0;
  const currentChapter = computed(
    () => chapters.value[selectedChapterIndex.value] ?? chapters.value[0] ?? null,
  );

  function buildProject(): EpubProject {
    const project = EpubProject.fromManuscript({
      metadata: metadata.value,
      includeTitlePage: false,
      includeTitleInFirstChapter: true,
      chapters: chapters.value.map((chapter) => ({
        ...chapter,
        title: chapter.title || 'Untitled',
      })),
      ...(cover.value ? { cover: cover.value } : {}),
    });
    for (const asset of assets.value) project.addAsset(asset);
    return markRaw(project);
  }

  function exportOptions(signal?: AbortSignal): EpubExportOptions {
    const resolver = options.assetResolver;
    return { ...(resolver ? { assetResolver: resolver } : {}), ...(signal ? { signal } : {}) };
  }

  // Deferred to mount so server-side setup never schedules a build. Every state
  // ref is replaced wholesale, so a shallow watch sees each change.
  let stopPreviewWatch: WatchStopHandle | undefined;
  onMounted(() => {
    stopPreviewWatch = watch(
      [metadata, chapters, cover, assets],
      (_values, _oldValues, onCleanup) => {
        const token = previewRequest.begin();
        const controller = new AbortController();
        previewing.value = true;
        const timer = setTimeout(() => {
          void (async () => {
            try {
              const book = await parseEpub(
                await buildProject().export(exportOptions(controller.signal)),
                { signal: controller.signal },
              );
              if (!previewRequest.isCurrent(token)) return;
              previewEpub.value = book;
              previewError.value = null;
              options.onPreview?.(book);
            } catch (err) {
              if (previewRequest.isCurrent(token)) previewError.value = toError(err);
            } finally {
              if (previewRequest.isCurrent(token)) previewing.value = false;
            }
          })();
        }, options.debounceMs ?? 250);
        onCleanup(() => {
          previewRequest.invalidate();
          clearTimeout(timer);
          controller.abort();
        });
      },
      { immediate: true },
    );
  });
  onScopeDispose(() => {
    stopPreviewWatch?.();
  });

  function updateMetadata(patch: Partial<EpubProjectMetadata>): void {
    metadata.value = mergeMetadata(metadata.value, patch);
  }

  function setChapters(next: readonly ManuscriptChapter[]): void {
    const selectedId = chapters.value[selectedChapterIndex.value]?.id;
    chapters.value = next.length ? [...next] : [defaultChapter([], defaultTitle, defaultBody)];
    const nextIndex =
      selectedId !== undefined
        ? chapters.value.findIndex((chapter) => chapter.id === selectedId)
        : -1;
    selectedChapterIndex.value =
      nextIndex >= 0
        ? nextIndex
        : Math.max(0, Math.min(selectedChapterIndex.value, chapters.value.length - 1));
  }

  function setCover(next: CoverInput | null): void {
    cover.value = next;
  }

  function setAssets(next: readonly EpubProjectAsset[]): void {
    assets.value = [...next];
  }

  function setSelectedChapterIndex(index: number): void {
    selectedChapterIndex.value = Math.max(0, Math.min(index, chapters.value.length - 1));
  }

  function updateChapter(index: number, patch: Partial<ManuscriptChapter>): void {
    chapters.value = chapters.value.map((chapter, chapterIndex) =>
      chapterIndex === index ? { ...chapter, ...patch } : chapter,
    );
  }

  function addChapter(chapter: Partial<ManuscriptChapter> = {}): void {
    const generated = defaultChapter(chapters.value, defaultTitle, defaultBody);
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
    chapters.value = chapters.value.filter((_, chapterIndex) => chapterIndex !== index);
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

  async function exportEpub(): Promise<Uint8Array<ArrayBuffer>> {
    exportsInFlight++;
    exporting.value = true;
    error.value = null;
    try {
      const bytes = await buildProject().export(exportOptions());
      options.onExport?.(bytes);
      return bytes;
    } catch (err) {
      error.value = toError(err);
      options.onError?.(error.value);
      throw err;
    } finally {
      exporting.value = --exportsInFlight > 0;
    }
  }

  return {
    metadata: shallowReadonly(metadata),
    chapters: shallowReadonly(chapters),
    selectedChapterIndex: shallowReadonly(selectedChapterIndex),
    currentChapter,
    cover: shallowReadonly(cover),
    assets: shallowReadonly(assets),
    previewEpub: shallowReadonly(previewEpub),
    previewError: shallowReadonly(previewError),
    previewing: shallowReadonly(previewing),
    exporting: shallowReadonly(exporting),
    error: shallowReadonly(error),
    updateMetadata,
    setChapters,
    setSelectedChapterIndex,
    setCover,
    setAssets,
    updateChapter,
    addChapter,
    removeChapter,
    reorderChapters,
    buildProject,
    exportEpub,
  };
}

/**
 * Merges `patch` over `current`. A missing or blank identifier in the patch
 * keeps the current one, so every build of one project stays one publication.
 */
function mergeMetadata(
  current: EpubProjectMetadata,
  patch: Partial<EpubProjectMetadata>,
): EpubProjectMetadata {
  const next = { ...current, ...patch };
  if (!next.identifier?.trim()) next.identifier = current.identifier;
  return next;
}

/**
 * Returns a fresh `urn:uuid:` package identifier. Falls back to a
 * `Math.random` UUID where `crypto.randomUUID` is missing (insecure origins,
 * Node without a global `crypto`), so setup never throws.
 */
export function createPackageIdentifier(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `urn:uuid:${globalThis.crypto.randomUUID()}`;
  }
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const digit = Math.floor(Math.random() * 16);
    return (ch === 'x' ? digit : (digit & 0x3) | 0x8).toString(16);
  });
  return `urn:uuid:${uuid}`;
}

/** Seeds the metadata with an identifier, so every build of one project shares it. */
function initialMetadata(patch: Partial<EpubProjectMetadata> = {}): EpubProjectMetadata {
  const metadata = mergeDefined<EpubProjectMetadata>({ title: '', language: 'ja' }, patch);
  if (!metadata.identifier?.trim()) metadata.identifier = createPackageIdentifier();
  return metadata;
}

function defaultChapter(
  existing: readonly ManuscriptChapter[],
  titleFor: (index: number) => string = () => '',
  bodyFor: (index: number) => string = () => '',
): ManuscriptChapter {
  const index = existing.length;
  return { id: uniqueChapterId(existing), title: titleFor(index), body: bodyFor(index) };
}
