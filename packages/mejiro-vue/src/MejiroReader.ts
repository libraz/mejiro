import type {
  BookOptions,
  ChapterLayout,
  ComputePageSizeOptions,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBookOptions,
  ReadingAnchor,
} from '@libraz/mejiro/book';
import { DEFAULT_BOOK_OPTIONS, DEFAULT_PAGE_GEOMETRY } from '@libraz/mejiro/book';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import type { EpubBook, EpubParseLimits, ManuscriptDialect } from '@libraz/mejiro/epub';
import { manuscriptToEpubBook } from '@libraz/mejiro/epub';
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  shallowRef,
  type VNode,
  watch,
} from 'vue';
import { toError } from './errors.js';
import {
  format as formatMessage,
  MejiroI18nProvider,
  type MejiroLocale,
  type MejiroMessages,
  resolveMessages,
  useI18n,
} from './i18n.js';
import { MejiroChapterNav } from './MejiroChapterNav.js';
import { MejiroDropZone } from './MejiroDropZone.js';
import { MejiroPageIndicator } from './MejiroPageIndicator.js';
import { MejiroScrollView } from './MejiroScrollView.js';
import type { EditableSettings, FontChoice } from './MejiroSettingsPanel.js';
import { MejiroSettingsPanel } from './MejiroSettingsPanel.js';
import { MejiroSpread } from './MejiroSpread.js';
import { MejiroStats } from './MejiroStats.js';
import { mergeDefined } from './persistence.js';
import { useChapterLayout } from './useChapterLayout.js';
import { useEpub } from './useEpub.js';
import { useMejiroBook } from './useMejiroBook.js';
import { useMultiImageOverlay } from './useMultiImageOverlay.js';
import { useSpread } from './useSpread.js';

/**
 * Where {@link MejiroReader} places its chapter navigation: the header
 * dropdown (`'select'`), the side chapter list (`'panel'`), both, or neither.
 */
export type MejiroChapterNavMode = 'select' | 'panel' | 'both' | 'none';

/**
 * Window (ms) used to coalesce runtime option changes before they reach the
 * book and trigger a re-flow. Continuous controls (font-size / line-spacing)
 * emit one change per step; without this every step would cost a font load,
 * a full re-measurement and a re-layout.
 */
const OPTIONS_DEBOUNCE_MS = 60;

/** Default image x (px, relative to the right page), as `useMultiImageOverlay` places it. */
const IMAGE_DEFAULT_X = 80;

/**
 * Where a new image goes when one page is shown alone: on that page, at the
 * default x — the default cascade walks leftwards, onto the page not shown.
 */
function singlePageImagePlacement(
  side: 'right' | 'left' | null,
  pageWidth: number,
): { x: number } | undefined {
  if (side == null) return undefined;
  return { x: side === 'left' ? IMAGE_DEFAULT_X - pageWidth : IMAGE_DEFAULT_X };
}

/** Book-swap key standing for any manuscript source, whatever its content. */
const MANUSCRIPT_SOURCE = Symbol('manuscript');

/**
 * Content key of a manuscript source: equal chapters give an equal key whatever
 * the array identity, and the key parses back into those chapters.
 */
function manuscriptKey(manuscript: readonly ManuscriptChapter[] | undefined): string | undefined {
  if (manuscript === undefined) return undefined;
  return JSON.stringify(manuscript.map(({ id, title, body }) => ({ id, title, body })));
}

/** Key over every option the book re-measures or re-breaks for; a change re-flows the chapter. */
function reflowOptionsKey(o: BookOptions): string {
  return JSON.stringify([
    o.fontFamily,
    o.fontSize,
    o.lineSpacing,
    o.mode,
    o.enableHanging,
    o.headingScale,
    o.headingStyles,
  ]);
}

/**
 * Page a scroll-mode reader asks the view to show: the page a user scroll
 * settled on while it still belongs to the current position, else the first
 * page of that position. The React MejiroReader carries an identical copy.
 */
function scrollTargetPage(
  spread: { spreadIdx: number; firstPage: number; indexOfPage: (pageIdx: number) => number },
  userPage: number | null,
): number {
  return userPage != null && spread.indexOfPage(userPage) === spread.spreadIdx
    ? userPage
    : spread.firstPage;
}

/** Receivers for the lifecycle events {@link createLifecycleTracker} decides to fire. */
interface LifecycleSink {
  spreadChanged: (chapter: number, spreadIdx: number) => void;
  chapterFinished: (chapter: number) => void;
  pageRead: (anchor: ReadingAnchor, dwellMs: number) => void;
}

/**
 * Decides spreadChanged / chapterFinished / page-read from successive reader
 * states; the React MejiroReader carries an identical copy.
 *
 * A state is skipped while `view` is null (it must be null unless the layout
 * was built for `chapter` of `book`) or while a controlled `spreadIdx` is still
 * being restored. `view.total` counts navigation positions and `view.anchor` is
 * the start of the first visible page. The first settled position of each
 * `book` is the baseline and emits nothing; afterwards each change of
 * (chapter, spreadIdx) emits exactly once, and a re-layout that keeps the pair
 * emits nothing.
 */
function createLifecycleTracker(
  sink: LifecycleSink,
): (
  book: unknown,
  chapter: number,
  spreadIdx: number,
  view: { total: number; anchor: InChapterAnchor | null } | null,
  controlledSpreadIdx: number | undefined,
) => void {
  let lastBook: unknown = null;
  let last: { chapter: number; spreadIdx: number } | null = null;
  let dwell: { anchor: ReadingAnchor; ts: number } | null = null;
  return (book, chapter, spreadIdx, view, controlledSpreadIdx) => {
    if (!view) return;
    if (book !== lastBook) {
      lastBook = book;
      last = null;
      dwell = null;
    }
    const totalSpreads = view.total;
    if (controlledSpreadIdx != null) {
      const target = Math.max(0, Math.min(totalSpreads - 1, controlledSpreadIdx));
      if (spreadIdx !== target) return;
    }
    if (last && last.chapter === chapter && last.spreadIdx === spreadIdx) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const previous = last;
    if (previous && dwell) sink.pageRead(dwell.anchor, now - dwell.ts);
    const inCh = view.anchor;
    dwell = inCh ? { anchor: { chapter, ...inCh }, ts: now } : null;
    last = { chapter, spreadIdx };
    if (!previous) return;
    sink.spreadChanged(chapter, spreadIdx);
    if (spreadIdx === totalSpreads - 1) sink.chapterFinished(chapter);
  };
}

/** Clamps a chapter index into `book`'s chapters; any index stands while no book is shown. */
function clampChapter(index: number, book: EpubBook | null): number {
  if (!book) return index;
  return Math.max(0, Math.min(book.chapters.length - 1, index));
}

/**
 * What a pending anchor resolves against. `book` is null while none is shown or
 * one is loading; `layout` must be null unless built for `chapter` of `book`.
 */
interface AnchorTarget {
  book: EpubBook | null;
  chapter: number;
  layout: ChapterLayout | null;
}

/**
 * Sole owner of the pending `goToAnchor` request; the React MejiroReader carries
 * an identical copy. Every request settles exactly once: applied, unresolvable
 * (its chapter or position does not exist in the shown book), superseded by a
 * newer request, or disposed. A request made before a book is shown waits for one.
 */
