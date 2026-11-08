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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toError } from './errors.js';
import { mergeDefined, uniqueChapterId } from './persistence.js';
import { useRequestToken } from './useRequestToken.js';

/** Options for {@link useEpubProject}. */
export interface UseEpubProjectOptions {
  /**
   * Package metadata on mount. The title defaults to `''` and the language to
   * `'ja'`; a missing or blank identifier is generated.
   */
  initialMetadata?: Partial<EpubProjectMetadata>;
  /**
   * Chapters on mount. When absent or empty, one chapter is generated from
   * {@link UseEpubProjectOptions.defaultChapterTitle} /
   * {@link UseEpubProjectOptions.defaultChapterBody}.
   */
  initialChapters?: readonly ManuscriptChapter[];
  /** Preview rebuild debounce in milliseconds. @defaultValue 250 */
  debounceMs?: number;
  /**
   * Cover on mount. Pass `{ url, mediaType }` to keep the bytes remote until
   * export, or `{ data, mediaType }` to embed them straight away.
   */
  initialCover?: CoverInput;
  /**
   * Non-cover assets on mount (illustrations, extra stylesheets). Same
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
  /** Called with each successfully rebuilt preview EPUB. */
  onPreview?: (epub: EpubBook) => void;
  /** Called with the EPUB bytes produced by {@link UseEpubProjectReturn.exportEpub}. */
  onExport?: (bytes: Uint8Array<ArrayBuffer>) => void;
  /**
   * Called when an export fails; the promise `exportEpub` returned rejects
   * too. A `MejiroError` is passed as thrown. Preview failures go to
   * {@link UseEpubProjectReturn.previewError} instead.
   */
  onError?: (error: Error) => void;
  /** Creates the title of a generated chapter. @defaultValue `() => ''` */
  defaultChapterTitle?: (index: number) => string;
  /** Creates the body of a generated chapter. @defaultValue `() => ''` */
  defaultChapterBody?: (index: number) => string;
}

/** State and actions returned by {@link useEpubProject}. */
export interface UseEpubProjectReturn {
  /** Current book metadata. */
  metadata: EpubProjectMetadata;
  /** Current chapters, in reading order. */
  chapters: readonly ManuscriptChapter[];
  /** Index of the chapter being edited. */
  selectedChapterIndex: number;
  /** The chapter at `selectedChapterIndex`, or `null` when there is none. */
  currentChapter: ManuscriptChapter | null;
  /** Current cover, or `null` when the project has no cover. */
  cover: CoverInput | null;
  /** Current non-cover assets, in registration order. */
  assets: readonly EpubProjectAsset[];
  /** Parsed EPUB built from the current project, refreshed after each debounced change. */
  previewEpub: EpubBook | null;
  /** Last preview build failure, if any. */
  previewError: Error | null;
  /** Whether a preview build is pending or running. */
  previewing: boolean;
  /** Whether an export is in progress. */
  exporting: boolean;
  /** Last export failure, if any; cleared when an export starts. */
  error: Error | null;
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
   * Replaces the cover, or drops it when passed `null`. The new cover is
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
  /**
   * Appends a chapter and selects it. Omitted fields are generated: a unique
   * id, and the title and body of `defaultChapterTitle` / `defaultChapterBody`.
   */
  addChapter: (chapter?: Partial<ManuscriptChapter>) => void;
  /**
   * Removes the chapter at `index`; the last remaining chapter is never
   * removed. Pass `selectedChapterIndex` to remove the selected one.
   */
  removeChapter: (index: number) => void;
  /**
   * Moves a chapter from `from` to `to`. An out-of-range `from` selects no
   * chapter and leaves the list untouched; `to` is clamped to the list bounds —
   * the same contract as `EpubProject.reorderChapters()`.
   */
  reorderChapters: (from: number, to: number) => void;
  /** Builds an `EpubProject` from the current state. */
  buildProject: () => EpubProject;
  /**
   * Packages the current project as EPUB bytes. A failure is stored in
   * `error`, passed to `onError` and rejects.
   */
  exportEpub: () => Promise<Uint8Array<ArrayBuffer>>;
}

