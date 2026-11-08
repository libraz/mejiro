import type { ChapterLayout, InChapterAnchor, SpreadResult } from '@libraz/mejiro/book';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Spread mode a view renders in once `'auto'` has been decided: one page at a
 * time, or two-page spreads.
 */
export type ResolvedSpreadMode = 'single' | 'double';

/** Options for {@link UseSpreadReturn.goTo}. */
export interface GoToOptions {
  /**
   * Run the page-turn animation. With `false` the index changes immediately,
   * cancelling any turn in flight — use it to restore a position after a
   * re-layout, where an animated turn would briefly show the first spread.
   * @defaultValue true
   */
  animate?: boolean;
}

/** Options for {@link useSpread}. */
export interface UseSpreadOptions {
  /** Enable ArrowLeft/ArrowRight navigation. @defaultValue true */
  enableKeyboard?: boolean;
  /** Page-turn animation duration in milliseconds; `0` turns without animating. @defaultValue 180 */
  turnDurationMs?: number;
  /**
   * Spread mode to navigate in. In `'single'` the navigation index counts
   * pages; in `'double'` it counts two-page spreads. Changing it converts the
   * index so the page on screen stays visible. @defaultValue 'double'
   */
  spreadMode?: ResolvedSpreadMode;
  /**
   * Keep the visible text on screen when `layout` is replaced: the new layout
   * opens at the position holding the first text the old one showed, instead
   * of at index 0. @defaultValue false
   */
  preservePosition?: boolean;
  /**
   * Called with the new navigation index after it changes: when an animated
   * turn lands, at the end of {@link UseSpreadOptions.turnDurationMs}, or
   * immediately for a turn without animation. Not called while a turn is in
   * flight, and not called when a turn ends where it started.
   */
  onIndexChange?: (index: number) => void;
}

