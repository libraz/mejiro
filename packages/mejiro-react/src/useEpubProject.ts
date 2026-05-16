import {
  type EpubBook,
  EpubProject,
  type EpubProjectMetadata,
  parseEpub,
} from '@libraz/mejiro/epub';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface EpubProjectChapterDraft {
  id: string;
  title: string;
  body: string;
}

export interface UseEpubProjectOptions {
  metadata?: Partial<EpubProjectMetadata>;
  chapters?: EpubProjectChapterDraft[];
  debounceMs?: number;
  onPreview?: (book: EpubBook) => void;
  onExport?: (buffer: ArrayBuffer) => void;
}

export interface UseEpubProjectReturn {
  metadata: EpubProjectMetadata;
  chapters: EpubProjectChapterDraft[];
  selectedChapter: number;
  currentChapter: EpubProjectChapterDraft | null;
  previewBook: EpubBook | null;
  previewError: Error | null;
  previewing: boolean;
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

/** Headless manuscript-to-EPUB project state for custom authoring UIs. */
export function useEpubProject(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  const [metadata, setMetadataState] = useState<EpubProjectMetadata>({
    title: '新しい作品',
    language: 'ja',
    ...options.metadata,
  });
  const [chapters, setChaptersState] = useState<EpubProjectChapterDraft[]>(
    options.chapters?.length ? options.chapters : [defaultChapter(0)],
  );
  const [selectedChapter, setSelectedChapterState] = useState(0);
  const [previewBook, setPreviewBook] = useState<EpubBook | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewRequestIdRef = useRef(0);

  const onPreviewRef = useRef(options.onPreview);
  const onExportRef = useRef(options.onExport);
  onPreviewRef.current = options.onPreview;
  onExportRef.current = options.onExport;

  const buildProject = useCallback(
    () =>
      EpubProject.fromManuscript({
        metadata,
        includeTitlePage: false,
        includeTitleInFirstChapter: true,
        chapters: chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title || 'Untitled',
          body: chapter.body,
        })),
      }),
    [chapters, metadata],
  );

  useEffect(() => {
    const requestId = ++previewRequestIdRef.current;
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const book = await parseEpub(await buildProject().export());
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
      const normalized = next.length ? next : [defaultChapter(0)];
      setChaptersState(normalized);
      setSelectedChapterState((current) => {
        const selectedId = chapters[current]?.id;
        const nextIndex = selectedId
          ? normalized.findIndex((chapter) => chapter.id === selectedId)
          : -1;
        return nextIndex >= 0 ? nextIndex : Math.max(0, Math.min(current, normalized.length - 1));
      });
    },
    [chapters],
  );

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

  const addChapter = useCallback((chapter: Partial<EpubProjectChapterDraft> = {}) => {
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
      setSelectedChapterState(next.length - 1);
      return next;
    });
  }, []);

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
    const buffer = await buildProject().export();
    onExportRef.current?.(buffer);
    return buffer;
  }, [buildProject]);

  return useMemo(
    () => ({
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
    }),
    [
      addChapter,
      buildProject,
      chapters,
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
      setChapters,
      setMetadata,
      setSelectedChapter,
    ],
  );
}

function defaultChapter(index: number): EpubProjectChapterDraft {
  return {
    id: `chapter-${Date.now()}-${index}`,
    title: index === 0 ? '第一話' : `第${index + 1}話`,
    body: index === 0 ? 'これは｜漢字《かんじ》のルビ例です。\n\n本文をここに貼り付けます。' : '',
  };
}
