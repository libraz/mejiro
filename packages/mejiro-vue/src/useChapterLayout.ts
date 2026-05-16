import type { ChapterLayout, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook, EpubChapter } from '@libraz/mejiro/epub';
import { onMounted, onUnmounted, type Ref, shallowRef, watch } from 'vue';

/** Options for {@link useChapterLayout}. */
export interface UseChapterLayoutOptions {
  /** Whether to listen for `window.resize` and re-flow on resize. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) applied to resize-triggered re-flows. @defaultValue 120 */
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

/**
 * Vue composable that lays out the currently-selected chapter and re-flows on resize.
 *
 * Whenever `book`, `epub`, or `chapterIndex` change, the chapter is laid out
 * against the dimensions of `surface`. When `window` resizes, page dimensions
 * are recomputed and the layout is re-flowed (without a full re-layout) via
 * {@link ChapterLayout.resize}.
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

  async function recompute(): Promise<void> {
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

    layout.value = null;

    const dims = book.computePageSize(surface.value);
    pageWidth.value = dims.pageWidth;
    pageHeight.value = dims.pageHeight;
    contentHeight.value = dims.contentHeight;

    const t0 = performance.now();
    const nextLayout = await book.layoutChapter(chapter);
    if (requestId !== layoutRequestId) return;
    layout.value = nextLayout;
    elapsedMs.value = performance.now() - t0;
  }

  watch([epub, chapterIndex, surface], () => void recompute(), { immediate: true, flush: 'sync' });

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
        // Same formula as verticalLineWidth — keeps line height consistent on resize.
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
