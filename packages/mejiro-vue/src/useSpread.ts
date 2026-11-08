import type { ChapterLayout, InChapterAnchor, SpreadResult } from '@libraz/mejiro/book';
import {
  type ComputedRef,
  computed,
  type MaybeRefOrGetter,
  onMounted,
  onScopeDispose,
  type Ref,
  ref,
  shallowReadonly,
  shallowRef,
  toRaw,
  toValue,
  watch,
} from 'vue';

/**
 * How {@link useSpread} and `MejiroSpread` show a layout: one page at a time,
 * or both pages of a spread. `MejiroReader` resolves its `'auto'` mode to one
 * of these from the surface size.
 */
export type ResolvedSpreadMode = 'single' | 'double';

/** Options for {@link UseSpreadReturn.goTo}. */
export interface GoToOptions {
  /**
   * Run the page-turn animation. `false` moves at once, which is how a reading
   * position is restored without briefly showing the position it leaves.
   * @defaultValue true
   */
  animate?: boolean;
}

/** Options for {@link useSpread}. */
export interface UseSpreadOptions {
  /**
   * Enable ArrowLeft/ArrowRight navigation while the layout is loaded. Pass a
   * ref or getter to switch navigation off and on at runtime (for example
   * while a modal dialog owns the arrow keys). @defaultValue true
   */
  enableKeyboard?: MaybeRefOrGetter<boolean>;
  /**
   * Length of the page-turn animation in milliseconds. The index and `spread`
   * commit this long after a navigation request; `turning` is `true` in
   * between. `0` turns at once. @defaultValue 180
   */
  turnDurationMs?: number;
  /**
   * Show one page at a time (`'single'`, the navigation index then counts
   * pages) or both pages of a spread (`'double'`). Changing it converts the
   * index so the page on screen stays visible. @defaultValue 'double'
   */
  spreadMode?: MaybeRefOrGetter<ResolvedSpreadMode>;
  /**
   * When the layout is replaced (a reflow after a resize or an option change),
   * keep the text that was on screen visible instead of returning to the
   * start. Read once, when the composable is called. @defaultValue false
   */
  preservePosition?: boolean;
  /** Called with the new navigation index once it commits (after the turn animation). */
  onIndexChange?: (index: number) => void;
}