function createAnchorResolver(nav: {
  goToChapter: (chapter: number) => void;
  goToPage: (pageIdx: number) => void;
}): {
  request: (anchor: ReadingAnchor, target: AnchorTarget) => Promise<void>;
  update: (target: AnchorTarget) => void;
  dispose: () => void;
} {
  let pending: { anchor: ReadingAnchor; resolve: () => void; chapterRequested: boolean } | null =
    null;
  const settle = (): void => {
    const settled = pending;
    pending = null;
    settled?.resolve();
  };
  const update = (target: AnchorTarget): void => {
    const current = pending;
    if (!(current && target.book)) return;
    const { anchor } = current;
    if (!(anchor.chapter >= 0 && anchor.chapter < target.book.chapters.length)) {
      settle();
      return;
    }
    if (anchor.chapter !== target.chapter) {
      // Asked once: a host driving a controlled `chapter` may decline.
      if (current.chapterRequested) return;
      current.chapterRequested = true;
      nav.goToChapter(anchor.chapter);
      return;
    }
    if (!target.layout) return;
    const loc = target.layout.locateAnchor({
      paragraph: anchor.paragraph,
      charIndex: anchor.charIndex,
    });
    if (loc) nav.goToPage(loc.pageIdx);
    settle();
  };
  return {
    request: (anchor, target) =>
      new Promise<void>((resolve) => {
        settle();
        pending = { anchor, resolve, chapterRequested: false };
        update(target);
      }),
    update,
    dispose: settle,
  };
}

/**
 * Reading-flow mode for {@link MejiroReader}.
 * - `paginated` — two-page spread with page-turn animation (default).
 * - `scroll` — every page in the chapter stacked in a vertical scroll view.
 */
export type MejiroReaderMode = 'paginated' | 'scroll';

/**
 * Two-page vs single-page rendering of a spread.
 * - `double` — always render two pages (default).
 * - `single` — render one page at a time, centered; spread indices count pages.
 * - `auto` — switch based on the surface aspect ratio (single when portrait),
 *   converting the index so the page on screen stays visible.
 */
export type MejiroSpreadMode = 'double' | 'single' | 'auto';

/**
 * Which page of a spread prints its page number: `'both'` (right = odd,
 * left = even), only `'right'`, only `'left'`, or `'none'`.
 */
export type PageNumberDisplay = 'both' | 'right' | 'left' | 'none';

/**
 * How the reader sizes itself inside its container.
 * - `fill` — fill the container's given height; the spread is fitted inside it,
 *   letterboxing if the box aspect doesn't match the spread (the default; the
 *   host must give the reader a height).
 * - `width` — self-size from width: the reader derives its own height from its
 *   measured width and the page aspect ratio, so the spread fills exactly with
 *   no letterbox and the host needs no height/aspect magic numbers. The host
 *   only constrains the width.
 */
export type MejiroReaderFit = 'fill' | 'width';

/** Built-in reader theme presets. */
export type MejiroThemeName = 'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto';

/**
 * Theme configuration for the reader. Either a preset name, or an object
 * with a preset and an `override` map of CSS custom properties that take
 * precedence over the preset values.
 */
export type MejiroTheme =
  | MejiroThemeName
  | {
      name: MejiroThemeName;
      override?: Record<string, string>;
    };

/** Reading position exposed by {@link MejiroReaderHandle.getReadingPosition}. */
export interface ReadingPosition {
  /** Zero-based index of the current chapter. */
  chapter: number;
  /** Zero-based index of the current spread within the chapter. */
  spreadIdx: number;
  /** Number of pages in the current chapter's layout. */
  totalPages: number;
  /** Number of spreads in the current chapter's layout. */
  totalSpreads: number;
}

/**
 * Event payloads emitted by {@link MejiroReaderHandle.subscribe}.
 *
 * Each property maps an event name to its listener signature.
 */
export interface MejiroReaderEventMap {
  /** Fires after the current spread index changes. */
  spreadChanged: (payload: { chapter: number; spreadIdx: number }) => void;
  /** Fires when a turn animation begins (before the new spread is shown). */
  turnStart: (payload: { from: number }) => void;
  /** Fires after a turn animation completes (the new spread is now shown). */
  turnEnd: (payload: { to: number }) => void;
  /** Fires when the reader reaches the last spread of the current chapter. */
  chapterFinished: (payload: { chapter: number }) => void;
}

/**
 * Slot payload passed to the `settings` slot.
 *
 * Lets a host replace the built-in settings controls with its own UI while
 * keeping the panel chrome and its open/close accordion. All fields are wired
 * to the live reader.
 */
export interface MejiroReaderSettingsSlot {
  /** Current effective settings (font, size, line spacing, kinsoku, hanging). */
  settings: EditableSettings;
  /** Applies a partial settings change and re-flows the chapter. */
  update: (partial: Partial<BookOptions>) => void;
  /** Whether the settings panel is currently open. */
  open: boolean;
  /** Toggles the settings panel open/closed. */
  toggle: () => void;
}

/** Imperative handle exposed via `ref` on {@link MejiroReader}. */
export interface MejiroReaderHandle {
  /** Jump to a specific spread (0-based, clamped to [0, totalSpreads − 1]). */
  goToSpread(index: number): void;
  /** Advance one spread forward. */
  next(): void;
  /** Go back one spread. */
  prev(): void;
  /** Jump to a chapter (clamped to the book's chapters; resets spread index to 0). */
  goToChapter(index: number): void;
  /** Read the current reading position. */
  getReadingPosition(): ReadingPosition;
  /**
   * Navigate to a {@link ReadingAnchor}. If the chapter differs from the
   * current one, the chapter is switched first; once the new layout is
   * ready the anchor is resolved and the matching spread is opened. A call
   * made before the book has loaded is applied once it has.
   *
   * Returns a promise that resolves once the spread has been applied, or
   * without moving when the anchor's chapter or position does not exist in the
   * book. If another `goToAnchor` is invoked before the previous one settles,
   * the earlier promise resolves immediately (superseded). Resolves on unmount.
   */
  goToAnchor(anchor: ReadingAnchor): Promise<void>;
  /**
   * Returns the {@link ReadingAnchor} at the start of the text on the current
   * spread, or `null` if the layout is not ready. When an image blocks every
   * page of the spread, the anchor is where the text resumes after it; `null`
   * again if none follows.
   */
  getAnchor(): ReadingAnchor | null;
  /**
   * Returns the half-open range of {@link ReadingAnchor}s visible on the
   * current spread. `end` points at the start of the text on the next spread
   * that has any (or the end of the chapter when none does).
   */
  getVisibleRange(): { start: ReadingAnchor; end: ReadingAnchor } | null;
  /**
   * Updates book options at runtime. Same shape as {@link MejiroBook.setOptions}
   * — font / size changes re-measure and re-layout asynchronously.
   *
   * Successive calls are coalesced into a single application; the returned
   * promise resolves once that application has settled. A failed application
   * (such as a font that measures as a fallback under `strictFontCheck`) is
   * emitted as `error` rather than rejecting the promise.
   */
  setOptions(partial: Partial<BookOptions>): Promise<void>;
  /**
   * Subscribes to a reader lifecycle event. Returns a function that
   * detaches the listener.
   */
  subscribe<E extends keyof MejiroReaderEventMap>(
    event: E,
    listener: MejiroReaderEventMap[E],
  ): () => void;
}

/**
 * Full-page EPUB reader component. Composes the rest of the
 * `@libraz/mejiro-vue` building blocks into a working reader.
 *
 * Each feature (settings panel, chapter nav, drop zone, image overlay,
 * keyboard navigation, page indicator, stats) can be toggled independently
 * via `enableX` props, or removed in bulk with `bare`. Pass slots to replace
 * any region with custom UI.
 *
 * Imperative navigation is available via `ref` (see
 * {@link MejiroReaderHandle}):
 *
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import type { MejiroReaderHandle } from '@libraz/mejiro-vue';
 * const reader = ref<MejiroReaderHandle | null>(null);
 * // reader.value?.goToSpread(12);
 * </script>
 * <template>
 *   <MejiroReader ref="reader" />
 * </template>
 * ```
 */
