import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { onMounted, onUnmounted, type Ref, shallowRef, watch } from 'vue';

/** Options for {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: Ref<ManuscriptDialect> | ManuscriptDialect;
  /** Whether to listen for `window.resize` and re-flow on resize. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) applied to resize-triggered re-flows. @defaultValue 120 */
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
  recompute: () => Promise<void>;
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
 * Re-layouts whenever `book`, `chapter`, or `dialect` change.
 *
 * @param book - The book instance to lay out with.
 * @param chapter - Reactive reference to the manuscript chapter to lay out.
 * @param surface - DOM ref for the reading surface used for page sizing.
 * @param options - Behavior overrides.
 */
export function useManuscriptLayout(
  book: MejiroBook,
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

  async function recompute(): Promise<void> {
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

    layout.value = null;

    const dims = book.computePageSize(surface.value);
    pageWidth.value = dims.pageWidth;
    pageHeight.value = dims.pageHeight;
    contentHeight.value = dims.contentHeight;

    const dialect = unwrap(options.dialect) ?? 'mejiro';
    const t0 = performance.now();
    const layouts = await book.layoutManuscript({ chapters: [current], dialect });
    if (requestId !== layoutRequestId) return;
    layout.value = layouts.values().next().value ?? null;
    elapsedMs.value = performance.now() - t0;
  }

  watch([chapter, surface], () => void recompute(), { immediate: true, flush: 'sync' });
  if (options.dialect && typeof options.dialect === 'object' && 'value' in options.dialect) {
    watch(options.dialect, () => void recompute());
  }

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  function onResize(): void {
    if (!(surface.value && layout.value)) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!(surface.value && layout.value)) return;
      const dims = book.computePageSize(surface.value);
      pageWidth.value = dims.pageWidth;
      pageHeight.value = dims.pageHeight;
      contentHeight.value = dims.contentHeight;
      layout.value.resize({
        pageWidth: dims.pageWidth,
        lineWidth: dims.contentHeight - book.getOptions().fontSize * 0.5,
      });
    }, resizeDebounce);
  }

  if (enableResize) {
    onMounted(() => window.addEventListener('resize', onResize));
    onUnmounted(() => {
      window.removeEventListener('resize', onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    });
  }

  return { layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute };
}
