import {
  type AssetResolver,
  type EpubBook,
  EpubProject,
  type EpubProjectAsset,
  type EpubProjectMetadata,
  parseEpub,
} from '@libraz/mejiro/epub';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** One chapter of the manuscript draft the hook keeps in React state. */
export interface EpubProjectChapterDraft {
  id: string;
  title: string;
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
  metadata: EpubProjectMetadata;
  chapters: EpubProjectChapterDraft[];
  selectedChapter: number;
  currentChapter: EpubProjectChapterDraft | null;
  /** Current cover asset, or `null` when the project has no cover. */
  cover: EpubProjectAsset | null;
  /** Current non-cover assets, in registration order. */
  assets: EpubProjectAsset[];
  previewBook: EpubBook | null;
  previewError: Error | null;
  previewing: boolean;
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
  /**
   * Moves a chapter from `from` to `to`. An out-of-range `from` selects no
   * chapter and leaves the list untouched; `to` is clamped to the list bounds —
   * the same contract as `EpubProject.reorderChapters()`.
   */
  reorderChapters: (from: number, to: number) => void;
  buildProject: () => EpubProject;
  exportEpub: () => Promise<ArrayBuffer>;
}

/** Headless manuscript-to-EPUB project state for custom authoring UIs. */
export function useEpubProject(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  const defaultTitle = options.defaultChapterTitle;
  const defaultBody = options.defaultChapterBody;
  const [metadata, setMetadataState] = useState<EpubProjectMetadata>({
    title: '新しい作品',
    language: 'ja',
    ...options.metadata,
  });
  const [chapters, setChaptersState] = useState<EpubProjectChapterDraft[]>(
    options.chapters?.length ? options.chapters : [defaultChapter(0, defaultTitle, defaultBody)],
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

  const buildProject = useCallback(() => {
    const project = EpubProject.fromManuscript({
      metadata,
      includeTitlePage: false,
      includeTitleInFirstChapter: true,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title || 'Untitled',
        body: chapter.body,
      })),
      ...(cover ? { cover } : {}),
    });
    for (const asset of assets) project.addAsset(asset);
    return project;
  }, [assets, chapters, cover, metadata]);

  const assetResolverRef = useRef(options.assetResolver);
  assetResolverRef.current = options.assetResolver;

  useEffect(() => {
    const requestId = ++previewRequestIdRef.current;
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const resolver = assetResolverRef.current;
          const book = await parseEpub(
            await buildProject().export(resolver ? { assetResolver: resolver } : undefined),
          );
          if (cancelled || requestId !== previewRequestIdRef.current) return;
          setPreviewBook(book);
          setPreviewError(null);
          onPreviewRef.current?.(book);
        } catch (err) {
          if (!cancelled && requestId === previewRequestIdRef.current) {
            setPreviewError(err instanceof Error ? err : new Error(String(err)));
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
    };
  }, [buildProject, options.debounceMs]);

  const currentChapter = chapters[selectedChapter] ?? chapters[0] ?? null;

  const setMetadata = useCallback((patch: Partial<EpubProjectMetadata>) => {
    setMetadataState((current) => ({ ...current, ...patch }));
  }, []);

  const setChapters = useCallback(
    (next: EpubProjectChapterDraft[]) => {
      const normalized = next.length ? next : [defaultChapter(0, defaultTitle, defaultBody)];
      setChaptersState(normalized);
      setSelectedChapterState((current) => {
        const selectedId = chapters[current]?.id;
        const nextIndex = selectedId
          ? normalized.findIndex((chapter) => chapter.id === selectedId)
          : -1;
        return nextIndex >= 0 ? nextIndex : Math.max(0, Math.min(current, normalized.length - 1));
      });
    },
    [chapters, defaultBody, defaultTitle],
  );

  const setCover = useCallback((asset: EpubProjectAsset | null) => {
    setCoverState(asset);
  }, []);

  const setAssets = useCallback((next: EpubProjectAsset[]) => {
    setAssetsState(next);
  }, []);

  const setSelectedChapter = useCallback(
    (index: number) => {
      setSelectedChapterState(Math.max(0, Math.min(index, chapters.length - 1)));
    },
    [chapters.length],
  );

  const patchChapter = useCallback((index: number, patch: Partial<EpubProjectChapterDraft>) => {
    setChaptersState((current) =>
      current.map((chapter, chapterIndex) =>
        chapterIndex === index ? { ...chapter, ...patch } : chapter,
      ),
    );
  }, []);

  const addChapter = useCallback(
    (chapter: Partial<EpubProjectChapterDraft> = {}) => {
      setChaptersState((current) => {
        const generated = defaultChapter(current.length, defaultTitle, defaultBody);
        const next = [
          ...current,
          {
            id: chapter.id ?? generated.id,
            title: chapter.title ?? generated.title,
            body: chapter.body ?? generated.body,
          },
        ];
        setSelectedChapterState(next.length - 1);
        return next;
      });
    },
    [defaultBody, defaultTitle],
  );

  const removeChapter = useCallback(
    (index = selectedChapter) => {
      setChaptersState((current) => {
        if (current.length <= 1) return current;
        const next = current.filter((_, chapterIndex) => chapterIndex !== index);
        setSelectedChapterState((currentSelected) => {
          if (currentSelected === index) return Math.max(0, Math.min(index, next.length - 1));
          if (index < currentSelected) return currentSelected - 1;
          return Math.max(0, Math.min(currentSelected, next.length - 1));
        });
        return next;
      });
    },
    [selectedChapter],
  );

  const reorderChapters = useCallback((from: number, to: number) => {
    setChaptersState((current) => {
      if (from < 0 || from >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      const target = Math.max(0, Math.min(next.length, to));
      next.splice(target, 0, moved);
      setSelectedChapterState((currentSelected) => {
        if (currentSelected === from) return target;
        if (from < currentSelected && target >= currentSelected) return currentSelected - 1;
        if (from > currentSelected && target <= currentSelected) return currentSelected + 1;
        return currentSelected;
      });
      return next;
    });
  }, []);

  const exportEpub = useCallback(async (): Promise<ArrayBuffer> => {
    const resolver = assetResolverRef.current;
    const buffer = await buildProject().export(resolver ? { assetResolver: resolver } : undefined);
    onExportRef.current?.(buffer);
    return buffer;
  }, [buildProject]);

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
