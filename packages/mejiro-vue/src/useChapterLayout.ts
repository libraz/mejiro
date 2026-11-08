import type {
  ChapterLayout,
  FitPageSizeOptions,
  InChapterAnchor,
  MejiroBook,
} from '@libraz/mejiro/book';
import type { EpubBook, EpubChapter } from '@libraz/mejiro/epub';
import {
  type MaybeRefOrGetter,
  markRaw,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toRaw,
  toValue,
  watch,
} from 'vue';
import { toError } from './errors.js';
import { createRequestToken } from './useRequestToken.js';

/** Options for {@link useChapterLayout}. */
export interface UseChapterLayoutOptions {
  /** The parsed EPUB to lay out a chapter of. A ref or getter is followed. */
  epub: MaybeRefOrGetter<EpubBook | null>;
  /** Zero-based index of the chapter to lay out. A ref or getter is followed. */
  chapterIndex: MaybeRefOrGetter<number>;
  /**
   * The reading surface the page size is fitted to — usually a template ref.
   * Nothing is laid out while it is absent or measures zero (not attached, or
   * `display: none`); the first positive size its `ResizeObserver` reports
   * starts the layout.
   */
  surface: MaybeRefOrGetter<HTMLElement | null>;
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
  resizeDebounceMs?: number;
  /**
   * Page-geometry overrides forwarded to {@link MejiroBook.fitPageSize} — e.g.
   * to shrink the reserved `gutterOffset` / `headerOffset` so the pages fill
   * their frame. Read on every (re)layout; a change alone does not re-flow.
   */
  pageGeometry?: MaybeRefOrGetter<FitPageSizeOptions | undefined>;
  /**
   * Capture the reading position from the outgoing layout, just before a
   * **reflow** (non-blank) re-layout replaces it. The anchor is held in
   * `pendingRestore` until the new layout is in place, then handed to
   * `restorePosition` when one is given. Return `null` to skip preservation.
   * Never called for blank (content-change) re-layouts, which start at spread 0.
   */
  capturePosition?: (layout: ChapterLayout) => InChapterAnchor | null;
  /**
   * Apply an anchor captured by `capturePosition` to the new layout, e.g. by
   * locating it and jumping to its spread. Called once the new layout is in
   * place — after it commits, before paint — and `pendingRestore` is cleared
   * first. Without it, consume `pendingRestore` yourself.
   */
  restorePosition?: (layout: ChapterLayout, position: InChapterAnchor) => void;
  /**
   * Called once when a layout of the current source fails, whichever path
   * started it (source change, resize or `recompute`); a superseded layout
   * reports nothing. The failure also lands in `error`. When supplied,
   * `recompute` resolves instead of rejecting. A `MejiroError` arrives as
   * thrown.
   */
  onError?: (error: Error) => void;
}

/** Options for the `recompute` of {@link useChapterLayout} and {@link useManuscriptLayout}. */
export interface ChapterLayoutRecomputeOptions {
  /**
   * Blank the current layout while the new one is computed. Use for content
   * changes (chapter / book swaps); skip for size or option changes so the
   * previous spread stays visible until the re-flow completes (no flicker).
   * @defaultValue true
   */
  blank?: boolean;
}

/** Return value of {@link useChapterLayout}. */
export interface UseChapterLayoutReturn {
  /** Current {@link ChapterLayout}, or `null` before the first computation. */
  layout: Readonly<Ref<ChapterLayout | null>>;
  /** Page width in pixels, as {@link MejiroBook.fitPageSize} measured it; `0` before the first fit. */
  pageWidth: Readonly<Ref<number>>;
  /** Page height in pixels; `0` before the first fit. */
  pageHeight: Readonly<Ref<number>>;
  /** Height of the text area inside a page, in pixels; `0` before the first fit. */
  contentHeight: Readonly<Ref<number>>;
  /** Elapsed layout time in milliseconds for the most recent computation. */
  elapsedMs: Readonly<Ref<number>>;
  /**
   * Failure of the most recent layout of the current source, or `null`. Set
   * whichever path started the layout; cleared when the next one starts.
   */
  error: Readonly<Ref<Error | null>>;
  /**
   * Force a fresh layout computation. A failure goes to `onError` when one is
   * supplied; otherwise the returned promise rejects.
   */
  recompute: (options?: ChapterLayoutRecomputeOptions) => Promise<void>;
  /**
   * Anchor captured by `capturePosition` before the most recent reflow,
   * awaiting restoration into the new layout. `restorePosition`, when given,
   * consumes it; otherwise read it once the new layout is in place and set it
   * back to `null`.
   */
  pendingRestore: Ref<InChapterAnchor | null>;
}

