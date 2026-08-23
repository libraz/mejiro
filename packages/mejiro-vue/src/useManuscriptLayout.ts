import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
} from '@libraz/mejiro/book';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { onUnmounted, type Ref, shallowRef, unref, watch } from 'vue';

/** Options for {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: Ref<ManuscriptDialect> | ManuscriptDialect;
  /**
   * Whether to observe the surface element for size changes and re-flow.
   * Read once during setup — later changes are not picked up.
   * @defaultValue true
   */
  enableResize?: boolean;
  /**
   * Debounce window (ms) applied to size-triggered re-flows. Read once during
   * setup — later changes are not picked up. @defaultValue 120
   */
  resizeDebounce?: number;
  /**
   * Capture the current reading position from the outgoing layout, just before
   * a **reflow** (non-blank) re-layout replaces it. The returned anchor is
   * handed back to {@link restorePosition} once the new layout is ready. Return
   * `null` to skip preservation. Never called for blank (content-change)
   * re-layouts — those intentionally start at spread 0.
   */
  capturePosition?: (layout: ChapterLayout) => InChapterAnchor | null;
  /**
   * Restore an anchor captured by {@link capturePosition} into the freshly
   * computed layout — e.g. locate the anchor and jump to its spread. Called
   * synchronously after a reflow re-layout commits.
   */
  restorePosition?: (layout: ChapterLayout, position: InChapterAnchor) => void;
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
  recompute: (opts?: ManuscriptRecomputeOptions) => Promise<void>;
}

function unwrap<T>(value: Ref<T> | T): T {
  return value && typeof value === 'object' && 'value' in (value as object)
    ? (value as Ref<T>).value
    : (value as T);
}

/**
 * Vue composable that lays out a single manuscript chapter directly, skipping
 * the EPUB ZIP round-trip used by {@link useChapterLayout}.
 *
 * Intended for live preview in custom manuscript editors: pair with the
 * chapter array from your own draft store and feed the resulting
 * {@link ChapterLayout} into {@link MejiroSpread} or {@link MejiroScrollView}.
 *
 * Re-layouts whenever `book`, `chapter`, or `dialect` change. The `surface`
 * element is observed with a {@link ResizeObserver}: the first observation runs
 * immediately (so a preview mounted before its container had a final box is
 * still sized correctly on first paint), and later size changes trigger a
 * debounced **full re-layout**.
 *
 * A full re-layout — rather than a `ChapterLayout.resize()` fast-path — is used
 * for size changes on purpose: the fast-path only stretches `pageWidth` and does
 * not re-paginate, which leaves sparse, half-empty pages after any non-trivial
 * size delta. Because a full re-layout yields a new {@link ChapterLayout} object
 * (resetting any downstream spread index to 0), the reading position is
 * preserved across reflows via the optional
 * {@link UseManuscriptLayoutOptions.capturePosition} / `restorePosition` hooks.
 *
 * @param book - The book instance to lay out with. Pass a `Ref` to swap the
 *   book (e.g. a different typography profile) at runtime — the chapter is
 *   laid out again with the new instance.
 * @param chapter - Reactive reference to the manuscript chapter to lay out.
 * @param surface - DOM ref for the reading surface used for page sizing.
 * @param options - Behavior overrides.
 */
export function useManuscriptLayout(
  book: MejiroBook | Ref<MejiroBook>,
  chapter: Ref<ManuscriptChapter | null>,
  surface: Ref<HTMLElement | null>,
  options: UseManuscriptLayoutOptions = {},
): UseManuscriptLayoutReturn {
  const enableResize = options.enableResize ?? true;
  const resizeDebounce = options.resizeDebounce ?? 120;

  const layout = shallowRef<ChapterLayout | null>(null);
  const pageWidth = shallowRef(0);
  const pageHeight = shallowRef(0);
  const contentHeight = shallowRef(0);
  const elapsedMs = shallowRef(0);
  let layoutRequestId = 0;

  async function recompute(opts: ManuscriptRecomputeOptions = {}): Promise<void> {
    const blank = opts.blank ?? true;
    const requestId = ++layoutRequestId;
    const current = chapter.value;
    if (!(current && surface.value)) {
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

    const currentBook = unref(book);
    const dims = currentBook.computePageSize(surface.value);
    pageWidth.value = dims.pageWidth;
    pageHeight.value = dims.pageHeight;
    contentHeight.value = dims.contentHeight;

    const dialect = unwrap(options.dialect) ?? 'mejiro';
    const t0 = performance.now();
    const layouts = await currentBook.layoutManuscript({ chapters: [current], dialect });
    if (requestId !== layoutRequestId) return;
    const nextLayout = layouts.values().next().value ?? null;
    layout.value = nextLayout;
    elapsedMs.value = performance.now() - t0;
    if (nextLayout && captured) options.restorePosition?.(nextLayout, captured);
  }

  watch([() => unref(book), chapter, surface], () => void recompute(), {
    immediate: true,
    flush: 'sync',
  });
  if (options.dialect && typeof options.dialect === 'object' && 'value' in options.dialect) {
    watch(options.dialect, () => void recompute());
  }

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
      // immediately so the very first layout is correct even if the preview
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
