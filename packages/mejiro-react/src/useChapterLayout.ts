import type {
  ChapterLayout,
  ComputePageSizeOptions,
  InChapterAnchor,
  MejiroBook,
} from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { type MutableRefObject, type RefObject, useMemo, useRef } from 'react';
import { type SurfaceLayoutSource, useSurfaceLayout } from './useSurfaceLayout.js';

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
   * reports nothing. When supplied, `recompute` resolves instead of rejecting.
   */
  onError?: (error: Error) => void;
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
  /** Width of one page, in CSS pixels. */
  pageWidth: number;
  /** Height of one page, in CSS pixels. */
  pageHeight: number;
  /** Height of the text area inside a page, in CSS pixels. */
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
  /**
   * Force a fresh layout computation. A failure goes to `onError` when one is
   * supplied; otherwise the returned promise rejects.
   */
  recompute: (opts?: RecomputeOptions) => Promise<void>;
  /**
   * Anchor captured by `capturePosition` before the most recent reflow,
   * awaiting restoration into the new layout. `restorePosition`, when given,
   * consumes it; otherwise read it once the new layout is in place and set it
   * back to `null`.
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
 * Size and option changes lay the chapter out again rather than calling
 * `ChapterLayout.resize()`, so page geometry is re-derived from the surface and
 * the book's current options. The book replays the line-breaking hints it
 * already derived for the chapter, so a reflow never re-runs the analyzer.
 * Because each re-layout yields a new {@link ChapterLayout} object (resetting
 * any downstream spread index to 0), the reading position is carried across
 * reflows by {@link UseChapterLayoutOptions.capturePosition},
 * {@link UseChapterLayoutOptions.restorePosition} and
 * {@link UseChapterLayoutReturn.pendingRestore}, identically in the Vue
 * composable.
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
  // Latest options, so the source stays stable while `pageGeometry` changes identity.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const source = useMemo<SurfaceLayoutSource | null>(() => {
    const chapter = epub?.chapters[chapterIndex];
    if (!chapter) return null;
    return {
      measure: (el) => book.computePageSize(el, optionsRef.current.pageGeometry?.()),
      layout: () => book.layoutChapter(chapter),
    };
  }, [book, epub, chapterIndex]);

  return useSurfaceLayout(source, surface, {
    ...options,
    enableResize: options.enableResize ?? true,
    resizeDebounce: options.resizeDebounce ?? 120,
  });
}