export const MejiroReader = defineComponent({
  name: 'MejiroReader',
  props: {
    /**
     * Book options. Accepts a **partial** set — any omitted field falls back to
     * {@link DEFAULT_BOOK_OPTIONS} (`serif` 16px, line spacing 1.8, strict
     * kinsoku, hanging punctuation on), so you only pass what you want to change:
     *
     * ```ts
     * { fontFamily: '"Noto Serif JP"', fontSize: 18 }
     * ```
     *
     * The merge is shallow (top-level keys), so a supplied `headingStyles`
     * replaces the default map rather than merging into it.
     *
     * `strictFontCheck` is read once, when the reader mounts.
     */
    options: {
      type: Object as PropType<Partial<MejiroBookOptions>>,
      default: () => ({}),
    },
    /**
     * Page-geometry overrides forwarded to `MejiroBook.computePageSize`. Use to
     * tune how the spread is sized inside the surface — most usefully to shrink
     * the reserved margins so the pages fill their frame:
     *
     * ```vue
     * <MejiroReader :page-geometry="{ gutterOffset: 0, headerOffset: 0 }" />
     * ```
     *
     * Also accepts `aspect`, `minWidth`, `minHeight`, `maxHeight`, and inner
     * `padding`. Omitted fields fall back to the built-in defaults.
     */
    pageGeometry: {
      type: Object as PropType<ComputePageSizeOptions>,
      default: undefined,
    },
    /** Font choices displayed in the settings panel. */
    fonts: { type: Array as PropType<FontChoice[]>, default: undefined },
    /**
     * Pre-parsed EPUB to display. Takes precedence over `epubUrl` when both
     * are supplied. When set, the reader renders this book directly:
     *
     * ```vue
     * <MejiroReader :epub="myEpub" :options="options" />
     * ```
     */
    epub: { type: Object as PropType<EpubBook | null>, default: undefined },
    /**
     * URL fetched and parsed on mount. Use this for "just open this book"
     * scenarios. Ignored when `epub` is supplied.
     */
    epubUrl: { type: String, default: undefined },
    /**
     * Manuscript chapters to render directly without an EPUB ZIP round-trip.
     * Designed for live preview in custom manuscript editors; each chapter
     * body is split into paragraphs on blank lines and run through
     * `parseManuscript` before layout. Cannot be combined with `epub` /
     * `epubUrl`.
     */
    manuscript: {
      type: Array as PropType<readonly ManuscriptChapter[]>,
      default: undefined,
    },
    /**
     * Manuscript notation dialect. Only honored when `manuscript` is supplied.
     * @defaultValue `'mejiro'`
     */
    dialect: { type: String as PropType<ManuscriptDialect>, default: undefined },
    /**
     * Controlled chapter index. When omitted, the reader manages its own
     * chapter state and resets to 0 on EPUB change.
     */
    chapter: { type: Number, default: undefined },
    /**
     * Controlled spread index. When supplied, the reader is driven by this
     * value and emits `spread-idx-change` on user navigation. A spread index
     * does not survive reflow, so persist the reading position with
     * `useReadingPosition` and the handle's `getAnchor` / `goToAnchor` instead.
     */
    spreadIdx: { type: Number, default: undefined },
    /**
     * Visual theme preset, or `{ name, override }` to layer custom CSS
     * variables on top of a preset. @defaultValue 'light'
     */
    theme: {
      type: [String, Object] as PropType<MejiroTheme>,
      default: 'light',
    },
    /**
     * Reading-flow mode. `paginated` (default) shows one spread at a time;
     * `scroll` stacks every page in the chapter inside a vertical scroller.
     */
    mode: {
      type: String as PropType<MejiroReaderMode>,
      default: 'paginated',
    },
    /**
     * Spread layout. `double` renders two pages (default); `single` renders one
     * page at a time, and `spreadIdx`, `goToSpread`, `spread-idx-change` and
     * `spreadChanged` then count pages; `auto` flips to `single` for portrait
     * viewports, keeping the page on screen visible.
     */
    spreadMode: {
      type: String as PropType<MejiroSpreadMode>,
      default: 'double',
    },
    /**
     * How the reader sizes itself in its container. `fill` (default) fills the
     * container height and letterboxes the spread; `width` makes the reader
     * self-size — it derives its height from its width and the page aspect, so
     * an embedding host only has to constrain the width (no height/aspect magic
     * numbers, no letterbox). In `width` mode the reserved `gutterOffset` /
     * `headerOffset` default to 0 so the spread fills edge-to-edge; override via
     * `pageGeometry` if you still want them.
     */
    fit: {
      type: String as PropType<MejiroReaderFit>,
      default: 'fill',
    },
    /**
     * Enable surface-tap chrome toggling. Tapping the spread center (away
     * from buttons) hides the header and chapter panel. @defaultValue true
     */
    enableSurfaceTap: { type: Boolean, default: true },
    /**
     * Built-in locale for UI strings (`'en'` / `'ja'`). Pair with `messages`
     * to override individual strings. @defaultValue 'en'
     */
    locale: { type: String as PropType<MejiroLocale>, default: undefined },
    /**
     * Static HTML rendered as a hydration fallback (typically the output of
     * `renderEpubStatic`). Shown until the client layout is ready. Also
     * accepted as a `fallback` slot for richer Vue content. Vue-only: the
     * React reader takes a `fallback` node instead.
     */
    fallbackHtml: { type: String, default: undefined },
    /**
     * Extra options merged into the EPUB `fetch` call (URL mode). Useful
     * for sending bearer tokens or cookies.
     */
    fetchOptions: { type: Object as PropType<RequestInit>, default: undefined },
    /**
     * Resource limits applied while parsing an EPUB the reader loads itself
     * (URL mode and the drop zone / file picker). Untrusted files reach this
     * component directly, so hosts that accept them should tighten the
     * defaults here.
     */
    limits: { type: Object as PropType<Partial<EpubParseLimits>>, default: undefined },
    /**
     * Custom EPUB fetcher used in place of the global `fetch`. Overrides
     * `fetchOptions` when set.
     */
    fetchEpub: {
      type: Function as PropType<(url: string) => Promise<ArrayBuffer>>,
      default: undefined,
    },
    /**
     * Partial override of the message catalog. Merged on top of the catalog
     * selected by `locale`.
     */
    messages: { type: Object as PropType<Partial<MejiroMessages>>, default: undefined },
    /** Title text for the built-in header logo. @defaultValue 'mejiro' */
    title: { type: String, default: 'mejiro' },
    /** Subtitle for the header logo. @defaultValue `messages.logoSubtitle` */
    subtitle: { type: String, default: undefined },

    /**
     * Shorthand for a chrome-less reader. When `true`, the defaults for
     * `enableHeader`, `enableChapterNav`, `enableSettings`, `enableStats`,
     * and `enablePageIndicator` flip from `true` to `false`. Explicitly-passed
     * enable* props still win, so you can opt parts back in.
     * @defaultValue false
     */
    bare: { type: Boolean, default: false },

    /** Show the built-in header. @defaultValue `!bare` */
    enableHeader: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /**
     * Show the open-file / drop zone affordance. SaaS-style readers should
     * keep this off (the host controls which EPUB is delivered); set true to
     * accept user-supplied books.
     * @defaultValue false
     */
    enableDropZone: { type: Boolean, default: false },
    /** Show the chapter selector in the header. @defaultValue `!bare` */
    enableChapterNav: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /**
     * Where to render the built-in chapter navigation.
     * @defaultValue 'select'
     */
    chapterNavMode: {
      type: String as PropType<MejiroChapterNavMode>,
      default: 'select',
    },
    /** Show the settings panel toggle in the header. @defaultValue `!bare` */
    enableSettings: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /** Show the image-overlay editing/demo button. @defaultValue false */
    enableImageOverlay: { type: Boolean, default: false },
    /** Show the stats line in the header. @defaultValue `!bare` */
    enableStats: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /** Bind ArrowLeft/ArrowRight to page navigation. @defaultValue true */
    enableKeyboard: { type: Boolean, default: true },
    /** Show the "n / total" indicator below the book. @defaultValue `!bare` */
    enablePageIndicator: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /**
     * Which page of a spread shows its page number in the running head.
     * `'both'` numbers each page (right = odd, left = even), `'right'` /
     * `'left'` number only that side, `'none'` hides them (the "n / total"
     * indicator is independent). @defaultValue 'both'
     */
    pageNumbers: { type: String as PropType<PageNumberDisplay>, default: 'both' },
    /**
     * Reader-side annotations to render as highlights. Each annotation whose
     * `chapter` matches the current chapter is converted to spread-local
     * rectangles via `ChapterLayout.selectionRects`; the rectangles landing on
     * the spread on screen are drawn on top of the page content.
     */
    annotations: {
      type: Array as PropType<
        ReadonlyArray<{
          chapter: number;
          start: InChapterAnchor;
          end: InChapterAnchor;
          color?: string;
        }>
      >,
      default: undefined,
    },
  },
  emits: [
    'load',
    'chapter-change',
    'spread-change',
    'spread-idx-change',
    'error',
    'page-read',
    'chapter-completed',
  ],
  setup(props, { emit, slots, expose }) {
    const surfaceEl = ref<HTMLElement | null>(null);
    const settingsOpen = ref(false);
    const chapter = ref(0);
    const chromeHidden = ref(false);
    const autoSingle = ref(false);
    // Page a user scroll settled on, scoped to the layout it was reported against.
    const userScroll = shallowRef<{ layout: ChapterLayout; page: number } | null>(null);

    function toggleSettings(): void {
      settingsOpen.value = !settingsOpen.value;
    }

    let resizeObserver: ResizeObserver | null = null;
    function updateAutoSingle(): void {
      const surface = surfaceEl.value;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      autoSingle.value = rect.width < rect.height;
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && settingsOpen.value) {
        settingsOpen.value = false;
      }
    }
    onMounted(() => {
      window.addEventListener('keydown', onKey);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKey);
    });

    function stopAutoSingleObserver(): void {
      resizeObserver?.disconnect();
      resizeObserver = null;
    }
    function startAutoSingleObserver(): void {
      stopAutoSingleObserver();
      if (props.spreadMode !== 'auto') return;
      updateAutoSingle();
      if (typeof ResizeObserver === 'undefined') return;
      const surface = surfaceEl.value;
      if (!surface) return;
      resizeObserver = new ResizeObserver(updateAutoSingle);
      resizeObserver.observe(surface);
    }
    onMounted(() => startAutoSingleObserver());
    onBeforeUnmount(() => {
      stopAutoSingleObserver();
    });
    watch(
      () => props.spreadMode,
      (next) => {
        if (next === 'auto') startAutoSingleObserver();
        else stopAutoSingleObserver();
      },
    );
    const effectiveSingle = computed(
      () => props.spreadMode === 'single' || (props.spreadMode === 'auto' && autoSingle.value),
    );

    // Page geometry forwarded to `computePageSize`. In `fit="width"` mode the
    // surface self-sizes its height from its width via `aspect-ratio`, and the
    // book must exactly fill it. The fill-mode safety rails fight that invariant:
    // the reserved gutter / header offsets, the `maxHeight` cap, and the
    // `minWidth` / `minHeight` floors would size the book to something other than
    // the surface, leaving a reserved empty band around the spread. So default
    // them all off here (offsets 0, no clamp) — the spread tracks the surface
    // edge-to-edge. The host can still override any field via `pageGeometry`.
    const resolvedGeometry = computed<ComputePageSizeOptions | undefined>(() => {
      // A single-page reader derives its page width from the full container
      // width instead of halving it for a two-page spread (the host can still
      // override `columns` via `pageGeometry`).
      const columns: 1 | 2 = effectiveSingle.value ? 1 : 2;
      const geometry = props.pageGeometry ?? {};
      if (props.fit !== 'width') return mergeDefined<ComputePageSizeOptions>({ columns }, geometry);
      return mergeDefined<ComputePageSizeOptions>(
        {
          columns,
          gutterOffset: 0,
          headerOffset: 0,
          maxHeight: Number.POSITIVE_INFINITY,
          minWidth: 0,
          minHeight: 0,
        },
        geometry,
      );
    });

    // The spread aspect (width / height) used to self-size the surface in
    // `fit="width"` mode: one or two page columns wide, `aspect` tall. Exposed
    // as a CSS `aspect-ratio` value so the browser derives the surface height
    // from its width with no JS measurement feedback loop.
    const surfaceAspect = computed(() => {
      const columns = effectiveSingle.value ? 1 : 2;
      const aspect = resolvedGeometry.value?.aspect ?? DEFAULT_PAGE_GEOMETRY.aspect;
      return `${columns} / ${aspect}`;
    });
    const inheritedMessages = useI18n();
    const resolvedMessages = computed(() => {
      if (props.locale == null && props.messages == null) return inheritedMessages.value;
      const base =
        props.locale != null ? resolveMessages(props.locale, undefined) : inheritedMessages.value;
      return props.messages ? mergeDefined(base, props.messages) : base;
    });

    // `bare` toggles defaults; explicit props always win.
    const effEnableHeader = computed(() => props.enableHeader ?? !props.bare);
    const effEnableChapterNav = computed(() => props.enableChapterNav ?? !props.bare);
    const effEnableSettings = computed(() => props.enableSettings ?? !props.bare);
    const effEnableStats = computed(() => props.enableStats ?? !props.bare);
    const effEnablePageIndicator = computed(() => props.enablePageIndicator ?? !props.bare);

    // Fill any omitted option from the defaults so a host can pass just the
    // fields it cares about (`:options="{ fontSize: 15 }"`) without dropping the
    // rest. Shallow by design — a supplied nested map (e.g. `headingStyles`)
    // replaces, not merges.
    const resolvedOptions = computed<MejiroBookOptions>(() =>
      mergeDefined<MejiroBookOptions>(DEFAULT_BOOK_OPTIONS, props.options ?? {}),
    );
    // Option changes are coalesced before they reach the book: the settings
    // panel emits one per keystroke / slider step, and every metric change costs
    // a font load plus a full re-measurement. Failures are emitted as `error`
    // instead of an unhandled rejection, since most call sites here are
    // fire-and-forget.
    const {
      book,
      options,
      setOptions: applyBookOptions,
    } = useMejiroBook(resolvedOptions.value, undefined, {
      debounceMs: OPTIONS_DEBOUNCE_MS,
      onError: (err) => emit('error', err),
    });
    // Settles with the latest application (never rejects: failures are emitted).
    let lastApply: Promise<void> = Promise.resolve();
    function setOptions(partial: Partial<BookOptions>): Promise<void> {
      lastApply = applyBookOptions(partial);
      return lastApply;
    }

    // Sync the `options` prop only when its *value* changes. The prop supplies
    // the initial options, so a parent re-render that hands over a new but equal
    // object must not roll back runtime changes made through `setOptions` or the
    // settings panel.
    watch(
      () => JSON.stringify(resolvedOptions.value),
      () => void setOptions(resolvedOptions.value),
    );

    // Keyed on content, not array identity: a host re-render may hand over a
    // fresh `manuscript` array with the same chapters.
    const manuscriptSourceKey = computed(() => manuscriptKey(props.manuscript));
    const synthesizedEpub = computed<EpubBook | null>(() => {
      const key = manuscriptSourceKey.value;
      if (key === undefined) return null;
      const chapters = JSON.parse(key) as ManuscriptChapter[];
      return manuscriptToEpubBook(chapters, { dialect: props.dialect });
    });

    const epub = useEpub({
      // `epub` / `manuscript` take precedence: skip the URL fetch when a parsed
      // book (or a synthesized manuscript book) is supplied.
      get defaultUrl() {
        return props.epub !== undefined || props.manuscript !== undefined
          ? undefined
          : props.epubUrl;
      },
      get fetchOptions() {
        return props.fetchOptions;
      },
      get limits() {
        return props.limits;
      },
      get fetchEpub() {
        return props.fetchEpub;
      },
      onLoad: (b) => {
        if (props.chapter == null) chapter.value = 0;
        imageCtx.clearImages();
        emit('load', b);
      },
    });
    watch(
      epub.error,
      (next) => {
        if (next) emit('error', next);
      },
      { flush: 'sync' },
    );

    const activeChapter = computed(() =>
      clampChapter(props.chapter ?? chapter.value, epub.epub.value),
    );
    // Book identity: changes on a swap, not on a manuscript content edit.
    const bookKey = computed<unknown>(() =>
      props.manuscript !== undefined ? MANUSCRIPT_SOURCE : epub.epub.value,
    );
    // A controlled source owns the book, so the reader offers no file of its own.
    const filePicker = computed(
      () => props.enableDropZone && props.epub === undefined && props.manuscript === undefined,
    );

    // Bridge between the layout and spread composables: a reflow re-layout
    // produces a new layout object (which resets the spread index to 0), so
    // capture the reading anchor beforehand and restore it afterwards — but only
    // in uncontrolled mode. When `spreadIdx` is controlled the host owns the
    // position, so the controlled-restore watch below handles it instead.
    const positionBridge = {
      capture(layout: ChapterLayout): InChapterAnchor | null {
        if (props.spreadIdx != null) return null;
        if (visibleAnchor?.layout === layout) return visibleAnchor.anchor;
        // Same anchor resolution as `getAnchor`: skips image-blocked pages and
        // handles single mode.
        return spreadCtx.anchorAt(spreadCtx.spreadIdx.value);
      },
      restore(layout: ChapterLayout, anchor: InChapterAnchor): void {
        const loc = layout.locateAnchor(anchor);
        spreadCtx.setSpread(loc ? spreadCtx.indexOfPage(loc.pageIdx) : 0);
        // A capture that runs before the restored index settles must see this anchor.
        visibleAnchor = { layout, anchor };
      },
    };

    const layoutCtx = useChapterLayout(book, epub.epub, activeChapter, surfaceEl, {
      pageGeometry: () => resolvedGeometry.value,
      capturePosition: (layout) => positionBridge.capture(layout),
      onError: (err) => emit('error', err),
    });

    // Re-flow when the resolved page geometry changes at runtime (covers both
    // host `pageGeometry` edits and `fit`-driven offset changes). Keyed on the
    // value: an inline geometry literal is a new object on every parent render.
    watch(
      () => JSON.stringify(resolvedGeometry.value ?? null),
      () => void layoutCtx.recompute({ blank: false }),
    );

    // Re-flow when metric-affecting options change at runtime. `useMejiroBook`
    // keeps the book + reactive snapshot in sync, but an options change does not
    // otherwise re-run layout, so the settings-panel font / line-spacing /
    // kinsoku controls would only restyle the wrapper while the typeset content
    // stayed frozen. Debounced so dragging a continuous control (font-size /
    // line-spacing slider) coalesces into a single re-flow instead of laying out
    // the chapter on every step; the pending option change is awaited first so
    // the re-layout sees the metrics it will be measured with. Awaited, not
    // re-sent: re-sending the snapshot would re-apply (and re-report) a change
    // the book rejected.
    let optionsReflowTimer: ReturnType<typeof setTimeout> | null = null;
    watch(
      () => reflowOptionsKey(options.value),
      () => {
        if (optionsReflowTimer) clearTimeout(optionsReflowTimer);
        optionsReflowTimer = setTimeout(() => {
          optionsReflowTimer = null;
          void (async () => {
            try {
              await lastApply;
              await layoutCtx.recompute({ blank: false });
            } catch (err) {
              emit('error', toError(err));
            }
          })();
        }, OPTIONS_DEBOUNCE_MS);
      },
    );
    onBeforeUnmount(() => {
      if (optionsReflowTimer) clearTimeout(optionsReflowTimer);
    });

    const spreadCtx = useSpread(layoutCtx.layout, {
      // Getter, not a snapshot: toggling the prop at runtime must bind/release
      // the arrow keys.
      enableKeyboard: () => props.enableKeyboard,
      single: effectiveSingle,
      onChange: (i) => {
        emit('spread-change', i);
        emit('spread-idx-change', i);
      },
    });

    // Restore the reading position after a reflow re-layout. Registered after
    // useSpread so this sync watcher runs after its reset of the index to 0.
    watch(
      layoutCtx.layout,
      (layout) => {
        const anchor = layoutCtx.pendingRestore.current;
        if (!(anchor && layout)) return;
        layoutCtx.pendingRestore.current = null;
        positionBridge.restore(layout, anchor);
      },
      { flush: 'sync' },
    );

    // Anchor at the start of the spread on screen, taken when that spread
    // settled: an option change re-paginates the live layout in place before
    // the reflow captures from it, so reading the layout at capture time drifts.
    // A single/double flip keeps the anchor of the page that was on screen: the
    // converted index may start earlier, and the re-layout restores from it.
    let visibleAnchor: { layout: ChapterLayout; anchor: InChapterAnchor | null } | null = null;
    watch(
      [() => layoutCtx.layout.value, () => spreadCtx.spreadIdx.value, effectiveSingle],
      ([layout, spreadIdx, single], previous) => {
        const flipped = previous != null && previous[2] !== single;
        if (flipped && layout && visibleAnchor?.layout === layout) return;
        visibleAnchor = layout ? { layout, anchor: spreadCtx.anchorAt(spreadIdx) } : null;
      },
      { immediate: true },
    );

    const imageCtx = useMultiImageOverlay(layoutCtx.layout, spreadCtx.layoutSpreadIdx, {
      defaultX: IMAGE_DEFAULT_X,
      onUpdate: () => spreadCtx.refresh(),
    });

    const annotationRects = computed(() => {
      const layout = layoutCtx.layout.value;
      // The layout reflows in place when images change, so the image state keys this too.
      void imageCtx.currentImages.value;
      const list = props.annotations;
      if (!(list && layout)) return [];
      const result = [];
      for (const annotation of list) {
        if (annotation.chapter !== activeChapter.value) continue;
        const rects = layout.selectionRects({
          start: annotation.start,
          end: annotation.end,
        });
        // Carry the annotation's color onto every rectangle it produced — the
        // selection layer paints each rectangle from its own `color`.
        for (const rect of rects) result.push({ ...rect, color: annotation.color });
      }
      return result;
    });

    // Manuscript source: re-synthesize the EpubBook whenever `manuscript` /
    // `dialect` changes and feed it into the useEpub state. Chapter state is
    // *not* reset on content edits — the host controls chapter selection via
    // the `chapter` prop or default 0 on mount.
    watch(
      () => synthesizedEpub.value,
      (next) => {
        if (props.manuscript === undefined) return;
        epub.setEpub(next ?? null);
      },
      { immediate: true },
    );

    // Switching away from manuscript source clears the synthesized book so the
    // EPUB / URL path can take over without lingering manuscript data.
    watch(
      () => props.manuscript,
      (next, prev) => {
        if (next === undefined && prev !== undefined) {
          epub.setEpub(null);
        }
      },
    );

    // Controlled mode: keep the internal EPUB ref in sync with the `epub` prop.
    // Switching books invalidates the overlay state and the font-width cache —
    // both grow per-book, and the cache is keyed by font + fontSize so old
    // entries are not reusable once the book changes. `immediate: true` mirrors
    // React's `onLoad` which fires on initial mount with a non-null `epub`.
    watch(
      () => props.epub,
      (next, prev) => {
        if (next === undefined) {
          if (prev !== undefined) {
            epub.setEpub(null);
            imageCtx.clearImages();
            book.clearCache();
          }
          return;
        }
        if (next === prev) return;
        epub.setEpub(next ?? null);
        if (props.chapter == null) chapter.value = 0;
        imageCtx.clearImages();
        book.clearCache();
        if (next) emit('load', next);
      },
      { immediate: true },
    );

    // Entering manuscript source is a book swap, as for a new `epub`; content
    // edits within it are not.
    watch(
      () => props.manuscript !== undefined,
      (isManuscript) => {
        if (!isManuscript) return;
        if (props.chapter == null) chapter.value = 0;
        imageCtx.clearImages();
        book.clearCache();
        if (synthesizedEpub.value) emit('load', synthesizedEpub.value);
      },
      { immediate: true },
    );

    // Images belong to the chapter they were placed on; another chapter starts bare.
    watch(activeChapter, () => imageCtx.clearImages());

    // Controlled spreadIdx → host-driven navigation: animate to the prop value.
    watch(
      () => props.spreadIdx,
      (next) => {
        if (next == null) return;
        if (next === spreadCtx.spreadIdx.value) return;
        spreadCtx.goTo(next);
      },
      { immediate: true },
    );

    // Controlled spreadIdx → drift reconcile: a host that rejects a change
    // keeps the prop where it was, so any internal index that no longer matches
    // it is snapped back without a turn animation.
    watch(
      () => spreadCtx.spreadIdx.value,
      (next) => {
        const controlled = props.spreadIdx;
        if (controlled == null) return;
        if (next === controlled) return;
        spreadCtx.setSpread(controlled);
      },
    );

    // Controlled spreadIdx → reflow restore: a re-layout resets useSpread to
    // spread 0, so snap back to the controlled index immediately (no turn
    // animation, which would otherwise flash spread 0 on every resize).
    watch(
      () => layoutCtx.layout.value,
      () => {
        const next = props.spreadIdx;
        if (next == null) return;
        if (next === spreadCtx.spreadIdx.value) return;
        spreadCtx.setSpread(next);
      },
    );

    function setChapter(index: number): void {
      const i = clampChapter(index, epub.epub.value);
      if (i === activeChapter.value) return;
      if (props.chapter == null) chapter.value = i;
      emit('chapter-change', i);
    }

    // ── Event bus + anchor handling ──
    type EventName = keyof MejiroReaderEventMap;
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous listener payload
    const listeners = new Map<EventName, Set<(payload: any) => void>>();
    function emitReaderEvent<E extends EventName>(
      event: E,
      payload: Parameters<MejiroReaderEventMap[E]>[0],
    ): void {
      const set = listeners.get(event);
      if (!set) return;
      for (const cb of set) cb(payload);
    }

    // The layout only counts for the active chapter of the shown book once it
    // was built for them: after a chapter switch or a book swap the previous
    // layout survives until the re-layout replaces it. Recorded synchronously,
    // as each layout lands.
    const layoutOwner = shallowRef<{ chapter: number; book: unknown } | null>(null);
    watch(
      () => layoutCtx.layout.value,
      (next) => {
        layoutOwner.value = next ? { chapter: activeChapter.value, book: bookKey.value } : null;
      },
      { flush: 'sync' },
    );
    const chapterLayout = computed(() => {
      const owner = layoutOwner.value;
      return owner && owner.chapter === activeChapter.value && owner.book === bookKey.value
        ? layoutCtx.layout.value
        : null;
    });
    const anchorTarget = (): AnchorTarget => ({
      book: epub.loading.value ? null : epub.epub.value,
      chapter: activeChapter.value,
      layout: chapterLayout.value,
    });
    const anchorResolver = createAnchorResolver({
      goToChapter: (i) => setChapter(i),
      goToPage: (pageIdx) => spreadCtx.goTo(spreadCtx.indexOfPage(pageIdx)),
    });
    watch([() => (epub.loading.value ? null : epub.epub.value), activeChapter, chapterLayout], () =>
      anchorResolver.update(anchorTarget()),
    );
    // Settle any in-flight anchor so awaiting callers never hang.
    onBeforeUnmount(() => anchorResolver.dispose());

    // spreadChanged / chapter-completed / page-read are all decided by the tracker.
    const trackLifecycle = createLifecycleTracker({
      spreadChanged: (ch, spreadIdx) =>
        emitReaderEvent('spreadChanged', { chapter: ch, spreadIdx }),
      chapterFinished: (ch) => {
        emitReaderEvent('chapterFinished', { chapter: ch });
        emit('chapter-completed', ch);
      },
      pageRead: (anchor, dwellMs) => emit('page-read', anchor, dwellMs),
    });
    watch(
      [
        () => spreadCtx.spreadIdx.value,
        activeChapter,
        chapterLayout,
        () => props.spreadIdx,
        bookKey,
      ],
      ([spreadIdx, ch, layout, controlledSpreadIdx, key]) =>
        trackLifecycle(
          key,
          ch,
          spreadIdx,
          layout
            ? { total: spreadCtx.totalSpreads.value, anchor: spreadCtx.anchorAt(spreadIdx) }
            : null,
          controlledSpreadIdx,
        ),
      { immediate: true },
    );

    // Emit turnStart / turnEnd on the `turning` transition.
    watch(
      () => spreadCtx.turning.value,
      (next, prev) => {
        if (next && !prev) emitReaderEvent('turnStart', { from: spreadCtx.spreadIdx.value });
        else if (!next && prev) emitReaderEvent('turnEnd', { to: spreadCtx.spreadIdx.value });
      },
    );

    expose({
      goToSpread: (i: number) => spreadCtx.goTo(i),
      next: () => spreadCtx.next(),
      prev: () => spreadCtx.prev(),
      goToChapter: (i: number) => setChapter(i),
      getReadingPosition: (): ReadingPosition => ({
        chapter: activeChapter.value,
        spreadIdx: spreadCtx.spreadIdx.value,
        totalPages: spreadCtx.totalPages.value,
        totalSpreads: spreadCtx.totalSpreads.value,
      }),
      goToAnchor: (anchor: ReadingAnchor) => anchorResolver.request(anchor, anchorTarget()),
      getAnchor: () => {
        const layout = chapterLayout.value;
        if (!layout) return null;
        const inCh = spreadCtx.anchorAt(spreadCtx.spreadIdx.value);
        return inCh ? { chapter: activeChapter.value, ...inCh } : null;
      },
      getVisibleRange: () => {
        const layout = chapterLayout.value;
        if (!layout) return null;
        const start = spreadCtx.anchorAt(spreadCtx.spreadIdx.value);
        if (!start) return null;
        const end =
          spreadCtx.anchorAt(spreadCtx.spreadIdx.value + 1) ?? layout.endAnchor() ?? start;
        return {
          start: { chapter: activeChapter.value, ...start },
          end: { chapter: activeChapter.value, ...end },
        };
      },
      setOptions: (partial: Partial<BookOptions>) => setOptions(partial),
      subscribe: <E extends EventName>(event: E, listener: MejiroReaderEventMap[E]) => {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        // biome-ignore lint/suspicious/noExplicitAny: payload type narrows on emit
        set.add(listener as (payload: any) => void);
        return () => {
          // biome-ignore lint/suspicious/noExplicitAny: see above
          listeners.get(event)?.delete(listener as (payload: any) => void);
        };
      },
    } satisfies MejiroReaderHandle);

    function patchSettings(next: EditableSettings): void {
      // Fire-and-forget: the application is coalesced and a failure is emitted
      // as `error` by `useMejiroBook`, so this promise never rejects.
      void setOptions(next);
    }

    const editable = computed<EditableSettings>(() => ({
      fontFamily: options.value.fontFamily,
      fontSize: options.value.fontSize,
      lineSpacing: options.value.lineSpacing ?? 1.8,
      mode: options.value.mode ?? 'strict',
      enableHanging: options.value.enableHanging ?? true,
    }));

    /**
     * Settings region. A host can fully replace the built-in controls with the
     * `settings` slot (external injection) while keeping the panel chrome and
     * its open/close accordion — the slot receives the live `settings`, an
     * `update(partial)` patcher that re-flows the book, and the `open` /
     * `toggle` panel state. With no slot, the built-in {@link MejiroSettingsPanel}
     * is rendered. Either way the header "Settings" button toggles it.
     */
    function renderSettings(): VNode {
      if (slots.settings) {
        return h(
          'div',
          { class: ['mejiro-reader-settings-panel', { 'is-open': settingsOpen.value }] },
          h(
            'div',
            { class: 'mejiro-reader-settings-inner' },
            h(
              'div',
              { class: 'mejiro-reader-settings-content' },
              slots.settings({
                settings: editable.value,
                update: patchSettings,
                open: settingsOpen.value,
                toggle: toggleSettings,
              }),
            ),
          ),
        );
      }
      return h(MejiroSettingsPanel, {
        open: settingsOpen.value,
        settings: editable.value,
        fonts: props.fonts ?? undefined,
        'onUpdate:settings': patchSettings,
      });
    }

    const fontLabel = computed(() => {
      const css = normalizeFontFamily(options.value.fontFamily);
      const f = props.fonts?.find((x) => x.value === css);
      const name = f?.label ?? css;
      return `${name} ${options.value.fontSize}px`;
    });

    const runningTitleRight = computed(() => {
      const b = epub.epub.value;
      if (!b) return '';
      return b.author ? `${b.author}  ${b.title}` : b.title;
    });

    const runningTitleLeft = computed(
      () => epub.epub.value?.chapters[activeChapter.value]?.title ?? '',
    );

    function renderHeader(): VNode | VNode[] | null {
      if (!effEnableHeader.value) return null;
      if (slots.header) return slots.header() as VNode | VNode[];

      const subtitleText = props.subtitle ?? resolvedMessages.value.logoSubtitle;
      const defaultLogo = h('div', { class: 'mejiro-reader-logo' }, [
        h('span', { class: 'mejiro-reader-logo-mark' }, props.title),
        subtitleText ? h('span', { class: 'mejiro-reader-logo-sub' }, subtitleText) : null,
      ]);
      const leftChildren: (VNode | VNode[] | null)[] = [
        slots.logo ? (slots.logo() as VNode | VNode[]) : defaultLogo,
        epub.epub.value &&
        effEnableChapterNav.value &&
        (props.chapterNavMode === 'select' || props.chapterNavMode === 'both')
          ? h(MejiroChapterNav, {
              epub: epub.epub.value as EpubBook,
              chapter: activeChapter.value,
              'onUpdate:chapter': setChapter,
            })
          : null,
      ];

      const actionChildren: (VNode | null)[] = [
        effEnableStats.value
          ? h(MejiroStats, {
              chapter: epub.epub.value?.chapters[activeChapter.value] ?? null,
              totalPages: spreadCtx.totalPages.value,
              elapsedMs: layoutCtx.elapsedMs.value,
              fontLabel: fontLabel.value,
            })
          : null,
        filePicker.value
          ? h(
              'button',
              {
                type: 'button',
                class: 'mejiro-reader-btn',
                onClick: () => fileInputEl.value?.click(),
              },
              resolvedMessages.value.openButton,
            )
          : null,
        props.enableImageOverlay && epub.epub.value
          ? h(
              'button',
              {
                type: 'button',
                class: ['mejiro-reader-btn', { 'is-active': imageCtx.hasImages.value }],
                onClick: () =>
                  imageCtx.addImage(
                    singlePageImagePlacement(
                      props.mode === 'paginated' ? spreadCtx.singleSide.value : null,
                      layoutCtx.pageWidth.value,
                    ),
                  ),
              },
              resolvedMessages.value.imageButton,
            )
          : null,
        effEnableSettings.value
          ? h(
              'button',
              {
                type: 'button',
                class: ['mejiro-reader-btn', { 'is-active': settingsOpen.value }],
                onClick: toggleSettings,
              },
              [
                resolvedMessages.value.settingsButton,
                h('span', { class: 'mejiro-reader-btn-arrow' }, '▾'),
              ],
            )
          : null,
      ];

      return h('header', { class: 'mejiro-reader-header' }, [
        h('div', { class: 'mejiro-reader-header-left' }, leftChildren),
        h('div', { class: 'mejiro-reader-header-actions' }, actionChildren),
      ]);
    }

    function renderBody(): VNode {
      const e = epub.epub.value;
      const layoutReady =
        e && layoutCtx.layout.value && spreadCtx.spread.value && layoutCtx.pageWidth.value > 0;

      const children: (VNode | null)[] = [];

      if (!(e || epub.loading.value) && filePicker.value) {
        if (slots.dropZone) {
          const rendered = slots.dropZone({ load: epub.loadFile });
          if (Array.isArray(rendered)) children.push(...rendered);
          else if (rendered) children.push(rendered as VNode);
        } else {
          children.push(h(MejiroDropZone, { onFile: (f: File) => void epub.loadFile(f) }));
        }
      }
      if (!layoutReady && (slots.fallback || props.fallbackHtml)) {
        if (slots.fallback) {
          const rendered = slots.fallback();
          if (Array.isArray(rendered)) {
            children.push(h('div', { class: 'mejiro-reader-fallback' }, rendered));
          } else if (rendered) {
            children.push(h('div', { class: 'mejiro-reader-fallback' }, [rendered as VNode]));
          }
        } else if (props.fallbackHtml) {
          children.push(
            h('div', {
              class: 'mejiro-reader-fallback',
              innerHTML: props.fallbackHtml,
            }),
          );
        }
      }
      if (epub.loading.value) {
        if (slots.loading) {
          const rendered = slots.loading();
          if (Array.isArray(rendered)) children.push(...rendered);
          else if (rendered) children.push(rendered as VNode);
        } else {
          children.push(
            h('div', { class: 'mejiro-reader-loading' }, resolvedMessages.value.loading),
          );
        }
      }
      if (layoutReady && props.mode === 'scroll' && layoutCtx.layout.value) {
        children.push(
          h(MejiroScrollView, {
            layout: layoutCtx.layout.value,
            pageWidth: layoutCtx.pageWidth.value,
            pageHeight: layoutCtx.pageHeight.value,
            contentHeight: layoutCtx.contentHeight.value,
            fontFamily: options.value.fontFamily,
            fontSize: options.value.fontSize,
            lineSpacing: options.value.lineSpacing,
            scrollToPage: scrollTargetPage(
              {
                spreadIdx: spreadCtx.spreadIdx.value,
                firstPage: spreadCtx.firstPage.value,
                indexOfPage: spreadCtx.indexOfPage,
              },
              userScroll.value?.layout === layoutCtx.layout.value ? userScroll.value.page : null,
            ),
            onVisiblePageChange: (pageIdx: number, source: 'user' | 'programmatic') => {
              // Ignore the scroll the view performed on our behalf, otherwise
              // it feeds straight back into another `scrollToPage` request.
              if (source === 'programmatic') return;
              const layout = layoutCtx.layout.value;
              if (layout) userScroll.value = { layout, page: pageIdx };
              const target = spreadCtx.indexOfPage(pageIdx);
              if (target !== spreadCtx.spreadIdx.value) spreadCtx.setSpread(target);
            },
            selectionRects: annotationRects.value.length ? annotationRects.value : undefined,
            spreadIdx: spreadCtx.layoutSpreadIdx.value,
            images: imageCtx.currentImages.value,
            onImagePointerdown: (id: string, ev: PointerEvent) =>
              imageCtx.onOverlayPointerDown(id, ev),
            onImageResizePointerdown: (id: string, ev: PointerEvent) =>
              imageCtx.onResizePointerDown(id, ev),
            onImageClose: (id: string) => imageCtx.removeImage(id),
          }),
        );
      } else if (layoutReady && spreadCtx.spread.value) {
        const spread = spreadCtx.spread.value;
        const currentSpread = spreadCtx.layoutSpreadIdx.value;
        const rightPage = currentSpread * 2 + 1;
        const leftPage = currentSpread * 2 + 2;
        const showLeft = leftPage <= spread.totalPages;
        const showRightNum = props.pageNumbers === 'both' || props.pageNumbers === 'right';
        const showLeftNum = props.pageNumbers === 'both' || props.pageNumbers === 'left';
        children.push(
          h(
            MejiroSpread,
            {
              key: `${activeChapter.value}-${spreadCtx.spreadIdx.value}-${layoutCtx.pageWidth.value}x${layoutCtx.pageHeight.value}`,
              spread,
              pageWidth: layoutCtx.pageWidth.value,
              pageHeight: layoutCtx.pageHeight.value,
              contentHeight: layoutCtx.contentHeight.value,
              fontFamily: options.value.fontFamily,
              fontSize: options.value.fontSize,
              lineSpacing: options.value.lineSpacing,
              turning: spreadCtx.turning.value,
              singlePage: effectiveSingle.value,
              singleSide: spreadCtx.singleSide.value ?? undefined,
              rightHeader: {
                title: runningTitleRight.value,
                pageNumber: showRightNum ? rightPage : null,
              },
              leftHeader: {
                title: runningTitleLeft.value,
                pageNumber: showLeft && showLeftNum ? leftPage : null,
              },
              images: imageCtx.currentImages.value,
              onPrev: () => spreadCtx.prev(),
              onNext: () => spreadCtx.next(),
              onSwipe: (dir: 'next' | 'prev') =>
                dir === 'next' ? spreadCtx.next() : spreadCtx.prev(),
              onSurfaceTap: props.enableSurfaceTap
                ? () => {
                    chromeHidden.value = !chromeHidden.value;
                  }
                : undefined,
              onImagePointerdown: (id: string, ev: PointerEvent) =>
                imageCtx.onOverlayPointerDown(id, ev),
              onImageResizePointerdown: (id: string, ev: PointerEvent) =>
                imageCtx.onResizePointerDown(id, ev),
              onImageClose: (id: string) => imageCtx.removeImage(id),
              spreadIdx: spreadCtx.layoutSpreadIdx.value,
              selectionRects: annotationRects.value.length ? annotationRects.value : undefined,
            },
            {
              indicator: () =>
                effEnablePageIndicator.value
                  ? h(MejiroPageIndicator, {
                      current: spreadCtx.spreadIdx.value + 1,
                      total: spreadCtx.totalSpreads.value,
                    })
                  : null,
            },
          ),
        );
      }

      return h('div', { class: 'mejiro-reader-surface', ref: surfaceEl }, children);
    }

    const fileInputEl = ref<HTMLInputElement | null>(null);

    const themeName = computed<MejiroThemeName>(() =>
      typeof props.theme === 'string' ? props.theme : props.theme.name,
    );
    const themeStyle = computed<Record<string, string> | undefined>(() => {
      const override = typeof props.theme === 'string' ? undefined : props.theme.override;
      // Keep the page's *visual* padding (CSS vars) in sync with the *layout*
      // padding (`pageGeometry.padding`). Without this the text is laid out for
      // one inset but clipped at another, so a custom padding overflows the page.
      const pad = props.pageGeometry?.padding;
      const padVars: Record<string, string> = {};
      if (pad?.x != null) padVars['--mejiro-page-pad-x'] = `${pad.x}px`;
      if (pad?.y != null) padVars['--mejiro-page-pad-y'] = `${pad.y}px`;
      if (pad?.bottom != null) padVars['--mejiro-page-pad-bottom'] = `${pad.bottom}px`;
      // In `fit="width"` the surface self-sizes from this aspect ratio.
      if (props.fit === 'width') padVars['--mejiro-surface-aspect'] = surfaceAspect.value;
      const hasPad = Object.keys(padVars).length > 0;
      if (!(override || hasPad)) return undefined;
      return { ...override, ...padVars };
    });

    return () => {
      return h(
        MejiroI18nProvider,
        { messages: resolvedMessages.value },
        {
          default: () =>
            h(
              'div',
              {
                class: [
                  'mejiro-reader',
                  {
                    'mejiro-reader--chrome-hidden': chromeHidden.value,
                    'mejiro-reader--fit-width': props.fit === 'width',
                  },
                ],
                'data-mejiro-theme': themeName.value,
                style: themeStyle.value,
              },
              [
                renderHeader(),
                effEnableSettings.value ? renderSettings() : null,
                h(
                  'div',
                  {
                    class: [
                      'mejiro-reader-body',
                      {
                        'has-chapter-panel':
                          epub.epub.value &&
                          effEnableChapterNav.value &&
                          (props.chapterNavMode === 'panel' || props.chapterNavMode === 'both'),
                      },
                    ],
                  },
                  [
                    epub.epub.value &&
                    effEnableChapterNav.value &&
                    (props.chapterNavMode === 'panel' || props.chapterNavMode === 'both')
                      ? h(MejiroChapterNav, {
                          epub: epub.epub.value,
                          chapter: activeChapter.value,
                          variant: 'panel',
                          'onUpdate:chapter': setChapter,
                        })
                      : null,
                    renderBody(),
                  ],
                ),
                // Hidden file input for the header "Open" button.
                h('input', {
                  ref: fileInputEl,
                  type: 'file',
                  accept: '.epub',
                  hidden: true,
                  onChange: (e: Event) => {
                    const target = e.target as HTMLInputElement;
                    const file = target.files?.[0];
                    // Cleared so picking the same file again still fires `change`.
                    target.value = '';
                    if (file) void epub.loadFile(file);
                  },
                }),
                h(
                  'div',
                  { class: 'mejiro-reader-sr-only', role: 'status', 'aria-live': 'polite' },
                  spreadCtx.totalSpreads.value > 0
                    ? formatMessage(resolvedMessages.value.spreadAnnouncement, {
                        spread: spreadCtx.spreadIdx.value + 1,
                        total: spreadCtx.totalSpreads.value,
                      })
                    : '',
                ),
              ],
            ),
        },
      );
    };
  },
});

/** Props accepted by {@link MejiroReader}. */
export type MejiroReaderProps = InstanceType<typeof MejiroReader>['$props'];
