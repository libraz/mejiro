import type {
  ChapterLayout,
  ComputePageSizeOptions,
  InChapterAnchor,
  MejiroBook,
} from '@libraz/mejiro/book';
import type { EpubBook, EpubChapter } from '@libraz/mejiro/epub';
import { onUnmounted, type Ref, shallowRef, watch } from 'vue';

/** Options for {@link useChapterLayout}. */
export interface UseChapterLayoutOptions {
  /**
   * Whether to observe the surface element for size changes and re-flow.
   * @defaultValue true
   */
  enableResize?: boolean;
  /** Debounce window (ms) applied to size-triggered re-flows. @defaultValue 120 */
  resizeDebounce?: number;
  /**
   * Resolver for page-geometry overrides forwarded to
   * {@link MejiroBook.computePageSize} — e.g. to shrink the reserved
   * `gutterOffset` / `headerOffset` so the pages fill their frame. Called on
   * every (re)layout so it may return a reactive value.
   */
  pageGeometry?: () => ComputePageSizeOptions | undefined;
  /**
   * Capture the current reading position from the outgoing layout, just before
   * a **reflow** (non-blank) re-layout replaces it. The returned anchor is
   * handed back to {@link restorePosition} once the new layout is ready. Return
   * `null` to skip preservation. Never called for blank (content-change)
   * re-layouts — those intentionally start at spread 0.
   *
   * A reflow produces a brand-new {@link ChapterLayout} object, which resets any
   * downstream spread index to 0; capturing here and restoring after keeps the
   * reader on the same passage across resizes and font / option changes.
   */
  capturePosition?: (layout: ChapterLayout) => InChapterAnchor | null;
  /**
   * Restore an anchor captured by {@link capturePosition} into the freshly
   * computed layout — e.g. locate the anchor and jump to its spread. Called
   * synchronously after a reflow re-layout commits.
   */
  restorePosition?: (layout: ChapterLayout, position: InChapterAnchor) => void;
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
  /** Current {@link ChapterLayout}, or `null` before the first computation. */
  layout: Ref<ChapterLayout | null>;
  /** Current page width in pixels. */
  pageWidth: Ref<number>;
  /** Current page height in pixels. */
  pageHeight: Ref<number>;
  /** Current content area height in pixels. */
  contentHeight: Ref<number>;
  /** Elapsed layout time in milliseconds for the most recent computation. */
  elapsedMs: Ref<number>;
  /** Force a fresh layout computation. */
  recompute: (opts?: RecomputeOptions) => Promise<void>;
}

/**
 * Vue composable that lays out the currently-selected chapter and re-flows when
 * the surface resizes.
 *
 * Whenever `book`, `epub`, or `chapterIndex` change, the chapter is laid out
 * against the dimensions of `surface`. The `surface` element is observed with a
 * {@link ResizeObserver}: the first observation runs immediately (so a reader
 * mounted before its container had a final box is still sized correctly on
 * first paint), and later size changes trigger a debounced **full re-layout**.
 *
 * A full re-layout — rather than a `ChapterLayout.resize()` fast-path — is used
 * for size changes on purpose: the fast-path only stretches `pageWidth` and does
 * not re-paginate, which leaves sparse, half-empty pages after any non-trivial
 * size delta. `book.layoutChapter` is deterministic and fast, so re-running it
 * is both correct and cheap. Because a full re-layout yields a new
 * {@link ChapterLayout} object (resetting any downstream spread index to 0), the
 * reading position is preserved across reflows via the optional
 * {@link UseChapterLayoutOptions.capturePosition} / `restorePosition` hooks.
 *
 * @param book - The book instance to lay out with.
 * @param epub - The current parsed EPUB.
 * @param chapterIndex - Zero-based chapter index to lay out.
 * @param surface - DOM ref for the reading surface used for page sizing.
 * @param options - Behavior overrides.
 */
export function useChapterLayout(
  book: MejiroBook,
  epub: Ref<EpubBook | null>,
  chapterIndex: Ref<number>,
  surface: Ref<HTMLElement | null>,
  options: UseChapterLayoutOptions = {},
): UseChapterLayoutReturn {
  const enableResize = options.enableResize ?? true;
  const resizeDebounce = options.resizeDebounce ?? 120;

  const layout = shallowRef<ChapterLayout | null>(null);
  const pageWidth = shallowRef(0);
  const pageHeight = shallowRef(0);
  const contentHeight = shallowRef(0);
  const elapsedMs = shallowRef(0);
  let layoutRequestId = 0;

  function currentChapter(): EpubChapter | null {
    return epub.value?.chapters[chapterIndex.value] ?? null;
  }

  async function recompute(opts: RecomputeOptions = {}): Promise<void> {
    const blank = opts.blank ?? true;
    const requestId = ++layoutRequestId;
    const chapter = currentChapter();
    if (!(chapter && surface.value)) {
      layout.value = null;
      pageWidth.value = 0;
      pageHeight.value = 0;
      contentHeight.value = 0;
      elapsedMs.value = 0;
      return;
    }

    // Capture the reading position before a reflow swaps in a new layout, so we
    // can restore it afterwards (a new layout object resets the spread index).
    const captured =
      !blank && layout.value ? (options.capturePosition?.(layout.value) ?? null) : null;

    if (blank) layout.value = null;

    const dims = book.computePageSize(surface.value, options.pageGeometry?.());
    pageWidth.value = dims.pageWidth;
    pageHeight.value = dims.pageHeight;
    contentHeight.value = dims.contentHeight;

    const t0 = performance.now();
    const nextLayout = await book.layoutChapter(chapter);
    if (requestId !== layoutRequestId) return;
    layout.value = nextLayout;
    elapsedMs.value = performance.now() - t0;
    if (captured) options.restorePosition?.(nextLayout, captured);
  }

  watch([epub, chapterIndex, surface], () => void recompute(), { immediate: true, flush: 'sync' });

  // --- Size-driven re-flow ---------------------------------------------------
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
  }

  function scheduleReflow(immediate: boolean): void {
    clearTimer();
    if (immediate) {
      void recompute({ blank: false });
      return;
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      void recompute({ blank: false });
    }, resizeDebounce);
  }

  let observer: ResizeObserver | null = null;
  let observed = false;

  function disconnect(): void {
    observer?.disconnect();
    observer = null;
    observed = false;
  }

  function observeSurface(el: HTMLElement | null): void {
    disconnect();
    if (!(enableResize && el) || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(() => {
      // The first callback fires with the element's real, laid-out size — run it
      // immediately so the very first layout is correct even if the reader
      // mounted before the surface had its final box. Debounce later changes.
      const immediate = !observed;
      observed = true;
      scheduleReflow(immediate);
    });
    observer.observe(el);
  }

  if (enableResize) {
    watch(surface, (el) => observeSurface(el), { immediate: true });

    // Fallback for environments without ResizeObserver (e.g. very old browsers).
    if (typeof ResizeObserver === 'undefined' && typeof window !== 'undefined') {
      const onWindowResize = (): void => scheduleReflow(false);
      window.addEventListener('resize', onWindowResize);
      onUnmounted(() => window.removeEventListener('resize', onWindowResize));
    }
  }

  onUnmounted(() => {
    disconnect();
    clearTimer();
  });

  return { layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute };
}
