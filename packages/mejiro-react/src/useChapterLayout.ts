import type { ChapterLayout, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Options for {@link useChapterLayout}. */
export interface UseChapterLayoutOptions {
  /** Listen for `window.resize` and re-flow on resize. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) for resize re-flows. @defaultValue 120 */
  resizeDebounce?: number;
}

/** Page dimensions returned by {@link MejiroBook.computePageSize}. */
export interface PageDimensions {
  pageWidth: number;
  pageHeight: number;
  contentHeight: number;
}

/** Return value of {@link useChapterLayout}. */
export interface UseChapterLayoutReturn {
  /** Current layout, or `null` before the first computation. */
  layout: ChapterLayout | null;
  /** Page width in pixels. */
  pageWidth: number;
  /** Page height in pixels. */
  pageHeight: number;
  /** Content height in pixels. */
  contentHeight: number;
  /** Most recent layout time (ms). */
  elapsedMs: number;
  /** Force a fresh layout computation. */
  recompute: () => Promise<void>;
}

/**
 * React hook that lays out the currently-selected chapter and re-flows on resize.
 *
 * Re-layouts whenever `epub` or `chapterIndex` change. On `window.resize`,
 * page dimensions are recomputed and {@link ChapterLayout.resize} is called
 * instead of a full re-layout.
 */
export function useChapterLayout(
  book: MejiroBook,
  epub: EpubBook | null,
  chapterIndex: number,
  surface: RefObject<HTMLElement | null>,
  options: UseChapterLayoutOptions = {},
): UseChapterLayoutReturn {
  const enableResize = options.enableResize ?? true;
  const resizeDebounce = options.resizeDebounce ?? 120;

  const [layout, setLayout] = useState<ChapterLayout | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const layoutRef = useRef<ChapterLayout | null>(null);
  const requestIdRef = useRef(0);
  layoutRef.current = layout;

  const recompute = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const chapter = epub?.chapters[chapterIndex];
    if (!(chapter && surface.current)) {
      setLayout(null);
      setPageWidth(0);
      setPageHeight(0);
      setContentHeight(0);
      setElapsedMs(0);
      return;
    }
    setLayout(null);
    const dims = book.computePageSize(surface.current);
    setPageWidth(dims.pageWidth);
    setPageHeight(dims.pageHeight);
    setContentHeight(dims.contentHeight);
    const t0 = performance.now();
    const l = await book.layoutChapter(chapter);
    if (requestId !== requestIdRef.current) return;
    setLayout(l);
    setElapsedMs(performance.now() - t0);
  }, [book, epub, chapterIndex, surface]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute changes exactly when the source chapter/layout inputs change.
  useLayoutEffect(() => {
    requestIdRef.current++;
    setLayout(null);
    setPageWidth(0);
    setPageHeight(0);
    setContentHeight(0);
    setElapsedMs(0);
  }, [recompute]);

  useEffect(() => {
    void recompute();
    return () => {
      requestIdRef.current++;
    };
  }, [recompute]);

  useEffect(() => {
    if (!enableResize) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (!(surface.current && layoutRef.current)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!(surface.current && layoutRef.current)) return;
        const dims = book.computePageSize(surface.current);
        setPageWidth(dims.pageWidth);
        setPageHeight(dims.pageHeight);
        setContentHeight(dims.contentHeight);
        layoutRef.current.resize({
          pageWidth: dims.pageWidth,
          lineWidth: dims.contentHeight - book.getOptions().fontSize * 0.5,
        });
      }, resizeDebounce);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, [book, surface, enableResize, resizeDebounce]);

  return { layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute };
}