/** Return value of {@link useSpread}. */
export interface UseSpreadReturn {
  /** Navigation index: a page index in single mode, a spread index otherwise. `0` without a layout. */
  index: number;
  /** Number of navigation positions: pages in single mode, spreads otherwise. `0` without a layout. */
  count: number;
  /** Index of the layout spread holding the visible page(s), as `ChapterLayout.getSpread` takes it. */
  spreadIndex: number;
  /** Number of spreads in the layout, whatever the spread mode. */
  spreadCount: number;
  /** Number of pages in the layout, as of {@link UseSpreadReturn.spread}. */
  pageCount: number;
  /** Layout spread holding the visible page(s), or `null` until the layout is ready. */
  spread: SpreadResult | null;
  /** Index of the first page shown, in reading order. */
  firstPage: number;
  /** Side of {@link UseSpreadReturn.spread} shown in single mode; `null` in double mode. */
  singleSide: 'right' | 'left' | null;
  /** Whether a page-turn animation is in flight. */
  turning: boolean;
  /** Move one position forward, counting from the target of a turn in flight. */
  next: () => void;
  /** Move one position back, counting from the target of a turn in flight. */
  prev: () => void;
  /**
   * Go to a navigation index. Negative values go to `0` and values past the
   * end to `count − 1`. A call during a turn replaces that turn's target, so
   * the turn lands on the last index requested. A no-op without a layout or
   * when `count` is `0`.
   *
   * @throws RangeError when `index` is not an integer (fractions, `NaN`, `±Infinity`).
   */
  goTo: (index: number, options?: GoToOptions) => void;
  /** Navigation index that shows the given page. */
  indexOfPage: (pageIndex: number) => number;
  /**
   * Anchor at the start of the text shown at navigation index `index`. A page an
   * image blocks entirely holds no text, so the anchor then comes from the next
   * page that does, even past `index`; `null` when no page from there on holds text.
   */
  anchorAt: (index: number) => InChapterAnchor | null;
  /** Re-read {@link UseSpreadReturn.spread} from `layout` at the current index. */
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

/** Number of navigation positions for `pageCount` pages. */
function navigationCount(pageCount: number, single: boolean): number {
  return single ? pageCount : Math.ceil(pageCount / 2);
}

/** First page shown at navigation index `index`. */
function firstPageOf(index: number, single: boolean): number {
  return single ? index : index * 2;
}

/** Navigation index that shows page `pageIndex`. */
function indexOfPageIn(pageIndex: number, single: boolean): number {
  return single ? pageIndex : Math.floor(pageIndex / 2);
}

/**
 * Anchor at the first text shown on page `page` or, when that page holds none
 * (an image blocks it entirely), on the nearest later page that does.
 */
function firstTextAnchorFrom(layout: ChapterLayout, page: number): InChapterAnchor | null {
  for (let p = page; p < layout.pageCount; p++) {
    const anchor = layout.anchorAt(Math.floor(p / 2), { side: p % 2 === 0 ? 'right' : 'left' });
    if (anchor) return anchor;
  }
  return null;
}

/**
 * Navigation index at which `next` shows the text `previous` showed at
 * `index`, or `0` when that text cannot be found in `next`.
 */
function preservedIndex(
  previous: ChapterLayout,
  next: ChapterLayout,
  index: number,
  single: boolean,
): number {
  const anchor = firstTextAnchorFrom(previous, firstPageOf(index, single));
  const located = anchor ? next.locateAnchor(anchor) : null;
  if (!located) return 0;
  const max = navigationCount(next.pageCount, single) - 1;
  return Math.max(0, Math.min(max, indexOfPageIn(located.pageIndex, single)));
}

/**
 * React hook that tracks the navigation position in a chapter layout and
 * exposes navigation helpers with an optional page-turn animation.
 *
 * @param layout - Chapter layout to navigate, or `null` while none is ready.
 * @param options - Spread mode, animation, keyboard and change notification.
 * @returns The navigation state and helpers.
 */
export function useSpread(
  layout: ChapterLayout | null,
  options: UseSpreadOptions = {},
): UseSpreadReturn {
  const enableKeyboard = options.enableKeyboard ?? true;
  const turnDurationMs = options.turnDurationMs ?? 180;
  const single = (options.spreadMode ?? 'double') === 'single';
  const onIndexChangeRef = useRef(options.onIndexChange);
  onIndexChangeRef.current = options.onIndexChange;
  const preservePositionRef = useRef(options.preservePosition ?? false);
  preservePositionRef.current = options.preservePosition ?? false;

  const [index, setIndex] = useState(0);
  // Mode the stored index was counted in; a flip converts it before commit so
  // the page on screen stays visible.
  const [indexSingle, setIndexSingle] = useState(single);
  if (indexSingle !== single) {
    setIndexSingle(single);
    setIndex(indexOfPageIn(firstPageOf(index, indexSingle), single));
  }
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [turning, setTurning] = useState(false);

  const layoutRef = useRef<ChapterLayout | null>(null);
  layoutRef.current = layout;
  const indexRef = useRef(0);
  indexRef.current = index;
  const singleRef = useRef(single);
  singleRef.current = single;
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Target of the turn in flight and the mode it was counted in.
  const turnTargetRef = useRef<{ index: number; single: boolean } | null>(null);
  const layoutGenerationRef = useRef(0);
  const lastEmittedRef = useRef<{ layout: ChapterLayout; index: number } | null>(null);
  const previousLayoutRef = useRef<ChapterLayout | null>(null);

  // Read from the spread on screen, not the layout: an option change re-breaks
  // the layout lazily, and a render before the replacement layout arrives must
  // not pay for that pass.
  const pageCount = spread?.pageCount ?? 0;
  const spreadCount = Math.ceil(pageCount / 2);
  const count = navigationCount(pageCount, single);
  const firstPage = firstPageOf(index, single);
  const spreadIndex = Math.floor(firstPage / 2);
  const singleSide = single ? (firstPage % 2 === 0 ? 'right' : 'left') : null;

  const refresh = useCallback(() => {
    if (!layoutRef.current) {
      setSpread(null);
      return;
    }
    const page = firstPageOf(indexRef.current, singleRef.current);
    setSpread(layoutRef.current.getSpread(Math.floor(page / 2)));
  }, []);

  const cancelTurn = useCallback(() => {
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    turnTargetRef.current = null;
    setTurning(false);
  }, []);

  // Reset before paint when layout changes so a stale spread from the previous
  // book/chapter can never be rendered under the new source.
  useLayoutEffect(() => {
    const previous = previousLayoutRef.current;
    previousLayoutRef.current = layout;
    layoutGenerationRef.current++;
    cancelTurn();
    if (!layout) {
      setIndex(0);
      setSpread(null);
      return;
    }
    const start =
      preservePositionRef.current && previous
        ? preservedIndex(previous, layout, indexRef.current, singleRef.current)
        : 0;
    indexRef.current = start;
    setIndex(start);
    setSpread(layout.getSpread(Math.floor(firstPageOf(start, singleRef.current) / 2)));
  }, [layout, cancelTurn]);

  // Refresh spread when the index changes.
  useEffect(() => {
    if (!layout) return;
    setSpread(layout.getSpread(spreadIndex));
    const last = lastEmittedRef.current;
    lastEmittedRef.current = { layout, index };
    if (last && last.index !== index) onIndexChangeRef.current?.(index);
  }, [layout, index, spreadIndex]);

  /** Target of the turn in flight in the current mode, else the current index. */
  const navigationTarget = useCallback((): number => {
    const pending = turnTargetRef.current;
    if (!pending) return indexRef.current;
    // A mode flip during the turn re-counts the target in the new mode.
    return indexOfPageIn(firstPageOf(pending.index, pending.single), singleRef.current);
  }, []);

  const goTo = useCallback(
    (requested: number, goToOptions: GoToOptions = {}) => {
      if (!Number.isInteger(requested)) {
        throw new RangeError(`goTo index must be an integer; got ${requested}`);
      }
      const lo = layoutRef.current;
      if (!lo) return;
      const targetSingle = singleRef.current;
      const max = navigationCount(lo.pageCount, targetSingle) - 1;
      if (max < 0) return;
      const target = Math.max(0, Math.min(max, requested));
      if (goToOptions.animate === false || turnDurationMs <= 0) {
        cancelTurn();
        indexRef.current = target;
        setIndex(target);
        return;
      }
      if (turnTimerRef.current) {
        // The turn in flight lands on the latest request instead.
        turnTargetRef.current = { index: target, single: targetSingle };
        return;
      }
      if (target === indexRef.current) return;
      const generation = layoutGenerationRef.current;
      turnTargetRef.current = { index: target, single: targetSingle };
      setTurning(true);
      turnTimerRef.current = setTimeout(() => {
        if (generation !== layoutGenerationRef.current) return;
        const landed = navigationTarget();
        indexRef.current = landed;
        setIndex(landed);
        setTurning(false);
        turnTargetRef.current = null;
        turnTimerRef.current = null;
      }, turnDurationMs);
    },
    [turnDurationMs, navigationTarget, cancelTurn],
  );

  const indexOfPage = useCallback(
    (pageIndex: number) => indexOfPageIn(pageIndex, single),
    [single],
  );

  const anchorAt = useCallback(
    (at: number): InChapterAnchor | null => {
      if (!layout || at < 0 || at >= navigationCount(layout.pageCount, single)) return null;
      return firstTextAnchorFrom(layout, firstPageOf(at, single));
    },
    [layout, single],
  );

  // Step from the turn in flight, so each call moves exactly one position.
  const next = useCallback(() => goTo(navigationTarget() + 1), [goTo, navigationTarget]);
  const prev = useCallback(() => goTo(navigationTarget() - 1), [goTo, navigationTarget]);

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
    index,
    count,
    spreadIndex,
    spreadCount,
    pageCount,
    spread,
    firstPage,
    singleSide,
    turning,
    next,
    prev,
    goTo,
    indexOfPage,
    anchorAt,
    refresh,
  };
}
