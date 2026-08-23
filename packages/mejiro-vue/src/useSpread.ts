import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import {
  type ComputedRef,
  computed,
  type MaybeRefOrGetter,
  onMounted,
  onScopeDispose,
  onUnmounted,
  type Ref,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue';

/** Options for {@link useSpread}. */
export interface UseSpreadOptions {
  /**
   * Enable ArrowLeft/ArrowRight navigation while the layout is loaded. Pass a
   * ref or getter to switch navigation off and on at runtime (for example
   * while a modal dialog owns the arrow keys). @defaultValue true
   */
  enableKeyboard?: MaybeRefOrGetter<boolean>;
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
  const turnDuration = options.turnDuration ?? 180;

  const spreadIdx = ref(0);
  // The spread is a read-only render result that is replaced wholesale, so it
  // is held shallowly: deep reactivity would proxy the whole page tree.
  const spread = shallowRef<SpreadResult | null>(null);
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

  // `immediate` covers a layout that is already non-null when the composable
  // runs (a restored or pre-built layout): without it `spread` would stay null
  // until the ref happened to change.
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
    { immediate: true, flush: 'sync' },
  );

  // The layout is part of the source so a reflow that resets the index to 0 and
  // has it restored within the same tick still re-reads the replacement layout:
  // the index alone compares equal at flush time and would be swallowed.
  // `onChange` stays tied to the index, so such a round trip stays silent.
  let lastNotifiedIdx = 0;
  watch([spreadIdx, layout], () => {
    refresh();
    if (spreadIdx.value === lastNotifiedIdx) return;
    lastNotifiedIdx = spreadIdx.value;
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
    if (ignoreNavigationKey(e)) return;
    if (e.key === 'ArrowLeft') next();
    else if (e.key === 'ArrowRight') prev();
  }

  let keyboardBound = false;

  function bindKeyboard(): void {
    if (keyboardBound) return;
    window.addEventListener('keydown', onKey);
    keyboardBound = true;
  }

  function unbindKeyboard(): void {
    if (!keyboardBound) return;
    window.removeEventListener('keydown', onKey);
    keyboardBound = false;
  }

  // Bound after mount so server rendering never touches `window`, and kept in
  // sync afterwards so a reactive `enableKeyboard` releases the arrow keys.
  onMounted(() => {
    watch(
      () => toValue(options.enableKeyboard) ?? true,
      (enabled) => {
        if (enabled) bindKeyboard();
        else unbindKeyboard();
      },
      { immediate: true },
    );
  });
  onUnmounted(unbindKeyboard);

  onScopeDispose(() => {
    unbindKeyboard();
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
