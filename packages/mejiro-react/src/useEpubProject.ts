import {
  type AssetResolver,
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

/** One chapter of the manuscript draft the hook keeps in React state. */
export interface EpubProjectChapterDraft {
  /** Stable chapter identifier. */
  id: string;
  /** Chapter title. */
  title: string;
  /** Chapter body in the manuscript notation. */
  body: string;
}

/** Options for {@link useEpubProject}. */
export interface UseEpubProjectOptions {
  /** Initial package metadata, merged over the hook's Japanese defaults. */
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
  /** Current book metadata. */
  metadata: EpubProjectMetadata;
  /** Current chapter drafts, in reading order. */
  chapters: EpubProjectChapterDraft[];
  /** Index of the chapter being edited. */
  selectedChapter: number;
  /** The chapter at `selectedChapter`, or `null` when there is none. */
  currentChapter: EpubProjectChapterDraft | null;
  /** Current cover asset, or `null` when the project has no cover. */
  cover: EpubProjectAsset | null;
  /** Current non-cover assets, in registration order. */
  assets: EpubProjectAsset[];
  /** Parsed EPUB built from the current project, refreshed after each debounced change. */
  previewBook: EpubBook | null;
  /** Last preview build failure, if any. */
  previewError: Error | null;
  /** Whether a preview build is pending or running. */
  previewing: boolean;
  /** Merges `patch` into the metadata. */
  setMetadata: (patch: Partial<EpubProjectMetadata>) => void;
  /** Replaces every chapter; an empty list becomes one generated chapter. */
  setChapters: (chapters: EpubProjectChapterDraft[]) => void;
  /** Selects a chapter, clamped to the chapter range. */
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
  /** Merges `patch` into the chapter at `index`. */
  patchChapter: (index: number, patch: Partial<EpubProjectChapterDraft>) => void;
  /** Appends a chapter (generated defaults fill omitted fields) and selects it. */
  addChapter: (chapter?: Partial<EpubProjectChapterDraft>) => void;
  /**
   * Removes the chapter at `index` (the selected one by default); the last chapter is never
   * removed.
   */
  removeChapter: (index?: number) => void;
  /**
   * Moves a chapter from `from` to `to`. An out-of-range `from` selects no
   * chapter and leaves the list untouched; `to` is clamped to the list bounds —
   * the same contract as `EpubProject.reorderChapters()`.
   */
  reorderChapters: (from: number, to: number) => void;
  /** Builds an `EpubProject` from the current state. */
  buildProject: () => EpubProject;
  /** Packages the current project as an EPUB buffer. */
  exportEpub: () => Promise<ArrayBuffer>;
}

/** Headless manuscript-to-EPUB project state for custom authoring UIs. */
export function useEpubProject(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  const defaultTitle = options.defaultChapterTitle;
  const defaultBody = options.defaultChapterBody;
  const [metadata, setMetadataState] = useState<EpubProjectMetadata>(() =>
    initialMetadata(options.metadata),
  );
  const [chapters, setChaptersState] = useState<EpubProjectChapterDraft[]>(() =>
    options.chapters?.length ? options.chapters : [defaultChapter([], defaultTitle, defaultBody)],
  );
  const [selectedChapter, setSelectedChapterState] = useState(0);
  const [cover, setCoverState] = useState<EpubProjectAsset | null>(options.cover ?? null);
  const [assets, setAssetsState] = useState<EpubProjectAsset[]>(options.assets ?? []);
  const [previewBook, setPreviewBook] = useState<EpubBook | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewRequestIdRef = useRef(0);

  const onPreviewRef = useRef(options.onPreview);
  const onExportRef = useRef(options.onExport);
  onPreviewRef.current = options.onPreview;
  onExportRef.current = options.onExport;
  const assetResolverRef = useRef(options.assetResolver);
  assetResolverRef.current = options.assetResolver;

  // Every action reads project state through these refs, which each setter
  // updates synchronously, so a call in the same tick as a setter sees its value.
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const selectedRef = useRef(selectedChapter);
  selectedRef.current = selectedChapter;
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
    const requestId = ++previewRequestIdRef.current;
    const controller = new AbortController();
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const book = await parseEpub(
            await buildProject().export(exportOptions(controller.signal)),
          );
          if (cancelled || requestId !== previewRequestIdRef.current) return;
          setPreviewBook(book);
          setPreviewError(null);
          onPreviewRef.current?.(book);
        } catch (err) {
          if (!cancelled && requestId === previewRequestIdRef.current) {
            setPreviewError(toError(err));
          }
        } finally {
          if (!cancelled && requestId === previewRequestIdRef.current) setPreviewing(false);
        }
      })();
    }, options.debounceMs ?? 250);
    return () => {
      cancelled = true;
      previewRequestIdRef.current++;
      clearTimeout(timer);
      controller.abort();
    };
  }, [assets, buildProject, chapters, cover, exportOptions, metadata, options.debounceMs]);

  const currentChapter = chapters[selectedChapter] ?? chapters[0] ?? null;

  // Mutators derive the next state from the refs and set it with plain values:
  // nesting one state update inside another's updater would apply the inner
  // relative update once per updater evaluation, which React is free to repeat
  // (StrictMode, discarded renders).
  const setMetadata = useCallback((patch: Partial<EpubProjectMetadata>) => {
    const next = { ...metadataRef.current, ...patch };
    metadataRef.current = next;
    setMetadataState(next);
  }, []);

  const commit = useCallback((nextChapters: EpubProjectChapterDraft[], nextSelected: number) => {
    chaptersRef.current = nextChapters;
    selectedRef.current = nextSelected;
    setChaptersState(nextChapters);
    setSelectedChapterState(nextSelected);
  }, []);

  const setChapters = useCallback(
    (next: EpubProjectChapterDraft[]) => {
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

  const setCover = useCallback((asset: EpubProjectAsset | null) => {
    coverRef.current = asset;
    setCoverState(asset);
  }, []);

  const setAssets = useCallback((next: EpubProjectAsset[]) => {
    assetsRef.current = next;
    setAssetsState(next);
  }, []);

  const setSelectedChapter = useCallback((index: number) => {
    const next = Math.max(0, Math.min(index, chaptersRef.current.length - 1));
    selectedRef.current = next;
    setSelectedChapterState(next);
  }, []);

  const patchChapter = useCallback((index: number, patch: Partial<EpubProjectChapterDraft>) => {
    const next = chaptersRef.current.map((chapter, chapterIndex) =>
      chapterIndex === index ? { ...chapter, ...patch } : chapter,
    );
    chaptersRef.current = next;
    setChaptersState(next);
  }, []);

  const addChapter = useCallback(
    (chapter: Partial<EpubProjectChapterDraft> = {}) => {
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
    (index = selectedRef.current) => {
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

  const exportEpub = useCallback(async (): Promise<ArrayBuffer> => {
    const buffer = await buildProject().export(exportOptions());
    onExportRef.current?.(buffer);
    return buffer;
  }, [buildProject, exportOptions]);

  return useMemo(
    () => ({
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
    }),
    [
      addChapter,
      assets,
      buildProject,
      chapters,
      cover,
      currentChapter,
      exportEpub,
      metadata,
      patchChapter,
      previewBook,
      previewError,
      previewing,
      reorderChapters,
      removeChapter,
      selectedChapter,
      setAssets,
      setChapters,
      setCover,
      setMetadata,
      setSelectedChapter,
    ],
  );
}

/** Seeds the metadata with an identifier, so every build of one project shares it. */
function initialMetadata(patch: Partial<EpubProjectMetadata> = {}): EpubProjectMetadata {
  const metadata = mergeDefined<EpubProjectMetadata>(
    { title: '新しい作品', language: 'ja' },
    patch,
  );
  if (!metadata.identifier?.trim()) metadata.identifier = `urn:uuid:${crypto.randomUUID()}`;
  return metadata;
}

function defaultChapter(
  existing: readonly EpubProjectChapterDraft[],
  titleFor: (index: number) => string = (i) => (i === 0 ? '第一話' : `第${i + 1}話`),
  bodyFor: (index: number) => string = (i) =>
    i === 0 ? 'これは｜漢字《かんじ》のルビ例です。\n\n本文をここに貼り付けます。' : '',
): EpubProjectChapterDraft {
  const index = existing.length;
  return { id: uniqueChapterId(existing), title: titleFor(index), body: bodyFor(index) };
}
