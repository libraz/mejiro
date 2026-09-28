import type { ChapterLayout, InChapterAnchor, SpreadResult } from '@libraz/mejiro/book';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Options for {@link useSpread}. */
export interface UseSpreadOptions {
  /** Enable ArrowLeft/ArrowRight navigation. @defaultValue true */
  enableKeyboard?: boolean;
  /** Page-turn animation duration in ms. @defaultValue 180 */
  turnDuration?: number;
  /**
   * Show one page at a time: the navigation index then counts pages instead
   * of two-page spreads. Toggling it converts the index so the page on
   * screen stays visible. @defaultValue false
   */
  single?: boolean;
  /** Called when the spread index changes (after the turn animation midpoint). */
  onChange?: (spreadIdx: number) => void;
}

/** Return value of {@link useSpread}. */
export interface UseSpreadReturn {
  /** Current navigation index: a page index in single mode, a spread index otherwise. */
  spreadIdx: number;
  /** Layout spread holding the visible page(s), or `null` until the layout is ready. */
  spread: SpreadResult | null;
  /** First page shown, in reading order. */
  firstPage: number;
  /** Index of {@link UseSpreadReturn.spread} in the layout (`ChapterLayout.getSpread`). */
  layoutSpreadIdx: number;
  /** Side of {@link UseSpreadReturn.spread} shown in single mode; `null` in double mode. */
  singleSide: 'right' | 'left' | null;
  /** Total number of pages, as of {@link UseSpreadReturn.spread}. */
  totalPages: number;
  /** Number of navigation positions: pages in single mode, two-page spreads otherwise. */
  totalSpreads: number;
  /** Whether the turn animation is currently in flight. */
  turning: boolean;
  /** Advance one position (page or spread) forward. */
  next: () => void;
  /** Go back one position. */
  prev: () => void;
  /** Jump to an arbitrary navigation index (clamped). */
  goTo: (index: number) => void;
  /**
   * Set the navigation index immediately, with no page-turn animation, clamped
   * to `[0, totalSpreads − 1]`. Use to restore a reading position after a reflow
   * re-layout (where an animated {@link goTo} would briefly flash spread 0).
   */
  setSpread: (index: number) => void;
  /** Navigation index that shows the given page index. */
  indexOfPage: (pageIdx: number) => number;
  /** Anchor at the start of the first page shown at navigation index `index`, or `null`. */
  anchorAt: (index: number) => InChapterAnchor | null;
  /** Manually refresh `spread` from `layout` at the current index. */
  refresh: () => void;
}

/**
 * True when a global keydown must not be read as reader navigation: the host
 * already handled it, a modifier turns it into a different gesture, or it was
 * typed into an editable field (comment boxes, the bundled manuscript editor).
 */
function ignoreNavigationKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Number of navigation positions for `totalPages` pages. */
function navigationCount(totalPages: number, single: boolean): number {
  return Math.max(1, single ? totalPages : Math.ceil(totalPages / 2));
}

/** First page shown at navigation index `index`. */
function firstPageOf(index: number, single: boolean): number {
  return single ? index : index * 2;
}

/** Navigation index that shows page `pageIdx`. */
function indexOfPageIn(pageIdx: number, single: boolean): number {
  return single ? pageIdx : Math.floor(pageIdx / 2);
}

/**
 * React hook that tracks the current spread index for a chapter layout
 * and exposes navigation helpers with an optional page-turn animation.
 */
