import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Options for {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /** Observe the surface element for size changes and re-flow. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) applied to size-triggered re-flows. @defaultValue 120 */
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
 * Re-layouts whenever `chapter`, `dialect`, or `book` change. The surface is
 * observed with {@link ResizeObserver}; size changes trigger a full re-layout
 * so pagination stays correct after non-trivial container changes.
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

  const requestIdRef = useRef(0);

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
    const el = surface.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let observed = false;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const scheduleReflow = (immediate: boolean): void => {
      clear();
      if (immediate) {
        void recompute();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void recompute();
      }, resizeDebounce);
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        const immediate = !observed;
        observed = true;
        scheduleReflow(immediate);
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
        clear();
      };
    }

    const onWindowResize = () => scheduleReflow(false);
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      clear();
    };
  }, [surface, enableResize, resizeDebounce, recompute]);

  return { layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute };
}
