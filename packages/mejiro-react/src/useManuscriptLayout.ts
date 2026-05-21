import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Options for {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /** Listen for `window.resize` and re-flow on resize. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) for resize re-flows. @defaultValue 120 */
  resizeDebounce?: number;
}

/** Page dimensions returned by {@link MejiroBook.computePageSize}. */
export interface ManuscriptPageDimensions {
  pageWidth: number;
  pageHeight: number;
  contentHeight: number;
}

/** Return value of {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutReturn {
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
 * React hook that lays out a single manuscript chapter directly, skipping the
 * EPUB ZIP round-trip used by {@link useChapterLayout}.
 *
 * Intended for live preview in custom manuscript editors: pair with
 * {@link useManuscriptDraft} for the chapter array and feed the resulting
 * {@link ChapterLayout} into {@link MejiroSpread} or {@link MejiroScrollView}.
 *
 * Re-layouts whenever `chapter`, `dialect`, or `book` change. On `window.resize`,
 * page dimensions are recomputed and {@link ChapterLayout.resize} is called
 * instead of a full re-layout.
 */
export function useManuscriptLayout(
  book: MejiroBook,
  chapter: ManuscriptChapter | null,
  surface: RefObject<HTMLElement | null>,
  options: UseManuscriptLayoutOptions = {},
): UseManuscriptLayoutReturn {
  const dialect = options.dialect ?? 'mejiro';
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
    const layouts = await book.layoutManuscript({ chapters: [chapter], dialect });
    if (requestId !== requestIdRef.current) return;
    const next = layouts.values().next().value ?? null;
    setLayout(next);
    setElapsedMs(performance.now() - t0);
  }, [book, chapter, dialect, surface]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute is the union of all relevant inputs.
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
    const onResize = (): void => {
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
