import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
} from '@libraz/mejiro/book';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** Options for {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /** Observe the surface element for size changes and re-flow. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) applied to size-triggered re-flows. @defaultValue 120 */
  resizeDebounce?: number;
  /**
   * Capture the current reading position from the outgoing layout, just before
   * a **reflow** (non-blank) re-layout replaces it. The returned anchor is
   * exposed via {@link UseManuscriptLayoutReturn.pendingRestore} and should be
   * applied once the new layout commits. Return `null` to skip preservation.
   * Never called for blank (content-change) re-layouts.
   */
  capturePosition?: (layout: ChapterLayout) => InChapterAnchor | null;
}

/** Options for {@link UseManuscriptLayoutReturn.recompute}. */
export interface ManuscriptRecomputeOptions {
  /**
   * Blank the current layout while the new one is computed. Use for content
   * changes (chapter swaps); skip for size changes so the previous spread stays
   * visible until the re-flow completes (no flicker).
   * @defaultValue true
   */
  blank?: boolean;
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
  recompute: (opts?: ManuscriptRecomputeOptions) => Promise<void>;
  /**
   * Anchor captured before the most recent reflow re-layout, awaiting
   * restoration into the new {@link layout}. Consume it in a layout effect keyed
   * on `layout` (after any index reset) and clear it back to `null`.
   */
  pendingRestore: MutableRefObject<InChapterAnchor | null>;
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
 *
 * A size-driven re-layout keeps the previous layout on screen while the new one
 * is computed (no blank flash) and yields a new {@link ChapterLayout} object,
 * which resets any downstream spread index to 0; the reading position is
 * preserved across such reflows via
 * {@link UseManuscriptLayoutOptions.capturePosition} and
 * {@link UseManuscriptLayoutReturn.pendingRestore}.
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
  const layoutRef = useRef<ChapterLayout | null>(null);
  layoutRef.current = layout;
  const pendingRestore = useRef<InChapterAnchor | null>(null);

  // Keep the latest function-valued options in a ref so `recompute` stays stable
  // across renders even as `capturePosition` changes identity.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recompute = useCallback(
    async (opts: ManuscriptRecomputeOptions = {}) => {
      const blank = opts.blank ?? true;
      const requestId = ++requestIdRef.current;
      if (!(chapter && surface.current)) {
        setLayout(null);
        setPageWidth(0);
        setPageHeight(0);
        setContentHeight(0);
        setElapsedMs(0);
        return;
      }
      // Capture the reading position before a reflow swaps in a new layout so it
      // can be restored once the new layout commits (a new layout object resets
      // the spread index). Blank (content-change) re-layouts start at spread 0.
      const captured =
        !blank && layoutRef.current
          ? (optionsRef.current.capturePosition?.(layoutRef.current) ?? null)
          : null;
      pendingRestore.current = captured;
      if (blank) setLayout(null);
      const dims = book.computePageSize(surface.current);
      setPageWidth(dims.pageWidth);
      setPageHeight(dims.pageHeight);
      setContentHeight(dims.contentHeight);
      const t0 = performance.now();
      const layouts = await book.layoutManuscript({ chapters: [chapter], dialect });
      if (requestId !== requestIdRef.current) return;
      const next = layouts.values().next().value ?? null;
      layoutRef.current = next;
      setLayout(next);
      setElapsedMs(performance.now() - t0);
    },
    [book, chapter, dialect, surface],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute is the union of all relevant inputs.
  useLayoutEffect(() => {
    requestIdRef.current++;
    pendingRestore.current = null;
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
    // Keep the current layout on screen while the new one is computed: a size
    // change must not blank the preview or send the reader back to spread 0.
    const scheduleReflow = (immediate: boolean): void => {
      clear();
      if (immediate) {
        void recompute({ blank: false });
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void recompute({ blank: false });
      }, resizeDebounce);
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        // The first callback fires with the element's real, laid-out size — run
        // it immediately so the very first layout is correct even if the preview
        // mounted before the surface had its final box. Debounce later changes.
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

  return { layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute, pendingRestore };
}
