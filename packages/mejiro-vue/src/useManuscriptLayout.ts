import type { ManuscriptChapter } from '@libraz/mejiro';
import type { ChapterLayout, InChapterAnchor, MejiroBook } from '@libraz/mejiro/book';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
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
import { type ChapterLayoutRecomputeOptions, hasMeasurableBox } from './useChapterLayout.js';
import { createRequestToken } from './useRequestToken.js';

/** Options for {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutOptions {
  /**
   * The manuscript chapter to lay out, or `null` for none. A ref or getter is
   * followed, including in-place changes to its id, title or body.
   */
  chapter: MaybeRefOrGetter<ManuscriptChapter | null>;
  /**
   * The reading surface the page size is fitted to — usually a template ref.
   * Nothing is laid out while it is absent or measures zero (not attached, or
   * `display: none`); the first positive size its `ResizeObserver` reports
   * starts the layout.
   */
  surface: MaybeRefOrGetter<HTMLElement | null>;
  /** Manuscript notation dialect. A ref or getter is followed. @defaultValue `'mejiro'` */
  dialect?: MaybeRefOrGetter<ManuscriptDialect>;
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

/** Return value of {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutReturn {
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

/** Content key of a chapter: changes exactly when its id, title or body does. */
function chapterSignature(chapter: ManuscriptChapter | null): string | null {
  return chapter ? JSON.stringify([chapter.id, chapter.title, chapter.body]) : null;
}

/**
 * Vue composable that lays out a single manuscript chapter directly, skipping
 * the EPUB ZIP round-trip used by {@link useChapterLayout}.
 *
 * Intended for live preview in custom manuscript editors: pair with the
 * chapter array from your own draft store and feed the resulting
 * {@link ChapterLayout} into {@link MejiroSpread} or {@link MejiroScrollView}.
 *
 * Re-layouts whenever `book`, `dialect`, or the chapter's id, title or body
 * change — by replacing the chapter or by mutating it in place. The `surface`
 * element is observed with a {@link ResizeObserver}: the first observation runs
 * immediately (so a preview mounted before its container had a final box is
 * still sized correctly on first paint), and later size changes trigger a
 * debounced **full re-layout**. While the surface measures zero,
 * {@link MejiroBook.fitPageSize} is not called and nothing is laid out.
 *
 * Size changes lay the chapter out again rather than calling
 * `ChapterLayout.resize()`, so page geometry is re-derived from the surface.
 * The book reuses the paragraphs and line-breaking hints it already derived for
 * an unchanged chapter, so a reflow never re-runs the analyzer. Because each
 * re-layout yields a new {@link ChapterLayout} object (resetting any downstream
 * spread index to 0), the reading position is carried across reflows by
 * {@link UseManuscriptLayoutOptions.capturePosition},
 * {@link UseManuscriptLayoutOptions.restorePosition} and
 * {@link UseManuscriptLayoutReturn.pendingRestore}, identically in the React
 * hook.
 *
 * @param book - The book instance to lay out with. Pass a ref or getter to swap
 *   the book (e.g. a different typography profile) at runtime — the chapter is
 *   laid out again with the new instance.
 * @param options - The chapter, the surface and behavior overrides.
 */
export function useManuscriptLayout(
  book: MaybeRefOrGetter<MejiroBook>,
  options: UseManuscriptLayoutOptions,
): UseManuscriptLayoutReturn {
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

  async function recompute(opts: ChapterLayoutRecomputeOptions = {}): Promise<void> {
    const blank = opts.blank ?? true;
    const token = request.begin();
    const current = toValue(options.chapter);
    const el = toValue(options.surface);
    error.value = null;
    if (!(current && el)) {
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
      await layOut(token, blank, current, el);
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
    current: ManuscriptChapter,
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
    const geometry = currentBook.fitPageSize(el);
    pageWidth.value = geometry.pageWidth;
    pageHeight.value = geometry.pageHeight;
    contentHeight.value = geometry.contentHeight;

    const dialect = toValue(options.dialect) ?? 'mejiro';
    const t0 = performance.now();
    const [laidOut = null] = await currentBook.layoutManuscript({
      chapters: [toRaw(current)],
      dialect,
    });
    const nextLayout = laidOut && markRaw(laidOut);
    if (!request.isCurrent(token)) return;
    layout.value = nextLayout;
    elapsedMs.value = performance.now() - t0;
    if (nextLayout && captured && options.restorePosition) {
      pendingRestore.value = null;
      options.restorePosition(nextLayout, captured);
    }
  }

  watch(
    [
      () => toValue(book),
      () => chapterSignature(toValue(options.chapter)),
      () => toValue(options.surface),
      () => toValue(options.dialect),
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
      // immediately so the very first layout is correct even if the preview
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