/** Whether `el` has a box a page size can be fitted to. */
export function hasMeasurableBox(el: HTMLElement): boolean {
  return el.clientWidth > 0 && el.clientHeight > 0;
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
 * While the surface measures zero, {@link MejiroBook.fitPageSize} is not called
 * and nothing is laid out.
 *
 * Size and option changes lay the chapter out again rather than calling
 * `ChapterLayout.resize()`, so page geometry is re-derived from the surface and
 * the book's current options. The book replays the line-breaking hints it
 * already derived for the chapter, so a reflow never re-runs the analyzer.
 * Because each re-layout yields a new {@link ChapterLayout} object (resetting
 * any downstream spread index to 0), the reading position is carried across
 * reflows by {@link UseChapterLayoutOptions.capturePosition},
 * {@link UseChapterLayoutOptions.restorePosition} and
 * {@link UseChapterLayoutReturn.pendingRestore}, identically in the React hook.
 *
 * @param book - The book instance to lay out with. Pass a ref or getter to swap
 *   the book (e.g. a different typography profile) at runtime — the chapter is
 *   laid out again with the new instance.
 * @param options - The chapter source, the surface and behavior overrides.
 */
export function useChapterLayout(
  book: MaybeRefOrGetter<MejiroBook>,
  options: UseChapterLayoutOptions,
): UseChapterLayoutReturn {
  const enableResize = options.enableResize ?? true;
  const resizeDebounceMs = options.resizeDebounceMs ?? 120;

  const layout = shallowRef<ChapterLayout | null>(null);
  const pageWidth = shallowRef(0);
  const pageHeight = shallowRef(0);
  const contentHeight = shallowRef(0);
  const elapsedMs = shallowRef(0);
  const error = shallowRef<Error | null>(null);
  const pendingRestore = shallowRef<InChapterAnchor | null>(null);
  const request = createRequestToken();
  // Client box the page size was last computed from; an observation reporting
  // the same box needs no re-layout.
  let measuredBox: { width: number; height: number } | null = null;

  function currentChapter(): EpubChapter | null {
    return toValue(options.epub)?.chapters[toValue(options.chapterIndex)] ?? null;
  }

  async function recompute(opts: ChapterLayoutRecomputeOptions = {}): Promise<void> {
    const blank = opts.blank ?? true;
    const token = request.begin();
    const chapter = currentChapter();
    const el = toValue(options.surface);
    error.value = null;
    if (!(chapter && el)) {
      measuredBox = null;
      layout.value = null;
      pageWidth.value = 0;
      pageHeight.value = 0;
      contentHeight.value = 0;
      elapsedMs.value = 0;
      return;
    }
    if (!hasMeasurableBox(el)) {
      // Wait for the observer to report a real box.
      measuredBox = null;
      if (blank) layout.value = null;
      return;
    }
    try {
      await layOut(token, blank, chapter, el);
    } catch (err) {
      if (!request.isCurrent(token)) return;
      error.value = toError(err);
      if (!options.onError) throw err;
      options.onError(error.value);
    }
  }

  /** Starts a re-layout nobody awaits; a failure is `error`'s and `onError`'s alone. */
  function trigger(opts?: ChapterLayoutRecomputeOptions): void {
    recompute(opts).catch(() => {});
  }

  async function layOut(
    token: number,
    blank: boolean,
    chapter: EpubChapter,
    el: HTMLElement,
  ): Promise<void> {
    // Capture the reading position before a reflow swaps in a new layout, so we
    // can restore it afterwards (a new layout object resets the spread index).
    const captured =
      !blank && layout.value ? (options.capturePosition?.(layout.value) ?? null) : null;
    pendingRestore.value = captured;

    if (blank) layout.value = null;

    const currentBook = toRaw(toValue(book));
    measuredBox = { width: el.clientWidth, height: el.clientHeight };
    const geometry = currentBook.fitPageSize(el, toRaw(toValue(options.pageGeometry)));
    pageWidth.value = geometry.pageWidth;
    pageHeight.value = geometry.pageHeight;
    contentHeight.value = geometry.contentHeight;

    const t0 = performance.now();
    const nextLayout = markRaw(await currentBook.layoutChapter(toRaw(chapter)));
    if (!request.isCurrent(token)) return;
    layout.value = nextLayout;
    elapsedMs.value = performance.now() - t0;
    if (captured && options.restorePosition) {
      pendingRestore.value = null;
      options.restorePosition(nextLayout, captured);
    }
  }

  watch(
    [
      () => toValue(book),
      () => toValue(options.epub),
      () => toValue(options.chapterIndex),
      () => toValue(options.surface),
    ],
    () => trigger(),
    { immediate: true, flush: 'sync' },
  );

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
      trigger({ blank: false });
      return;
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      trigger({ blank: false });
    }, resizeDebounceMs);
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
      if (
        measuredBox &&
        measuredBox.width === el.clientWidth &&
        measuredBox.height === el.clientHeight
      ) {
        clearTimer();
        return;
      }
      // A box that still measures zero has nothing to fit; wait for the next report.
      if (!hasMeasurableBox(el)) return;
      // The first real box after a zero one lays out at once.
      scheduleReflow(immediate || measuredBox === null);
    });
    observer.observe(el);
  }

  if (enableResize) {
    watch(() => toValue(options.surface), observeSurface, { immediate: true });

    // Fallback for environments without ResizeObserver (e.g. very old browsers).
    if (typeof ResizeObserver === 'undefined' && typeof window !== 'undefined') {
      const onWindowResize = (): void => scheduleReflow(false);
      window.addEventListener('resize', onWindowResize);
      onScopeDispose(() => window.removeEventListener('resize', onWindowResize));
    }
  }

  onScopeDispose(() => {
    disconnect();
    clearTimer();
  });

  return {
    layout: shallowReadonly(layout),
    pageWidth: shallowReadonly(pageWidth),
    pageHeight: shallowReadonly(pageHeight),
    contentHeight: shallowReadonly(contentHeight),
    elapsedMs: shallowReadonly(elapsedMs),
    error: shallowReadonly(error),
    recompute,
    pendingRestore,
  };
}