export function useSpread(
  layout: ChapterLayout | null,
  options: UseSpreadOptions = {},
): UseSpreadReturn {
  const enableKeyboard = options.enableKeyboard ?? true;
  const turnDuration = options.turnDuration ?? 180;
  const single = options.single ?? false;
  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;

  const [spreadIdx, setSpreadIdx] = useState(0);
  // Mode the stored index was counted in; a flip converts it before commit so
  // the page on screen stays visible.
  const [indexSingle, setIndexSingle] = useState(single);
  if (indexSingle !== single) {
    setIndexSingle(single);
    setSpreadIdx(indexOfPageIn(firstPageOf(spreadIdx, indexSingle), single));
  }
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [turning, setTurning] = useState(false);

  const layoutRef = useRef<ChapterLayout | null>(null);
  layoutRef.current = layout;
  const spreadIdxRef = useRef(0);
  spreadIdxRef.current = spreadIdx;
  const singleRef = useRef(single);
  singleRef.current = single;
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutGenerationRef = useRef(0);
  const lastEmittedRef = useRef<{ layout: ChapterLayout; spreadIdx: number } | null>(null);

  // Read from the spread on screen, not the layout: an option change re-breaks
  // the layout lazily, and a render before the replacement layout arrives must
  // not pay for that pass.
  const totalPages = spread?.totalPages ?? 0;
  const totalSpreads = navigationCount(totalPages, single);
  const firstPage = firstPageOf(spreadIdx, single);
  const layoutSpreadIdx = Math.floor(firstPage / 2);
  const singleSide = single ? (firstPage % 2 === 0 ? 'right' : 'left') : null;

  const refresh = useCallback(() => {
    if (!layoutRef.current) {
      setSpread(null);
      return;
    }
    const page = firstPageOf(spreadIdxRef.current, singleRef.current);
    setSpread(layoutRef.current.getSpread(Math.floor(page / 2)));
  }, []);

  // Reset before paint when layout changes so a stale spread from the previous
  // book/chapter can never be rendered under the new source.
  useLayoutEffect(() => {
    layoutGenerationRef.current++;
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    setTurning(false);
    setSpreadIdx(0);
    if (!layout) {
      setSpread(null);
      return;
    }
    setSpread(layout.getSpread(0));
  }, [layout]);

  // Refresh spread when the index changes.
  useEffect(() => {
    if (!layout) return;
    setSpread(layout.getSpread(layoutSpreadIdx));
    const last = lastEmittedRef.current;
    if (!last) {
      lastEmittedRef.current = { layout, spreadIdx };
      return;
    }
    if (last.spreadIdx !== spreadIdx) {
      onChangeRef.current?.(spreadIdx);
    }
    lastEmittedRef.current = { layout, spreadIdx };
  }, [layout, spreadIdx, layoutSpreadIdx]);

  const goTo = useCallback(
    (index: number) => {
      if (!layoutRef.current) return;
      const targetSingle = singleRef.current;
      const max = navigationCount(layoutRef.current.totalPages, targetSingle) - 1;
      const target = Math.max(0, Math.min(max, index));
      if (target === spreadIdxRef.current) return;
      if (turnDuration > 0) {
        const generation = layoutGenerationRef.current;
        if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
        setTurning(true);
        turnTimerRef.current = setTimeout(() => {
          if (generation !== layoutGenerationRef.current) return;
          // A mode flip during the turn re-counts the target in the new mode.
          setSpreadIdx(indexOfPageIn(firstPageOf(target, targetSingle), singleRef.current));
          setTurning(false);
          turnTimerRef.current = null;
        }, turnDuration);
      } else {
        setSpreadIdx(target);
      }
    },
    [turnDuration],
  );

  const setSpreadIndex = useCallback((index: number) => {
    if (!layoutRef.current) return;
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    setTurning(false);
    const max = navigationCount(layoutRef.current.totalPages, singleRef.current) - 1;
    setSpreadIdx(Math.max(0, Math.min(max, index)));
  }, []);

  const indexOfPage = useCallback((pageIdx: number) => indexOfPageIn(pageIdx, single), [single]);

  const anchorAt = useCallback(
    (index: number): InChapterAnchor | null => {
      if (!layout || index < 0 || index >= navigationCount(layout.totalPages, single)) return null;
      const page = firstPageOf(index, single);
      return layout.anchorAt(Math.floor(page / 2), page % 2 === 0 ? 'right' : 'left');
    },
    [layout, single],
  );

  const next = useCallback(() => goTo(spreadIdxRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(spreadIdxRef.current - 1), [goTo]);

  useEffect(() => {
    if (!enableKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (!layoutRef.current) return;
      if (ignoreNavigationKey(e)) return;
      if (e.key === 'ArrowLeft') next();
      else if (e.key === 'ArrowRight') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableKeyboard, next, prev]);

  useEffect(
    () => () => {
      if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    },
    [],
  );

  return {
    spreadIdx,
    spread,
    firstPage,
    layoutSpreadIdx,
    singleSide,
    totalPages,
    totalSpreads,
    turning,
    next,
    prev,
    goTo,
    setSpread: setSpreadIndex,
    indexOfPage,
    anchorAt,
    refresh,
  };
}