/** Return value of {@link useSpread}. */
export interface UseSpreadReturn {
  /** Navigation index (0-based): a page index in single mode, a spread index otherwise. */
  index: Readonly<Ref<number>>;
  /** Number of navigation positions: pages in single mode, spreads otherwise; 0 until the layout is ready. */
  count: ComputedRef<number>;
  /** Index of {@link UseSpreadReturn.spread} in the layout (`ChapterLayout.getSpread`). */
  spreadIndex: ComputedRef<number>;
  /** Number of spreads in the layout, whatever the mode; 0 until the layout is ready. */
  spreadCount: ComputedRef<number>;
  /** Number of pages in the layout, as of {@link UseSpreadReturn.spread}. */
  pageCount: ComputedRef<number>;
  /** Layout spread holding the visible page(s), or `null` until the layout is ready. */
  spread: Readonly<Ref<SpreadResult | null>>;
  /** First page shown, in reading order. */
  firstPage: ComputedRef<number>;
  /** Side of {@link UseSpreadReturn.spread} shown in single mode; `null` in double mode. */
  singleSide: ComputedRef<'right' | 'left' | null>;
  /** Whether the page-turn animation is in flight. */
  turning: Readonly<Ref<boolean>>;
  /** Advance one position (page or spread) forward. */
  next: () => void;
  /** Go back one position. */
  prev: () => void;
  /**
   * Move to a navigation index, clamped to `[0, count − 1]`. A request made
   * while a turn is in flight replaces it. A no-op until the layout is ready.
   *
   * @throws RangeError If `index` is not a finite integer.
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
  /** Re-read `spread` from the layout at the current index (after `setImages`, for example). */
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
 * Vue composable that tracks the navigation position in a chapter layout and
 * provides navigation helpers with an optional page-turn animation.
 *
 * The `spread` ref follows the layout and the index. Call
 * {@link UseSpreadReturn.refresh} after changing the layout in place (e.g. via
 * `setImages`) so subscribers see the new spread without changing the index.
 *
 * @param layout - The chapter layout to navigate, or `null` while none is ready.
 * @param options - Navigation options.
 */
export function useSpread(
  layout: MaybeRefOrGetter<ChapterLayout | null>,
  options: UseSpreadOptions = {},
): UseSpreadReturn {
  const turnDurationMs = options.turnDurationMs ?? 180;
  const preservePosition = options.preservePosition ?? false;
  const currentLayout = (): ChapterLayout | null => toRaw(toValue(layout));

  const index = ref(0);
  // The spread is a read-only render result that is replaced wholesale, so it
  // is held shallowly: deep reactivity would proxy the whole page tree.
  const spread = shallowRef<SpreadResult | null>(null);
  const turning = ref(false);
  let turnTimer: ReturnType<typeof setTimeout> | null = null;
  // Target of the turn in flight and the mode it was counted in.
  let turnTarget: { index: number; single: boolean } | null = null;
  let layoutGeneration = 0;

  const single = computed(() => (toValue(options.spreadMode) ?? 'double') === 'single');
  // Read from the spread on screen, not the layout: an option change re-breaks
  // the layout lazily, and a render before the replacement layout arrives must
  // not pay for that pass.
  const pageCount = computed(() => spread.value?.pageCount ?? 0);
  const count = computed(() => navigationCount(pageCount.value, single.value));
  const spreadCount = computed(() => Math.ceil(pageCount.value / 2));
  const firstPage = computed(() => firstPageOf(index.value, single.value));
  const spreadIndex = computed(() => Math.floor(firstPage.value / 2));
  const singleSide = computed<'right' | 'left' | null>(() =>
    single.value ? (firstPage.value % 2 === 0 ? 'right' : 'left') : null,
  );

  function refresh(): void {
    const l = currentLayout();
    spread.value = l ? l.getSpread(spreadIndex.value) : null;
  }

  function cancelTurn(): void {
    if (turnTimer) {
      clearTimeout(turnTimer);
      turnTimer = null;
    }
    turnTarget = null;
    turning.value = false;
  }

  // Anchor of the position on screen, taken when it settled: an option change
  // re-paginates the live layout in place before its replacement arrives, so
  // reading the outgoing layout at replacement time would drift.
  let settled: { layout: ChapterLayout; anchor: InChapterAnchor | null } | null = null;

  /** Navigation index of `next` that shows the text settled on the outgoing layout. */
  function preservedIndex(next: ChapterLayout | null): number {
    if (!(preservePosition && next && settled?.anchor)) return 0;
    const location = next.locateAnchor(settled.anchor);
    if (!location) return 0;
    const max = navigationCount(next.pageCount, single.value) - 1;
    return Math.max(0, Math.min(max, indexOfPageIn(location.pageIndex, single.value)));
  }

  // A mode flip converts the index before anything renders, so the page on
  // screen stays visible.
  watch(
    single,
    (now, before) => {
      index.value = indexOfPageIn(firstPageOf(index.value, before), now);
    },
    { flush: 'sync' },
  );

  // `immediate` covers a layout that is already non-null when the composable
  // runs (a restored or pre-built layout): without it `spread` would stay null
  // until the source happened to change.
  watch(
    currentLayout,
    (next) => {
      layoutGeneration++;
      cancelTurn();
      index.value = preservedIndex(next);
      refresh();
    },
    { immediate: true, flush: 'sync' },
  );

  if (preservePosition) {
    watch(
      [currentLayout, index, single],
      ([l, i, isSingle], previous) => {
        // A flip keeps the anchor of the page that was on screen: the converted
        // index may start earlier.
        const flipped = previous != null && previous[2] !== isSingle;
        if (flipped && l && settled?.layout === l) return;
        settled = l
          ? { layout: l, anchor: firstTextAnchorFrom(l, firstPageOf(i, isSingle)) }
          : null;
      },
      { immediate: true },
    );
  }

  // The layout is part of the source so a reflow that resets the index to 0 and
  // has it restored within the same tick still re-reads the replacement layout:
  // the index alone compares equal at flush time and would be swallowed.
  // `onIndexChange` stays tied to the index, so such a round trip stays silent.
  let lastNotifiedIndex = index.value;
  watch([index, currentLayout, single], () => {
    refresh();
    if (index.value === lastNotifiedIndex) return;
    lastNotifiedIndex = index.value;
    options.onIndexChange?.(index.value);
  });

  /** Target of the turn in flight in the current mode, else the current index. */
  function navigationTarget(): number {
    if (!turnTarget) return index.value;
    // A mode flip during the turn re-counts the target in the new mode.
    return indexOfPageIn(firstPageOf(turnTarget.index, turnTarget.single), single.value);
  }

  function goTo(requested: number, goToOptions: GoToOptions = {}): void {
    if (!Number.isInteger(requested)) {
      throw new RangeError(`useSpread.goTo: index must be a finite integer, got ${requested}`);
    }
    if (!currentLayout() || count.value === 0) return;
    const target = Math.max(0, Math.min(count.value - 1, requested));
    if (goToOptions.animate === false || turnDurationMs <= 0) {
      cancelTurn();
      index.value = target;
      return;
    }
    if (turnTimer) {
      if (target === navigationTarget()) return;
      // A new turn first lands the one in flight, so no target is skipped.
      clearTimeout(turnTimer);
      turnTimer = null;
      index.value = navigationTarget();
      turnTarget = null;
      turning.value = false;
    }
    if (target === index.value) return;
    const generation = layoutGeneration;
    turnTarget = { index: target, single: single.value };
    turning.value = true;
    turnTimer = setTimeout(() => {
      if (generation !== layoutGeneration) return;
      index.value = navigationTarget();
      turning.value = false;
      turnTarget = null;
      turnTimer = null;
    }, turnDurationMs);
  }

  function indexOfPage(pageIndex: number): number {
    return indexOfPageIn(pageIndex, single.value);
  }

  function anchorAt(at: number): InChapterAnchor | null {
    const l = currentLayout();
    if (!l || at < 0 || at >= count.value) return null;
    return firstTextAnchorFrom(l, firstPageOf(at, single.value));
  }

  // Step from the turn in flight, so each call moves exactly one position.
  function next(): void {
    goTo(navigationTarget() + 1);
  }

  function prev(): void {
    goTo(navigationTarget() - 1);
  }

  function onKey(e: KeyboardEvent): void {
    if (!currentLayout()) return;
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
  onScopeDispose(() => {
    unbindKeyboard();
    if (turnTimer) clearTimeout(turnTimer);
  });

  return {
    index: shallowReadonly(index),
    count,
    spreadIndex,
    spreadCount,
    pageCount,
    spread: shallowReadonly(spread),
    firstPage,
    singleSide,
    turning: shallowReadonly(turning),
    next,
    prev,
    goTo,
    indexOfPage,
    anchorAt,
    refresh,
  };
}
