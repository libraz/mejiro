import type {
  ChapterLayout,
  ComputePageSizeOptions,
  InChapterAnchor,
  MejiroBook,
} from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** Options for {@link useChapterLayout}. */
export interface UseChapterLayoutOptions {
  /** Observe the surface element for size changes and re-flow. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) applied to size-triggered re-flows. @defaultValue 120 */
  resizeDebounce?: number;
  /**
   * Resolver for page-geometry overrides forwarded to
   * {@link MejiroBook.computePageSize} — e.g. to shrink the reserved
   * `gutterOffset` / `headerOffset` so the pages fill their frame. Called on
   * every (re)layout so it may return a value that changes over time.
   */
  pageGeometry?: () => ComputePageSizeOptions | undefined;
  /**
   * Capture the current reading position from the outgoing layout, just before
   * a **reflow** (non-blank) re-layout replaces it. The returned anchor is
   * exposed via {@link UseChapterLayoutReturn.pendingRestore} and should be
   * applied once the new layout commits. Return `null` to skip preservation.
   * Never called for blank (content-change) re-layouts.
   *
   * A reflow yields a brand-new {@link ChapterLayout} object, which resets any
   * downstream spread index to 0; capturing here and restoring after keeps the
   * reader on the same passage across resizes and font / option changes.
   */
  capturePosition?: (layout: ChapterLayout) => InChapterAnchor | null;
}

/** Options for {@link UseChapterLayoutReturn.recompute}. */
export interface RecomputeOptions {
  /**
   * Blank the current layout while the new one is computed. Use for content
   * changes (chapter / book swaps); skip for size or option changes so the
   * previous spread stays visible until the re-flow completes (no flicker).
   * @defaultValue true
   */
  blank?: boolean;
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
  recompute: (opts?: RecomputeOptions) => Promise<void>;
  /**
   * Anchor captured before the most recent reflow re-layout, awaiting
   * restoration into the new {@link layout}. Consume it in a layout effect keyed
   * on `layout` (after any index reset) and clear it back to `null`.
   *
   * Declared as a `MutableRefObject` because consumers are expected to write to
   * it — `@types/react@18` models `RefObject.current` as read-only, so a
   * `RefObject` here would make the documented recipe fail to compile on the
   * lower end of the supported peer range.
   */
  pendingRestore: MutableRefObject<InChapterAnchor | null>;
}

/**
 * React hook that lays out the currently-selected chapter and re-flows when the
 * surface resizes.
 *
 * Re-layouts whenever `book`, `epub`, or `chapterIndex` change, against the
 * dimensions of `surface`. The `surface` element is observed with a
 * {@link ResizeObserver}: the first observation runs immediately (so a reader
 * mounted before its container had a final box is still sized correctly on
 * first paint), and later size changes trigger a debounced **full re-layout**.
 *
 * A full re-layout — rather than a `ChapterLayout.resize()` fast-path — is used
 * for size changes on purpose: the fast-path only stretches `pageWidth` and does
 * not re-paginate, leaving sparse, half-empty pages after a non-trivial size
 * delta. Because a full re-layout yields a new {@link ChapterLayout} object
 * (resetting any downstream spread index to 0), the reading position is
 * preserved across reflows via {@link UseChapterLayoutOptions.capturePosition}
 * and {@link UseChapterLayoutReturn.pendingRestore}.
 *
 * @param book - The book instance to lay out with.
 * @param epub - The current parsed EPUB.
 * @param chapterIndex - Zero-based chapter index to lay out.
 * @param surface - DOM ref for the reading surface used for page sizing.
 * @param options - Behavior overrides.
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
  const pendingRestore = useRef<InChapterAnchor | null>(null);
  layoutRef.current = layout;

  // Keep the latest function-valued options in a ref so `recompute` stays stable
  // across renders even as `pageGeometry` / `capturePosition` change identity.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recompute = useCallback(
    async (opts: RecomputeOptions = {}) => {
      const blank = opts.blank ?? true;
      const o = optionsRef.current;
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
      // Capture the reading position before a reflow swaps in a new layout so it
      // can be restored once the new layout commits (a new layout object resets
      // the spread index). Blank (content-change) re-layouts start at spread 0.
      const captured =
        !blank && layoutRef.current ? (o.capturePosition?.(layoutRef.current) ?? null) : null;
      pendingRestore.current = captured;
      if (blank) setLayout(null);
      const dims = book.computePageSize(surface.current, o.pageGeometry?.());
      setPageWidth(dims.pageWidth);
      setPageHeight(dims.pageHeight);
      setContentHeight(dims.contentHeight);
      const t0 = performance.now();
      const l = await book.layoutChapter(chapter);
      if (requestId !== requestIdRef.current) return;
      layoutRef.current = l;
      setLayout(l);
      setElapsedMs(performance.now() - t0);
    },
    [book, epub, chapterIndex, surface],
  );

  // Reset before paint when the source chapter/layout inputs change so a stale
  // spread from the previous source can never be rendered under the new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute changes exactly when the source chapter/layout inputs change.
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

  // Size-driven re-flow. A full re-layout is used (not `ChapterLayout.resize`)
  // so pagination stays correct; see the hook doc comment.
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
    const scheduleReflow = (immediate: boolean) => {
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
        // it immediately so the very first layout is correct even if the reader
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

    // Fallback for environments without ResizeObserver (e.g. very old browsers).
    const onWindowResize = () => scheduleReflow(false);
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      clear();
    };
  }, [surface, enableResize, resizeDebounce, recompute]);

  return {
    layout,
    pageWidth,
    pageHeight,
    contentHeight,
    elapsedMs,
    recompute,
    pendingRestore,
  };
}
