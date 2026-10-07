import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
} from '@libraz/mejiro/book';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { type MutableRefObject, type RefObject, useMemo } from 'react';
import { type SurfaceLayoutSource, useSurfaceLayout } from './useSurfaceLayout.js';

/** Options for {@link useManuscriptLayout}. */
export interface UseManuscriptLayoutOptions {
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /** Observe the surface element for size changes and re-flow. @defaultValue true */
  enableResize?: boolean;
  /** Debounce window (ms) applied to size-triggered re-flows. @defaultValue 120 */
  resizeDebounce?: number;
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
  /** Width of one page, in CSS pixels. */
  pageWidth: number;
  /** Height of one page, in CSS pixels. */
  pageHeight: number;
  /** Height of the text area inside a page, in CSS pixels. */
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
  /**
   * Force a fresh layout computation. A failure goes to `onError` when one is
   * supplied; otherwise the returned promise rejects.
   */
  recompute: (opts?: ManuscriptRecomputeOptions) => Promise<void>;
  /**
   * Anchor captured by `capturePosition` before the most recent reflow,
   * awaiting restoration into the new layout. `restorePosition`, when given,
   * consumes it; otherwise read it once the new layout is in place and set it
   * back to `null`.
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
 * {@link UseManuscriptLayoutOptions.capturePosition},
 * {@link UseManuscriptLayoutOptions.restorePosition} and
 * {@link UseManuscriptLayoutReturn.pendingRestore}, identically in the Vue
 * composable.
 */
export function useManuscriptLayout(
  book: MejiroBook,
  chapter: ManuscriptChapter | null,
  surface: RefObject<HTMLElement | null>,
  options: UseManuscriptLayoutOptions = {},
): UseManuscriptLayoutReturn {
  const dialect = options.dialect ?? 'mejiro';

  const source = useMemo<SurfaceLayoutSource | null>(() => {
    if (!chapter) return null;
    return {
      measure: (el) => book.computePageSize(el),
      layout: async () => {
        const layouts = await book.layoutManuscript({ chapters: [chapter], dialect });
        return layouts.values().next().value ?? null;
      },
    };
  }, [book, chapter, dialect]);

  return useSurfaceLayout(source, surface, {
    ...options,
    enableResize: options.enableResize ?? true,
    resizeDebounce: options.resizeDebounce ?? 120,
  });
}
