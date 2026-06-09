import type {
  BookOptions,
  ChapterLayout,
  ComputePageSizeOptions,
  InChapterAnchor,
  ManuscriptChapter,
  ReadingAnchor,
} from '@libraz/mejiro/book';
import { DEFAULT_BOOK_OPTIONS, DEFAULT_PAGE_GEOMETRY } from '@libraz/mejiro/book';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import type { EpubBook, ManuscriptDialect } from '@libraz/mejiro/epub';
import { manuscriptToEpubBook } from '@libraz/mejiro/epub';
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  type VNode,
  watch,
} from 'vue';
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
import { useChapterLayout } from './useChapterLayout.js';
import { useEpub } from './useEpub.js';
import { useMejiroBook } from './useMejiroBook.js';
import { useMultiImageOverlay } from './useMultiImageOverlay.js';
import { useSpread } from './useSpread.js';

export type MejiroChapterNavMode = 'select' | 'panel' | 'both' | 'none';

/**
 * Reading-flow mode for {@link MejiroReader}.
 * - `paginated` — two-page spread with page-turn animation (default).
 * - `scroll` — every page in the chapter stacked in a vertical scroll view.
 */
export type MejiroReaderMode = 'paginated' | 'scroll';

/**
 * Two-page vs single-page rendering of a spread.
 * - `double` — always render two pages (default).
 * - `single` — render only the right page, centered.
 * - `auto` — switch based on the surface aspect ratio (single when portrait).
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
  chapter: number;
  spreadIdx: number;
  totalPages: number;
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

/** Imperative handle exposed via `ref` on {@link MejiroReader}. */
export interface MejiroReaderHandle {
  /** Jump to a specific spread (0-based, clamped to [0, totalSpreads − 1]). */
  goToSpread(index: number): void;
  /** Advance one spread forward. */
  next(): void;
  /** Go back one spread. */
  prev(): void;
  /** Jump to a chapter (resets spread index to 0). */
  goToChapter(index: number): void;
  /** Read the current reading position. */
  getReadingPosition(): ReadingPosition;
  /**
   * Navigate to a {@link ReadingAnchor}. If the chapter differs from the
   * current one, the chapter is switched first; once the new layout is ready
   * the anchor is resolved and the matching spread is opened.
   */
  /**
   * Navigate to a {@link ReadingAnchor}. If the chapter differs from the
   * current one, the chapter is switched first; once the new layout is
   * ready the anchor is resolved and the matching spread is opened.
   *
   * Returns a promise that resolves once the spread has been applied. If
   * another `goToAnchor` is invoked before the previous one settles, the
   * earlier promise resolves immediately (superseded). Resolves on unmount.
   */
  goToAnchor(anchor: ReadingAnchor): Promise<void>;
  /**
   * Returns the {@link ReadingAnchor} at the start of the current spread,
   * or `null` if the layout is not ready.
   */
  getAnchor(): ReadingAnchor | null;
  /**
   * Returns the half-open range of {@link ReadingAnchor}s visible on the
   * current spread. `end` points at the start of the next spread (or the end
   * of the chapter for the last spread).
   */
  getVisibleRange(): { start: ReadingAnchor; end: ReadingAnchor } | null;
  /**
   * Updates book options at runtime. Same shape as {@link MejiroBook.setOptions}
   * — font / size changes re-measure and re-layout asynchronously.
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
     */
    options: {
      type: Object as PropType<Partial<BookOptions>>,
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
     * value and emits `spread-idx-change` on user navigation. Combine with
     * `useReadingPosition` for save/restore.
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
     * Spread layout. `double` renders two pages (default); `single` renders
     * only the right page; `auto` flips to `single` for portrait viewports.
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
     * accepted as a `fallback` slot for richer Vue content.
     */
    fallbackHtml: { type: String, default: undefined },
    /**
     * Extra options merged into the EPUB `fetch` call (URL mode). Useful
     * for sending bearer tokens or cookies.
     */
    fetchOptions: { type: Object as PropType<RequestInit>, default: undefined },
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
     * rectangles via `ChapterLayout.selectionRects` and drawn on top of the
     * page content.
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

    onMounted(() => {
      if (props.spreadMode !== 'auto') return;
      updateAutoSingle();
      if (typeof ResizeObserver === 'undefined') return;
      const surface = surfaceEl.value;
      if (!surface) return;
      resizeObserver = new ResizeObserver(updateAutoSingle);
      resizeObserver.observe(surface);
    });
    onBeforeUnmount(() => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    });
    watch(
      () => props.spreadMode,
      (next) => {
        if (next === 'auto') updateAutoSingle();
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
      if (props.fit !== 'width') return { columns, ...props.pageGeometry };
      return {
        columns,
        gutterOffset: 0,
        headerOffset: 0,
        maxHeight: Number.POSITIVE_INFINITY,
        minWidth: 0,
        minHeight: 0,
        ...props.pageGeometry,
      };
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
      return props.messages ? { ...base, ...props.messages } : base;
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
    const resolvedOptions = computed<BookOptions>(() => ({
      ...DEFAULT_BOOK_OPTIONS,
      ...props.options,
    }));
    const { book, options, setOptions } = useMejiroBook(resolvedOptions.value, resolvedOptions);

    const synthesizedEpub = computed<EpubBook | null>(() => {
      if (props.manuscript === undefined) return null;
      return manuscriptToEpubBook(props.manuscript, { dialect: props.dialect });
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
      get fetchEpub() {
        return props.fetchEpub;
      },
      onLoad: (b) => {
        if (props.chapter == null) chapter.value = 0;
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

    const activeChapter = computed(() => props.chapter ?? chapter.value);

    // Bridge between the layout and spread composables: a reflow re-layout
    // produces a new layout object (which resets the spread index to 0), so
    // capture the reading anchor beforehand and restore it afterwards — but only
    // in uncontrolled mode. When `spreadIdx` is controlled the host owns the
    // position, so the controlled-restore watch below handles it instead.
    const positionBridge = {
      capture(layout: ChapterLayout): InChapterAnchor | null {
        if (props.spreadIdx != null) return null;
        return layout.anchorAt(spreadCtx.spreadIdx.value, 'right');
      },
      restore(layout: ChapterLayout, anchor: InChapterAnchor): void {
        const loc = layout.locateAnchor(anchor);
        spreadCtx.setSpread(loc?.spreadIdx ?? 0);
      },
    };

    const layoutCtx = useChapterLayout(book, epub.epub, activeChapter, surfaceEl, {
      pageGeometry: () => resolvedGeometry.value,
      capturePosition: (layout) => positionBridge.capture(layout),
      restorePosition: (layout, anchor) => positionBridge.restore(layout, anchor),
    });

    // Re-flow when the resolved page geometry changes at runtime (covers both
    // host `pageGeometry` edits and `fit`-driven offset changes).
    watch(resolvedGeometry, () => void layoutCtx.recompute({ blank: false }), { deep: true });

    // Re-flow when metric-affecting options change at runtime. `useMejiroBook`
    // keeps the book + reactive snapshot in sync, but an options change does not
    // otherwise re-run layout, so the settings-panel font / line-spacing /
    // kinsoku controls would only restyle the wrapper while the typeset content
    // stayed frozen. Debounced so dragging a continuous control (font-size /
    // line-spacing slider) coalesces into a single re-flow instead of laying out
    // the chapter on every step; `book.setOptions` is awaited first so the
    // re-layout sees the current metrics.
    let optionsReflowTimer: ReturnType<typeof setTimeout> | null = null;
    watch(
      () => {
        const o = options.value;
        return [o.fontFamily, o.fontSize, o.lineSpacing, o.mode, o.enableHanging].join('|');
      },
      () => {
        if (optionsReflowTimer) clearTimeout(optionsReflowTimer);
        optionsReflowTimer = setTimeout(() => {
          optionsReflowTimer = null;
          void (async () => {
            await book.setOptions({ ...options.value });
            await layoutCtx.recompute({ blank: false });
          })();
        }, 60);
      },
    );
    onBeforeUnmount(() => {
      if (optionsReflowTimer) clearTimeout(optionsReflowTimer);
    });

    const spreadCtx = useSpread(layoutCtx.layout, {
      enableKeyboard: props.enableKeyboard,
      onChange: (i) => {
        emit('spread-change', i);
        emit('spread-idx-change', i);
      },
    });

    const imageCtx = useMultiImageOverlay(layoutCtx.layout, spreadCtx.spreadIdx, {
      onUpdate: () => spreadCtx.refresh(),
    });

    const annotationRects = computed(() => {
      const layout = layoutCtx.layout.value;
      const list = props.annotations;
      if (!(list && layout)) return [];
      const result = [];
      for (const annotation of list) {
        if (annotation.chapter !== activeChapter.value) continue;
        const rects = layout.selectionRects({
          start: annotation.start,
          end: annotation.end,
        });
        for (const rect of rects) result.push(rect);
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

    function setChapter(i: number): void {
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

    interface PendingAnchor {
      anchor: ReadingAnchor;
      resolve: () => void;
    }
    let pendingAnchor: PendingAnchor | null = null;
    function tryApplyPendingAnchor(): void {
      const pending = pendingAnchor;
      if (!pending) return;
      if (pending.anchor.chapter !== activeChapter.value) return;
      const layout = layoutCtx.layout.value;
      if (!layout) return;
      const loc = layout.locateAnchor({
        paragraph: pending.anchor.paragraph,
        charIndex: pending.anchor.charIndex,
      });
      if (!loc) return;
      pendingAnchor = null;
      spreadCtx.goTo(loc.spreadIdx);
      pending.resolve();
    }
    watch([() => layoutCtx.layout.value, activeChapter], () => tryApplyPendingAnchor());
    onBeforeUnmount(() => {
      // Resolve any in-flight anchor so awaiting callers never hang.
      pendingAnchor?.resolve();
      pendingAnchor = null;
    });

    // Emit spreadChanged whenever spreadIdx (or chapter) changes, after mount.
    // Also fires page-read with the dwell of the spread we are leaving, and
    // chapter-completed on reaching the last spread of the chapter.
    let mounted = false;
    let dwell: { anchor: ReadingAnchor; ts: number } | null = null;
    watch([() => spreadCtx.spreadIdx.value, activeChapter], ([newSpread]) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (mounted && dwell) {
        emit('page-read', dwell.anchor, now - dwell.ts);
      }
      const layout = layoutCtx.layout.value;
      if (layout) {
        const inCh = layout.anchorAt(newSpread, 'right');
        dwell = inCh ? { anchor: { chapter: activeChapter.value, ...inCh }, ts: now } : null;
      } else {
        dwell = null;
      }
      if (!mounted) {
        mounted = true;
        return;
      }
      emitReaderEvent('spreadChanged', {
        chapter: activeChapter.value,
        spreadIdx: newSpread,
      });
      const total = spreadCtx.totalSpreads.value;
      if (total > 0 && newSpread === total - 1) {
        emitReaderEvent('chapterFinished', { chapter: activeChapter.value });
        emit('chapter-completed', activeChapter.value);
      }
    });

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
      goToAnchor: (anchor: ReadingAnchor) =>
        new Promise<void>((resolve) => {
          // Supersede any previous pending anchor — resolve so the caller
          // does not hang. The new request takes over.
          pendingAnchor?.resolve();
          pendingAnchor = { anchor, resolve };
          if (anchor.chapter !== activeChapter.value) setChapter(anchor.chapter);
          tryApplyPendingAnchor();
        }),
      getAnchor: () => {
        const layout = layoutCtx.layout.value;
        if (!layout) return null;
        const inCh = layout.anchorAt(spreadCtx.spreadIdx.value, 'right');
        return inCh ? { chapter: activeChapter.value, ...inCh } : null;
      },
      getVisibleRange: () => {
        const layout = layoutCtx.layout.value;
        if (!layout) return null;
        const start = layout.anchorAt(spreadCtx.spreadIdx.value, 'right');
        if (!start) return null;
        const next = layout.anchorAt(spreadCtx.spreadIdx.value + 1, 'right');
        let end: { paragraph: number; charIndex: number };
        if (next) {
          end = next;
        } else {
          const e = epub.epub.value;
          const ch = e?.chapters[activeChapter.value];
          const lastP = (ch?.paragraphs.length ?? 1) - 1;
          const lastText = ch?.paragraphs[lastP]?.text ?? '';
          end = { paragraph: Math.max(0, lastP), charIndex: [...lastText].length };
        }
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
      setOptions(next);
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
              totalPages: layoutCtx.layout.value?.totalPages ?? 0,
              elapsedMs: layoutCtx.elapsedMs.value,
              fontLabel: fontLabel.value,
            })
          : null,
        props.enableDropZone
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
                onClick: () => imageCtx.addImage(),
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

      if (!(e || epub.loading.value) && props.enableDropZone) {
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
            scrollToPage: spreadCtx.spreadIdx.value * 2,
            onVisiblePageChange: (pageIdx: number) => {
              const target = Math.floor(pageIdx / 2);
              if (target !== spreadCtx.spreadIdx.value) spreadCtx.goTo(target);
            },
          }),
        );
      } else if (layoutReady && spreadCtx.spread.value) {
        const spread = spreadCtx.spread.value;
        const currentSpread = spreadCtx.spreadIdx.value;
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
                    const file = (e.target as HTMLInputElement).files?.[0];
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

export type MejiroReaderProps = InstanceType<typeof MejiroReader>['$props'];
