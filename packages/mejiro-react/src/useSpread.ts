import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Options for {@link useSpread}. */
export interface UseSpreadOptions {
  /** Enable ArrowLeft/ArrowRight navigation. @defaultValue true */
  enableKeyboard?: boolean;
  /** Page-turn animation duration in ms. @defaultValue 180 */
  turnDuration?: number;
  /** Called when the spread index changes (after the turn animation midpoint). */
  onChange?: (spreadIdx: number) => void;
}

/** Return value of {@link useSpread}. */
export interface UseSpreadReturn {
  /** Current spread index. */
  spreadIdx: number;
  /** Current spread result, or `null` until the layout is ready. */
  spread: SpreadResult | null;
  /** Total number of pages. */
  totalPages: number;
  /** Total number of two-page spreads. */
  totalSpreads: number;
  /** Whether the turn animation is currently in flight. */
  turning: boolean;
  /** Advance one spread forward. */
  next: () => void;
  /** Go back one spread. */
  prev: () => void;
  /** Jump to an arbitrary spread index (clamped). */
  goTo: (index: number) => void;
  /** Manually refresh `spread` from `layout` at the current index. */
  refresh: () => void;
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
  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;

  const [spreadIdx, setSpreadIdx] = useState(0);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [turning, setTurning] = useState(false);

  const layoutRef = useRef<ChapterLayout | null>(null);
  layoutRef.current = layout;
  const spreadIdxRef = useRef(0);
  spreadIdxRef.current = spreadIdx;
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutGenerationRef = useRef(0);

  const totalPages = layout?.totalPages ?? 0;
  const totalSpreads = Math.max(1, Math.ceil(totalPages / 2));

  const refresh = useCallback(() => {
    if (!layoutRef.current) {
      setSpread(null);
      return;
    }
    setSpread(layoutRef.current.getSpread(spreadIdxRef.current));
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
    setSpread(layout.getSpread(spreadIdx));
    onChangeRef.current?.(spreadIdx);
  }, [layout, spreadIdx]);

  const goTo = useCallback(
    (index: number) => {
      if (!layoutRef.current) return;
      const max = Math.max(1, Math.ceil(layoutRef.current.totalPages / 2)) - 1;
      const target = Math.max(0, Math.min(max, index));
      if (target === spreadIdxRef.current) return;
      if (turnDuration > 0) {
        const generation = layoutGenerationRef.current;
        if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
        setTurning(true);
        turnTimerRef.current = setTimeout(() => {
          if (generation !== layoutGenerationRef.current) return;
          setSpreadIdx(target);
          setTurning(false);
          turnTimerRef.current = null;
        }, turnDuration);
      } else {
        setSpreadIdx(target);
      }
    },
    [turnDuration],
  );

  const next = useCallback(() => goTo(spreadIdxRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(spreadIdxRef.current - 1), [goTo]);

  useEffect(() => {
    if (!enableKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (!layoutRef.current) return;
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

  return { spreadIdx, spread, totalPages, totalSpreads, turning, next, prev, goTo, refresh };
}