/** Headless manuscript-to-EPUB project state for custom authoring UIs. */
export function useEpubProject(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  const defaultTitle = options.defaultChapterTitle;
  const defaultBody = options.defaultChapterBody;
  const [metadata, setMetadataState] = useState<EpubProjectMetadata>(() =>
    initialMetadata(options.initialMetadata),
  );
  const [chapters, setChaptersState] = useState<readonly ManuscriptChapter[]>(() =>
    options.initialChapters?.length
      ? options.initialChapters
      : [defaultChapter([], defaultTitle, defaultBody)],
  );
  const [selectedChapterIndex, setSelectedChapterState] = useState(0);
  const [cover, setCoverState] = useState<CoverInput | null>(options.initialCover ?? null);
  const [assets, setAssetsState] = useState<readonly EpubProjectAsset[]>(
    options.initialAssets ?? [],
  );
  const [previewEpub, setPreviewEpub] = useState<EpubBook | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const previewRequest = useRequestToken();
  const exportsInFlightRef = useRef(0);

  const onPreviewRef = useRef(options.onPreview);
  const onExportRef = useRef(options.onExport);
  const onErrorRef = useRef(options.onError);
  onPreviewRef.current = options.onPreview;
  onExportRef.current = options.onExport;
  onErrorRef.current = options.onError;
  const assetResolverRef = useRef(options.assetResolver);
  assetResolverRef.current = options.assetResolver;

  // Every action reads project state through these refs, which each setter
  // updates synchronously, so a call in the same tick as a setter sees its value.
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const selectedRef = useRef(selectedChapterIndex);
  selectedRef.current = selectedChapterIndex;
  const coverRef = useRef(cover);
  coverRef.current = cover;
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const buildProject = useCallback(() => {
    const currentCover = coverRef.current;
    const project = EpubProject.fromManuscript({
      metadata: metadataRef.current,
      includeTitlePage: false,
      includeTitleInFirstChapter: true,
      chapters: chaptersRef.current.map((chapter) => ({
        id: chapter.id,
        title: chapter.title || 'Untitled',
        body: chapter.body,
      })),
      ...(currentCover ? { cover: currentCover } : {}),
    });
    for (const asset of assetsRef.current) project.addAsset(asset);
    return project;
  }, []);

  const exportOptions = useCallback((signal?: AbortSignal): EpubExportOptions => {
    const resolver = assetResolverRef.current;
    return { ...(resolver ? { assetResolver: resolver } : {}), ...(signal ? { signal } : {}) };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the project state is read through refs; these values are what schedule a rebuild
  useEffect(() => {
    const token = previewRequest.begin();
    const controller = new AbortController();
    setPreviewing(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const signal = controller.signal;
          const epub = await parseEpub(await buildProject().export(exportOptions(signal)), {
            signal,
          });
          if (!previewRequest.isCurrent(token)) return;
          setPreviewEpub(epub);
          setPreviewError(null);
          onPreviewRef.current?.(epub);
        } catch (err) {
          if (previewRequest.isCurrent(token)) setPreviewError(toError(err));
        } finally {
          if (previewRequest.isCurrent(token)) setPreviewing(false);
        }
      })();
    }, options.debounceMs ?? 250);
    return () => {
      previewRequest.invalidate();
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    assets,
    buildProject,
    chapters,
    cover,
    exportOptions,
    metadata,
    options.debounceMs,
    previewRequest,
  ]);

  const currentChapter = chapters[selectedChapterIndex] ?? chapters[0] ?? null;

  // Mutators derive the next state from the refs and set it with plain values:
  // nesting one state update inside another's updater would apply the inner
  // relative update once per updater evaluation, which React is free to repeat
  // (StrictMode, discarded renders).
  const updateMetadata = useCallback((patch: Partial<EpubProjectMetadata>) => {
    const next = mergeMetadata(metadataRef.current, patch);
    metadataRef.current = next;
    setMetadataState(next);
  }, []);

  const commit = useCallback((nextChapters: readonly ManuscriptChapter[], nextSelected: number) => {
    chaptersRef.current = nextChapters;
    selectedRef.current = nextSelected;
    setChaptersState(nextChapters);
    setSelectedChapterState(nextSelected);
  }, []);

  const setChapters = useCallback(
    (next: readonly ManuscriptChapter[]) => {
      const normalized = next.length ? next : [defaultChapter([], defaultTitle, defaultBody)];
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
    [commit, defaultBody, defaultTitle],
  );

  const setCover = useCallback((next: CoverInput | null) => {
    coverRef.current = next;
    setCoverState(next);
  }, []);

  const setAssets = useCallback((next: readonly EpubProjectAsset[]) => {
    assetsRef.current = next;
    setAssetsState(next);
  }, []);

  const setSelectedChapterIndex = useCallback((index: number) => {
    const next = Math.max(0, Math.min(index, chaptersRef.current.length - 1));
    selectedRef.current = next;
    setSelectedChapterState(next);
  }, []);

  const updateChapter = useCallback((index: number, patch: Partial<ManuscriptChapter>) => {
    const next = chaptersRef.current.map((chapter, chapterIndex) =>
      chapterIndex === index ? { ...chapter, ...patch } : chapter,
    );
    chaptersRef.current = next;
    setChaptersState(next);
  }, []);

  const addChapter = useCallback(
    (chapter: Partial<ManuscriptChapter> = {}) => {
      const current = chaptersRef.current;
      const generated = defaultChapter(current, defaultTitle, defaultBody);
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
    [commit, defaultBody, defaultTitle],
  );

  const removeChapter = useCallback(
    (index: number) => {
      const current = chaptersRef.current;
      if (current.length <= 1) return;
      const next = current.filter((_, chapterIndex) => chapterIndex !== index);
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

  const exportEpub = useCallback(async (): Promise<Uint8Array<ArrayBuffer>> => {
    exportsInFlightRef.current++;
    setExporting(true);
    setError(null);
    try {
      const bytes = await buildProject().export(exportOptions());
      onExportRef.current?.(bytes);
      return bytes;
    } catch (err) {
      const nextError = toError(err);
      setError(nextError);
      onErrorRef.current?.(nextError);
      throw err;
    } finally {
      setExporting(--exportsInFlightRef.current > 0);
    }
  }, [buildProject, exportOptions]);

  return useMemo(
    () => ({
      metadata,
      chapters,
      selectedChapterIndex,
      currentChapter,
      cover,
      assets,
      previewEpub,
      previewError,
      previewing,
      exporting,
      error,
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
    }),
    [
      addChapter,
      assets,
      buildProject,
      chapters,
      cover,
      currentChapter,
      error,
      exportEpub,
      exporting,
      metadata,
      previewEpub,
      previewError,
      previewing,
      reorderChapters,
      removeChapter,
      selectedChapterIndex,
      setAssets,
      setChapters,
      setCover,
      setSelectedChapterIndex,
      updateChapter,
      updateMetadata,
    ],
  );
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
