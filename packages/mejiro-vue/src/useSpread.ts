import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import {
  type ComputedRef,
  computed,
  onMounted,
  onScopeDispose,
  onUnmounted,
  type Ref,
  ref,
  watch,
} from 'vue';

/** Options for {@link useSpread}. */
export interface UseSpreadOptions {
  /** Enable ArrowLeft/ArrowRight navigation while the layout is loaded. @defaultValue true */
  enableKeyboard?: boolean;
  /** Page-turn animation duration in ms. The transition is purely visual — content updates at the midpoint. @defaultValue 180 */
  turnDuration?: number;
  /** Called when the spread index changes (after the turn animation midpoint). */
  onChange?: (spreadIdx: number) => void;
}

/** Return value of {@link useSpread}. */
export interface UseSpreadReturn {
  /** Current spread index (0-based). */
  spreadIdx: Ref<number>;
  /** Current spread result, or `null` until the layout is ready. */
  spread: Ref<SpreadResult | null>;
  /** Total number of pages. */
  totalPages: ComputedRef<number>;
  /** Total number of two-page spreads. */
  totalSpreads: ComputedRef<number>;
  /** Whether the page-turn animation is currently in flight. */
  turning: Ref<boolean>;
  /** Advance one spread forward. */
  next: () => void;
  /** Go back one spread. */
  prev: () => void;
  /** Jump to an arbitrary spread index (clamped to [0, totalSpreads − 1]). */
  goTo: (index: number) => void;
  /**
   * Set the spread index immediately, with no page-turn animation, clamped to
   * `[0, totalSpreads − 1]`. Use to restore a reading position after a reflow
   * re-layout (where an animated {@link goTo} would briefly flash spread 0).
   */
  setSpread: (index: number) => void;
  /** Manually refresh `spread.value` from `layout` at the current index. */
  refresh: () => void;
}

/**
 * Vue composable that tracks the current spread index for a chapter layout
 * and provides navigation helpers with an optional page-turn animation.
 *
 * The `spread` ref is updated automatically when the layout or index changes.
 * Call {@link UseSpreadReturn.refresh} after mutating the layout (e.g. via
 * `setImages`) so subscribers see the new value without changing the index.
 */
export function useSpread(
  layout: Ref<ChapterLayout | null>,
  options: UseSpreadOptions = {},
): UseSpreadReturn {
  const enableKeyboard = options.enableKeyboard ?? true;
  const turnDuration = options.turnDuration ?? 180;

  const spreadIdx = ref(0);
  const spread = ref<SpreadResult | null>(null);
  const turning = ref(false);
  let turnTimer: ReturnType<typeof setTimeout> | null = null;
  let layoutGeneration = 0;

  const totalPages = computed(() => layout.value?.totalPages ?? 0);
  const totalSpreads = computed(() => Math.max(1, Math.ceil(totalPages.value / 2)));

  function refresh(): void {
    if (!layout.value) {
      spread.value = null;
      return;
    }
    spread.value = layout.value.getSpread(spreadIdx.value);
  }

  watch(
    layout,
    () => {
      layoutGeneration++;
      if (turnTimer) {
        clearTimeout(turnTimer);
        turnTimer = null;
      }
      turning.value = false;
      spreadIdx.value = 0;
      refresh();
    },
    { flush: 'sync' },
  );

  watch(spreadIdx, () => {
    refresh();
    options.onChange?.(spreadIdx.value);
  });

  function goTo(index: number): void {
    if (!layout.value) return;
    const max = totalSpreads.value - 1;
    const target = Math.max(0, Math.min(max, index));
    if (target === spreadIdx.value) return;
    if (turnDuration > 0) {
      const generation = layoutGeneration;
      if (turnTimer) clearTimeout(turnTimer);
      turning.value = true;
      turnTimer = setTimeout(() => {
        if (generation !== layoutGeneration) return;
        spreadIdx.value = target;
        turning.value = false;
        turnTimer = null;
      }, turnDuration);
    } else {
      spreadIdx.value = target;
    }
  }

  function setSpread(index: number): void {
    if (!layout.value) return;
    if (turnTimer) {
      clearTimeout(turnTimer);
      turnTimer = null;
    }
    turning.value = false;
    const max = totalSpreads.value - 1;
    spreadIdx.value = Math.max(0, Math.min(max, index));
  }

  function next(): void {
    goTo(spreadIdx.value + 1);
  }

  function prev(): void {
    goTo(spreadIdx.value - 1);
  }

  function onKey(e: KeyboardEvent): void {
    if (!layout.value) return;
    if (e.key === 'ArrowLeft') next();
    else if (e.key === 'ArrowRight') prev();
  }

  if (enableKeyboard) {
    onMounted(() => window.addEventListener('keydown', onKey));
    onUnmounted(() => {
      window.removeEventListener('keydown', onKey);
    });
  }

  onScopeDispose(() => {
    if (turnTimer) clearTimeout(turnTimer);
  });

  return {
    spreadIdx,
    spread,
    totalPages,
    totalSpreads,
    turning,
    next,
    prev,
    goTo,
    setSpread,
    refresh,
  };
}
