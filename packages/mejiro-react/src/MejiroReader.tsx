// biome-ignore-all lint/correctness/useHookAtTopLevel: MejiroReaderInner is a React forwardRef render function.
import type {
  BookOptions,
  ComputePageSizeOptions,
  InChapterAnchor,
  ManuscriptChapter,
  ReadingAnchor,
} from '@libraz/mejiro/book';
import { DEFAULT_BOOK_OPTIONS, DEFAULT_PAGE_GEOMETRY } from '@libraz/mejiro/book';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import type { EpubBook, EpubParseLimits, ManuscriptDialect } from '@libraz/mejiro/epub';
import { manuscriptToEpubBook } from '@libraz/mejiro/epub';
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  format as formatMessage,
  MejiroI18nProvider,
  type MejiroLocale,
  type MejiroMessages,
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
 * Window (ms) used to coalesce runtime option changes before they reach the
 * book and trigger a re-flow. Continuous controls (font-size / line-spacing)
 * emit one change per step; without this every step would cost a font load,
 * a full re-measurement and a re-layout.
 */
const OPTIONS_DEBOUNCE_MS = 60;

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

/** Imperative handle returned by `ref={...}` on {@link MejiroReader}. */
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
   *
   * Successive calls are coalesced into a single application; the returned
   * promise resolves once that application has settled. A failed application
   * (typically a font that could not be loaded) is reported through
   * {@link MejiroReaderProps.onError} rather than rejecting the promise.
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
 * Context passed to a {@link MejiroReaderCommonProps.renderSettings} render prop.
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
  /** Toggles the settings panel open/closed (same as the header button). */
  toggle: () => void;
}

/** Props shared across every {@link MejiroReader} source mode. */
export interface MejiroReaderCommonProps {
  /**
   * Initial book options. Optional — defaults to {@link DEFAULT_BOOK_OPTIONS}
   * (`serif` 16px, line spacing 1.8, strict kinsoku, hanging punctuation on).
   * Spread the defaults to tweak only a few:
   *
   * ```ts
   * { ...DEFAULT_BOOK_OPTIONS, fontFamily: '"Noto Serif JP"', fontSize: 18 }
   * ```
   */
  options?: Partial<BookOptions>;
  /**
   * Page-geometry overrides forwarded to `MejiroBook.computePageSize`. Use to
   * tune how the spread is sized inside the surface — most usefully to shrink
   * the reserved margins so the pages fill their frame, e.g.
   * `pageGeometry={{ gutterOffset: 0, headerOffset: 0 }}`. Also accepts
   * `aspect`, `minWidth`, `minHeight`, `maxHeight`, and inner `padding`; omitted
   * fields fall back to the built-in defaults.
   */
  pageGeometry?: ComputePageSizeOptions;
  /** Font choices for the settings panel. */
  fonts?: FontChoice[];
  /**
   * Controlled chapter index. When omitted, the reader manages its own
   * chapter state and resets to 0 on EPUB change.
   */
  chapter?: number;
  /**
   * Controlled spread index. When supplied, the reader is driven by this
   * value and emits {@link MejiroReaderProps.onSpreadIdxChange} on user
   * navigation. Combine with `useReadingPosition` for save/restore.
   */
  spreadIdx?: number;
  /**
   * Visual theme preset, or `{ name, override }` to layer custom
   * CSS variables on top of a preset. @defaultValue 'light'
   *
   * The selected name is reflected as `data-mejiro-theme` on the reader
   * root, which the bundled CSS uses to swap palettes.
   */
  theme?: MejiroTheme;
  /**
   * Reading-flow mode. `paginated` (default) shows one spread at a time;
   * `scroll` stacks every page in the chapter inside a vertical scroller.
   */
  mode?: MejiroReaderMode;
  /**
   * Spread layout. `double` (default) renders two pages; `single` renders
   * only the right page; `auto` flips to `single` for portrait viewports.
   */
  spreadMode?: MejiroSpreadMode;
  /**
   * How the reader sizes itself in its container. `fill` (default) fills the
   * container height and letterboxes the spread; `width` makes the reader
   * self-size — it derives its height from its width and the page aspect, so an
   * embedding host only has to constrain the width (no height/aspect magic
   * numbers, no letterbox). In `width` mode the reserved `gutterOffset` /
   * `headerOffset` default to 0 so the spread fills edge-to-edge; override via
   * {@link MejiroReaderProps.pageGeometry} if you still want them. @defaultValue 'fill'
   */
  fit?: MejiroReaderFit;
  /**
   * Enable surface-tap chrome toggling. Tapping the center of the spread
   * (away from buttons) hides the header and chapter panel; tapping again
   * shows them. @defaultValue true
   */
  enableSurfaceTap?: boolean;
  /**
   * Static fallback rendered while the layout is still hydrating. Pair with
   * {@link renderEpubStatic} to ship server-rendered vertical text that
   * search engines and slow connections can see before the client reader
   * is ready.
   */
  fallback?: ReactNode;
  /**
   * Extra options merged into the EPUB `fetch` call (URL mode). Useful for
   * sending bearer tokens or cookies.
   */
  fetchOptions?: RequestInit;
  /**
   * Resource limits applied while parsing an EPUB the reader loads itself
   * (URL mode and the drop zone / file picker). Untrusted files reach this
   * component directly, so hosts that accept them should tighten the
   * defaults here.
   */
  limits?: EpubParseLimits;
  /**
   * Custom EPUB fetcher used in place of the global `fetch`. Overrides
   * {@link fetchOptions} when set.
   */
  fetchEpub?: (url: string) => Promise<ArrayBuffer>;
  /**
   * Built-in locale for UI strings (`'en'` / `'ja'`). Pair with `messages`
   * to override individual strings. @defaultValue 'en'
   */
  locale?: MejiroLocale;
  /**
   * Partial override of the message catalog. Merged on top of the catalog
   * selected by `locale`. Useful for projects that ship their own UI strings
   * without re-implementing every label.
   */
  messages?: Partial<MejiroMessages>;
  /** Header title text. @defaultValue 'mejiro' */
  title?: string;
  /** Header subtitle. @defaultValue `messages.logoSubtitle` */
  subtitle?: string;
  /**
   * Replaces the default logo block (title + subtitle). Pass `null` to hide
   * the logo while keeping the rest of the header. To remove the entire
   * header, use `enableHeader={false}`.
   */
  logo?: ReactNode;
  /**
   * Shorthand for a chrome-less reader. When `true`, the defaults for
   * `enableHeader`, `enableChapterNav`, `enableSettings`, `enableStats`, and
   * `enablePageIndicator` flip from `true` to `false`. Explicitly-passed
   * enable* props still win, so you can opt parts back in.
   * @defaultValue false
   */
  bare?: boolean;

  /** Show the built-in header. @defaultValue `!bare` */
  enableHeader?: boolean;
  /**
   * Show the drop zone affordance. SaaS-style readers should keep this off
   * (the host controls which EPUB is delivered); set true to accept
   * user-supplied books.
   * @defaultValue false
   */
  enableDropZone?: boolean;
  /** Show the chapter selector in the header. @defaultValue `!bare` */
  enableChapterNav?: boolean;
  /**
   * Where to render the built-in chapter navigation.
   * @defaultValue 'select'
   */
  chapterNavMode?: MejiroChapterNavMode;
  /** Show the settings panel toggle. @defaultValue `!bare` */
  enableSettings?: boolean;
  /**
   * Replaces the built-in settings controls with custom UI while keeping the
   * panel chrome and its open/close accordion. Receives a
   * {@link MejiroReaderSettingsSlot} wired to the live reader, so a host can
   * build its own settings form without a parallel `options` shadow. The header
   * "Settings" button still toggles the panel. `enableSettings` remains the
   * on/off switch.
   */
  renderSettings?: (slot: MejiroReaderSettingsSlot) => ReactNode;
  /** Show the image-overlay editing/demo button. @defaultValue false */
  enableImageOverlay?: boolean;
  /** Show the stats line. @defaultValue `!bare` */
  enableStats?: boolean;
  /** Bind ArrowLeft/ArrowRight to navigation. @defaultValue true */
  enableKeyboard?: boolean;
  /** Show the "n / total" indicator. @defaultValue `!bare` */
  enablePageIndicator?: boolean;
  /**
   * Which page of a spread shows its page number in the running head.
   * `'both'` numbers each page (right = odd, left = even), `'right'` /
   * `'left'` number only that side, `'none'` hides them (the
   * {@link MejiroReaderProps.enablePageIndicator} "n / total" badge is
   * independent). @defaultValue 'both'
   */
  pageNumbers?: PageNumberDisplay;
  /**
   * Reader-side annotations to render as highlights. Each annotation whose
   * `chapter` matches the current chapter is converted to spread-local
   * rectangles via `ChapterLayout.selectionRects`; the rectangles landing on
   * the spread on screen are drawn on top of the page content. Pair with
   * {@link useAnnotations} for persistence, or pass any shape that satisfies
   * `{ chapter, start, end }`.
   */
  annotations?: ReadonlyArray<{
    chapter: number;
    start: InChapterAnchor;
    end: InChapterAnchor;
    color?: string;
  }>;

  /** Called after a successful EPUB load. */
  onLoad?: (book: EpubBook) => void;
  /**
   * Called when loading or parsing an EPUB fails, and when applying an option
   * change fails (typically a font that could not be loaded).
   */
  onError?: (error: Error) => void;
  /** Called when the chapter index changes. */
  onChapterChange?: (chapter: number) => void;
  /** Called when the spread index changes (alias: `onSpreadIdxChange`). */
  onSpreadChange?: (spreadIdx: number) => void;
  /** Called when the spread index changes — pair with the `spreadIdx` prop for controlled use. */
  onSpreadIdxChange?: (spreadIdx: number) => void;
  /**
   * Called when the reader leaves a spread. Receives the anchor of the
   * spread that was just left and the dwell time in milliseconds (computed
   * via `performance.now()`). Useful for engagement analytics.
   */
  onPageRead?: (anchor: ReadingAnchor, dwellMs: number) => void;
  /**
   * Called when the reader reaches the last spread of a chapter. Same
   * trigger as the `chapterFinished` event on {@link MejiroReaderHandle.subscribe}.
   */
  onChapterCompleted?: (chapter: number) => void;
}

/**
 * Controlled-source variant: render a pre-parsed `EpubBook`. Pass `null`
 * to render an empty reader (e.g. while the book is still loading on the host).
 */
export interface MejiroReaderControlledProps extends MejiroReaderCommonProps {
  /** Pre-parsed EPUB. Cannot be combined with `epubUrl` / `manuscript`. */
  epub: EpubBook | null;
  epubUrl?: never;
  manuscript?: never;
}

/**
 * URL-source variant: the reader fetches and parses the EPUB itself.
 * Use this for "just open this book" scenarios.
 */
export interface MejiroReaderUrlProps extends MejiroReaderCommonProps {
  /** EPUB URL fetched on mount. Cannot be combined with `epub` / `manuscript`. */
  epubUrl: string;
  epub?: never;
  manuscript?: never;
}

/**
 * File-source variant: the reader exposes its drop zone / file picker.
 * Neither `epub` nor `epubUrl` is supplied — useful for free-form viewers
 * that accept user-supplied books.
 */
export interface MejiroReaderFileProps extends MejiroReaderCommonProps {
  epub?: never;
  epubUrl?: never;
  manuscript?: never;
}

/**
 * Manuscript-source variant: render manuscript chapters directly without an
 * EPUB ZIP round-trip. Designed for live preview in custom manuscript editors;
 * each chapter body is split into paragraphs on blank lines and run through
 * {@link parseManuscript} before layout.
 */
export interface MejiroReaderManuscriptProps extends MejiroReaderCommonProps {
  /** Manuscript chapters to render. Cannot be combined with `epub` / `epubUrl`. */
  manuscript: readonly ManuscriptChapter[];
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  epub?: never;
  epubUrl?: never;
}

/**
 * Props for {@link MejiroReader}. Discriminated union of the four source
 * modes — TypeScript prevents passing more than one source at once.
 */
export type MejiroReaderProps =
  | MejiroReaderControlledProps
  | MejiroReaderUrlProps
  | MejiroReaderFileProps
  | MejiroReaderManuscriptProps;

/**
 * Full-page EPUB reader component. Composes all of `@libraz/mejiro-react`
 * into a working reader. Each feature can be opted out via the
 * `enableX` props, or all chrome can be removed at once with `bare`.
 *
 * Accepts a `ref` exposing {@link MejiroReaderHandle} for imperative
 * navigation (`goToSpread`, `next`, `prev`, `goToChapter`,
 * `getReadingPosition`).
 *
 * ```tsx
 * const reader = useRef<MejiroReaderHandle>(null);
 * reader.current?.goToSpread(12);
 * ```
 */
function MejiroReaderInner(
  props: MejiroReaderProps,
  ref: ForwardedRef<MejiroReaderHandle>,
): ReactNode {
  const manuscriptProp = 'manuscript' in props ? props.manuscript : undefined;
  const dialectProp = 'dialect' in props ? props.dialect : undefined;
  const {
    options: optionsProp,
    pageGeometry: pageGeometryProp,
    fonts,
    epub: epubProp,
    epubUrl,
    chapter: chapterProp,
    spreadIdx: spreadIdxProp,
    theme = 'light',
    mode = 'paginated',
    spreadMode = 'double',
    fit = 'fill',
    enableSurfaceTap = true,
    fallback,
    fetchOptions,
    limits,
    fetchEpub: fetchEpubFn,
    locale,
    messages,
    title = 'mejiro',
    subtitle,
    logo,
    bare = false,
    enableHeader = !bare,
    enableDropZone = false,
    enableChapterNav = !bare,
    chapterNavMode = 'select',
    enableSettings = !bare,
    renderSettings,
    enableImageOverlay = false,
    enableStats = !bare,
    enableKeyboard = true,
    enablePageIndicator = !bare,
    pageNumbers = 'both',
    annotations,
    onLoad,
    onError,
    onChapterChange,
    onSpreadChange,
    onSpreadIdxChange,
    onPageRead,
    onChapterCompleted,
  } = props;

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterState, setChapterState] = useState(chapterProp ?? 0);
  const chapterIsUncontrolled = chapterProp == null;
  const chapter = chapterProp ?? chapterState;
  const [chromeHidden, setChromeHidden] = useState(false);
  const [autoSingle, setAutoSingle] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  useEffect(() => {
    if (spreadMode !== 'auto') return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const update = () => {
      const rect = surface.getBoundingClientRect();
      setAutoSingle(rect.width < rect.height);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [spreadMode]);

  const effectiveSingle = spreadMode === 'single' || (spreadMode === 'auto' && autoSingle);

  // Page geometry forwarded to `computePageSize`. In `fit="width"` mode the
  // surface self-sizes its height from its width via `aspect-ratio`, and the
  // book must exactly fill it. The fill-mode safety rails fight that invariant:
  // the reserved gutter / header offsets, the `maxHeight` cap, and the
  // `minWidth` / `minHeight` floors would size the book to something other than
  // the surface, leaving a reserved empty band around the spread. So default
  // them all off here (offsets 0, no clamp) — the spread tracks the surface
  // edge-to-edge. The host can still override any field via `pageGeometry`.
  const resolvedGeometry = useMemo<ComputePageSizeOptions | undefined>(() => {
    // A single-page reader derives its page width from the full container width
    // instead of halving it for a two-page spread (the host can still override
    // `columns` via `pageGeometry`).
    const columns: 1 | 2 = effectiveSingle ? 1 : 2;
    if (fit !== 'width') return { columns, ...pageGeometryProp };
    return {
      columns,
      gutterOffset: 0,
      headerOffset: 0,
      maxHeight: Number.POSITIVE_INFINITY,
      minWidth: 0,
      minHeight: 0,
      ...pageGeometryProp,
    };
  }, [fit, pageGeometryProp, effectiveSingle]);

  // The spread aspect (width / height) used to self-size the surface in
  // `fit="width"` mode: one or two page columns wide, `aspect` tall. Exposed as
  // a CSS `aspect-ratio` value so the browser derives the surface height from
  // its width with no JS measurement feedback loop.
  const surfaceAspect = useMemo(() => {
    const columns = effectiveSingle ? 1 : 2;
    const aspect = resolvedGeometry?.aspect ?? DEFAULT_PAGE_GEOMETRY.aspect;
    return `${columns} / ${aspect}`;
  }, [effectiveSingle, resolvedGeometry]);

  const resolvedOptions = useMemo<BookOptions>(
    () => ({ ...DEFAULT_BOOK_OPTIONS, ...(optionsProp ?? {}) }),
    [optionsProp],
  );

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const reportError = useCallback((error: Error) => onErrorRef.current?.(error), []);

  // Option changes are coalesced before they reach the book: the settings panel
  // emits one per keystroke / slider step, and every metric change costs a font
  // load plus a full re-measurement. Failures surface through `onError` instead
  // of an unhandled rejection, since most call sites here are fire-and-forget.
  const {
    book,
    options: bookOptions,
    setOptions,
  } = useMejiroBook(resolvedOptions, {
    debounceMs: OPTIONS_DEBOUNCE_MS,
    onError: reportError,
  });

  // Sync the `options` prop only when its *value* changes. The prop supplies the
  // initial options, so a parent re-render that hands over a new but equal
  // object (an inline literal, typically) must not roll back runtime changes
  // made through `setOptions` or the settings panel.
  const optionsPropKey = JSON.stringify(resolvedOptions);
  const syncedOptionsPropKeyRef = useRef(optionsPropKey);
  const resolvedOptionsRef = useRef(resolvedOptions);
  resolvedOptionsRef.current = resolvedOptions;
  useEffect(() => {
    if (syncedOptionsPropKeyRef.current === optionsPropKey) return;
    syncedOptionsPropKeyRef.current = optionsPropKey;
    void setOptions(resolvedOptionsRef.current);
  }, [optionsPropKey, setOptions]);

  const synthesizedEpub = useMemo<EpubBook | null>(() => {
    if (manuscriptProp === undefined) return null;
    return manuscriptToEpubBook(manuscriptProp, { dialect: dialectProp });
  }, [manuscriptProp, dialectProp]);

  const epubCtx = useEpub({
    // `epub` / `manuscript` take precedence: skip the URL fetch when a parsed
    // book (or a synthesized manuscript book) is supplied.
    defaultUrl: epubProp !== undefined || manuscriptProp !== undefined ? undefined : epubUrl,
    fetchOptions,
    limits,
    fetchEpub: fetchEpubFn,
    onLoad: (b) => {
      if (chapterProp == null) setChapterState(0);
      onLoad?.(b);
    },
  });

  const controlled = epubProp !== undefined || manuscriptProp !== undefined;
  const isManuscriptSource = manuscriptProp !== undefined;
  const e = isManuscriptSource ? synthesizedEpub : controlled ? (epubProp ?? null) : epubCtx.epub;

  useEffect(() => {
    if (epubCtx.error) onErrorRef.current?.(epubCtx.error);
  }, [epubCtx.error]);

  // Refs that let the (stable) layout-composable callbacks read the latest
  // geometry and spread index without re-creating `recompute`.
  const pageGeometryRef = useRef(resolvedGeometry);
  pageGeometryRef.current = resolvedGeometry;
  const curSpreadIdxRef = useRef(0);
  const spreadIdxPropRef = useRef(spreadIdxProp);
  spreadIdxPropRef.current = spreadIdxProp;

  const layoutCtx = useChapterLayout(book, e, chapter, surfaceRef, {
    pageGeometry: () => pageGeometryRef.current,
    // Preserve the reading position across a reflow re-layout (size / option
    // changes), but only in uncontrolled mode — when `spreadIdx` is controlled
    // the host owns the position and the controlled-restore effect handles it.
    capturePosition: (layout) =>
      spreadIdxPropRef.current != null ? null : layout.anchorAt(curSpreadIdxRef.current, 'right'),
  });

  const spreadChangedRef = useRef<((i: number) => void) | undefined>(undefined);
  spreadChangedRef.current = (i: number) => {
    onSpreadChange?.(i);
    onSpreadIdxChange?.(i);
  };
  const spreadCtx = useSpread(layoutCtx.layout, {
    enableKeyboard,
    onChange: (i) => spreadChangedRef.current?.(i),
  });
  curSpreadIdxRef.current = spreadCtx.spreadIdx;

  // Restore the reading position after a reflow re-layout. This runs *after*
  // useSpread's own layout effect has reset the index to 0 (useSpread is called
  // above, so its effect is registered first), so the anchor-derived index wins.
  const setSpreadRef = useRef(spreadCtx.setSpread);
  setSpreadRef.current = spreadCtx.setSpread;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the layout object; refs hold the latest callbacks.
  useLayoutEffect(() => {
    const anchor = layoutCtx.pendingRestore.current;
    if (!(anchor && layoutCtx.layout)) return;
    layoutCtx.pendingRestore.current = null;
    const loc = layoutCtx.layout.locateAnchor(anchor);
    setSpreadRef.current(loc?.spreadIdx ?? 0);
  }, [layoutCtx.layout]);

  // Re-flow when metric-affecting options change at runtime. useMejiroBook keeps
  // the book + snapshot in sync, but an options change does not otherwise re-run
  // layout, so the settings-panel font / line-spacing / kinsoku / hanging
  // controls would only restyle the wrapper while the typeset content stayed
  // frozen. Debounced so dragging a continuous control coalesces into one
  // re-flow; the pending option change is awaited first so the re-layout sees
  // the metrics it will be measured with.
  const optionsKey = [
    bookOptions.fontFamily,
    bookOptions.fontSize,
    bookOptions.lineSpacing,
    bookOptions.mode,
    bookOptions.enableHanging,
  ].join('|');
  const optionsKeyRef = useRef(optionsKey);
  const bookOptionsRef = useRef(bookOptions);
  bookOptionsRef.current = bookOptions;
  const recomputeRef = useRef(layoutCtx.recompute);
  recomputeRef.current = layoutCtx.recompute;
  useEffect(() => {
    // Skip the first run: the initial layout already reflects the initial options.
    if (optionsKeyRef.current === optionsKey) return;
    optionsKeyRef.current = optionsKey;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await setOptions({ ...bookOptionsRef.current });
          await recomputeRef.current({ blank: false });
        } catch (err) {
          reportError(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    }, OPTIONS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [optionsKey, setOptions, reportError]);

  // Re-flow when the resolved page geometry changes at runtime (covers both host
  // `pageGeometry` edits and `fit`-driven offset changes). `pageGeometryRef` is
  // already updated during render, so the re-layout reads the current geometry.
  const geometryKey = JSON.stringify(resolvedGeometry ?? null);
  const geometryKeyRef = useRef(geometryKey);
  useEffect(() => {
    if (geometryKeyRef.current === geometryKey) return;
    geometryKeyRef.current = geometryKey;
    void recomputeRef.current({ blank: false });
  }, [geometryKey]);

  const imageCtx = useMultiImageOverlay(layoutCtx.layout, spreadCtx.spreadIdx, {
    onUpdate: () => spreadCtx.refresh(),
  });

  const annotationRects = useMemo(() => {
    if (!(annotations && layoutCtx.layout)) return [];
    const result = [];
    for (const annotation of annotations) {
      if (annotation.chapter !== chapter) continue;
      const rects = layoutCtx.layout.selectionRects({
        start: annotation.start,
        end: annotation.end,
      });
      // Carry the annotation's color onto every rectangle it produced — the
      // selection layer paints each rectangle from its own `color`.
      for (const rect of rects) result.push({ ...rect, color: annotation.color });
    }
    return result;
  }, [annotations, layoutCtx.layout, chapter]);

  // Controlled mode: render `epub` / `manuscript` directly instead of copying
  // it into the loader state. Copying introduces a render where layout can see
  // the old book with the new chapter index.
  const clearImagesRef = useRef(imageCtx.clearImages);
  clearImagesRef.current = imageCtx.clearImages;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    if (!controlled) return;
    if (chapterIsUncontrolled) setChapterState(0);
    clearImagesRef.current();
    book.clearCache();
    if (e) onLoadRef.current?.(e);
  }, [controlled, e, book, chapterIsUncontrolled]);

  // Controlled spreadIdx → host-driven navigation: animate to the prop value.
  // Every commit is reconciled, not just the ones where the prop value changed:
  // a host that rejects a change (keeping the prop where it was) must see the
  // rendered spread return to the prop value, so the drift is snapped back
  // without a turn animation.
  const spreadGoToRef = useRef(spreadCtx.goTo);
  spreadGoToRef.current = spreadCtx.goTo;
  const appliedSpreadIdxPropRef = useRef(spreadIdxProp);
  useEffect(() => {
    if (spreadIdxProp == null) {
      appliedSpreadIdxPropRef.current = spreadIdxProp;
      return;
    }
    const propChanged = appliedSpreadIdxPropRef.current !== spreadIdxProp;
    appliedSpreadIdxPropRef.current = spreadIdxProp;
    if (spreadCtx.spreadIdx === spreadIdxProp) return;
    if (propChanged) spreadGoToRef.current(spreadIdxProp);
    else setSpreadRef.current(spreadIdxProp);
  }, [spreadIdxProp, spreadCtx.spreadIdx]);

  // Controlled spreadIdx → reflow restore: a re-layout resets useSpread to
  // spread 0, so snap back to the controlled index immediately (no turn
  // animation, which would otherwise flash spread 0 on every resize). Runs after
  // useSpread's reset effect (registered earlier). Keyed on the layout object;
  // refs hold the latest values.
  useLayoutEffect(() => {
    const next = spreadIdxPropRef.current;
    if (next == null || !layoutCtx.layout) return;
    setSpreadRef.current(next);
  }, [layoutCtx.layout]);

  const onChapter = useCallback(
    (i: number) => {
      if (i === chapter) return;
      if (chapterProp == null) setChapterState(i);
      onChapterChange?.(i);
    },
    [chapter, chapterProp, onChapterChange],
  );

  // ── Event bus + anchor handling ──
  type EventName = keyof MejiroReaderEventMap;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous listener payload
  const listenersRef = useRef<Map<EventName, Set<(payload: any) => void>>>(new Map());
  const emit = useCallback(
    <E extends EventName>(event: E, payload: Parameters<MejiroReaderEventMap[E]>[0]): void => {
      const set = listenersRef.current.get(event);
      if (!set) return;
      for (const cb of set) cb(payload);
    },
    [],
  );

  interface PendingAnchor {
    anchor: ReadingAnchor;
    resolve: () => void;
  }
  const pendingAnchorRef = useRef<PendingAnchor | null>(null);
  const layout = layoutCtx.layout;
  const tryApplyPendingAnchor = useCallback(() => {
    const pending = pendingAnchorRef.current;
    if (!pending) return;
    if (pending.anchor.chapter !== chapter) return;
    if (!layout) return;
    const loc = layout.locateAnchor({
      paragraph: pending.anchor.paragraph,
      charIndex: pending.anchor.charIndex,
    });
    if (!loc) return;
    pendingAnchorRef.current = null;
    spreadGoToRef.current(loc.spreadIdx);
    pending.resolve();
  }, [chapter, layout]);
  useEffect(() => {
    tryApplyPendingAnchor();
  }, [tryApplyPendingAnchor]);
  // Resolve any in-flight anchor on unmount so awaiting callers never hang.
  useEffect(
    () => () => {
      pendingAnchorRef.current?.resolve();
      pendingAnchorRef.current = null;
    },
    [],
  );

  // Emit spreadChanged whenever spreadIdx (or chapter) changes, after mount.
  // Also fires the analytics callbacks: onPageRead with the dwell of the spread
  // we are leaving, and onChapterCompleted on reaching the last spread.
  const didMountRef = useRef(false);
  const dwellRef = useRef<{ anchor: ReadingAnchor; ts: number } | null>(null);
  const onPageReadRef = useRef(onPageRead);
  onPageReadRef.current = onPageRead;
  const onChapterCompletedRef = useRef(onChapterCompleted);
  onChapterCompletedRef.current = onChapterCompleted;
  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (didMountRef.current && dwellRef.current) {
      onPageReadRef.current?.(dwellRef.current.anchor, now - dwellRef.current.ts);
    }
    if (layout) {
      const inCh = layout.anchorAt(spreadCtx.spreadIdx, 'right');
      dwellRef.current = inCh ? { anchor: { chapter, ...inCh }, ts: now } : null;
    } else {
      dwellRef.current = null;
    }
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    emit('spreadChanged', { chapter, spreadIdx: spreadCtx.spreadIdx });
    if (spreadCtx.totalSpreads > 0 && spreadCtx.spreadIdx === spreadCtx.totalSpreads - 1) {
      emit('chapterFinished', { chapter });
      onChapterCompletedRef.current?.(chapter);
    }
  }, [chapter, spreadCtx.spreadIdx, spreadCtx.totalSpreads, layout, emit]);

  // Emit turnStart / turnEnd on the `turning` transition.
  const prevTurningRef = useRef(false);
  useEffect(() => {
    if (spreadCtx.turning && !prevTurningRef.current) {
      emit('turnStart', { from: spreadCtx.spreadIdx });
    } else if (!spreadCtx.turning && prevTurningRef.current) {
      emit('turnEnd', { to: spreadCtx.spreadIdx });
    }
    prevTurningRef.current = spreadCtx.turning;
  }, [spreadCtx.turning, spreadCtx.spreadIdx, emit]);

  useImperativeHandle(
    ref,
    () => ({
      goToSpread: (i: number) => spreadGoToRef.current(i),
      next: () => spreadCtx.next(),
      prev: () => spreadCtx.prev(),
      goToChapter: (i: number) => onChapter(i),
      getReadingPosition: () => ({
        chapter,
        spreadIdx: spreadCtx.spreadIdx,
        totalPages: spreadCtx.totalPages,
        totalSpreads: spreadCtx.totalSpreads,
      }),
      goToAnchor: (anchor: ReadingAnchor) =>
        new Promise<void>((resolve) => {
          // Supersede any previous pending anchor — resolve so the caller
          // does not hang. The new request takes over.
          pendingAnchorRef.current?.resolve();
          pendingAnchorRef.current = { anchor, resolve };
          if (anchor.chapter !== chapter) onChapter(anchor.chapter);
          tryApplyPendingAnchor();
        }),
      getAnchor: () => {
        if (!layout) return null;
        const inCh = layout.anchorAt(spreadCtx.spreadIdx, 'right');
        return inCh ? { chapter, ...inCh } : null;
      },
      getVisibleRange: () => {
        if (!layout) return null;
        const start = layout.anchorAt(spreadCtx.spreadIdx, 'right');
        if (!start) return null;
        const next = layout.anchorAt(spreadCtx.spreadIdx + 1, 'right');
        let end: { paragraph: number; charIndex: number };
        if (next) {
          end = next;
        } else {
          const ch = e?.chapters[chapter];
          const lastP = (ch?.paragraphs.length ?? 1) - 1;
          const lastText = ch?.paragraphs[lastP]?.text ?? '';
          end = { paragraph: Math.max(0, lastP), charIndex: [...lastText].length };
        }
        return {
          start: { chapter, ...start },
          end: { chapter, ...end },
        };
      },
      setOptions: (partial: Partial<BookOptions>) => setOptions(partial),
      subscribe: <E extends EventName>(event: E, listener: MejiroReaderEventMap[E]) => {
        let set = listenersRef.current.get(event);
        if (!set) {
          set = new Set();
          listenersRef.current.set(event, set);
        }
        // biome-ignore lint/suspicious/noExplicitAny: payload type narrows on emit
        set.add(listener as (payload: any) => void);
        return () => {
          // biome-ignore lint/suspicious/noExplicitAny: see above
          listenersRef.current.get(event)?.delete(listener as (payload: any) => void);
        };
      },
    }),
    [
      spreadCtx.next,
      spreadCtx.prev,
      spreadCtx.spreadIdx,
      spreadCtx.totalPages,
      spreadCtx.totalSpreads,
      onChapter,
      chapter,
      layout,
      e,
      setOptions,
      tryApplyPendingAnchor,
    ],
  );

  const editable: EditableSettings = {
    fontFamily: bookOptions.fontFamily,
    fontSize: bookOptions.fontSize,
    lineSpacing: bookOptions.lineSpacing ?? 1.8,
    mode: bookOptions.mode ?? 'strict',
    enableHanging: bookOptions.enableHanging ?? true,
  };

  const fontLabel = (() => {
    const css = normalizeFontFamily(bookOptions.fontFamily);
    const f = fonts?.find((x) => x.value === css);
    const name = f?.label ?? css;
    return `${name} ${bookOptions.fontSize}px`;
  })();

  const showChapterSelect =
    e && enableChapterNav && (chapterNavMode === 'select' || chapterNavMode === 'both');
  const showChapterPanel =
    e && enableChapterNav && (chapterNavMode === 'panel' || chapterNavMode === 'both');
  const runningTitleRight = e ? (e.author ? `${e.author}  ${e.title}` : e.title) : '';
  const runningTitleLeft = e?.chapters[chapter]?.title ?? '';
  const layoutReady = e && spreadCtx.spread && layoutCtx.layout && layoutCtx.pageWidth > 0;

  const themeName: MejiroThemeName = typeof theme === 'string' ? theme : theme.name;
  const themeOverride = typeof theme === 'string' ? undefined : theme.override;
  const themeStyle = useMemo<CSSProperties | undefined>(() => {
    // Keep the page's *visual* padding (CSS vars) in sync with the *layout*
    // padding (`pageGeometry.padding`). Without this the text is laid out for
    // one inset but clipped at another, so a custom padding overflows the page.
    const pad = pageGeometryProp?.padding;
    const styleVars: Record<string, string> = {};
    if (pad?.x != null) styleVars['--mejiro-page-pad-x'] = `${pad.x}px`;
    if (pad?.y != null) styleVars['--mejiro-page-pad-y'] = `${pad.y}px`;
    if (pad?.bottom != null) styleVars['--mejiro-page-pad-bottom'] = `${pad.bottom}px`;
    // In `fit="width"` the surface self-sizes from this aspect ratio.
    if (fit === 'width') styleVars['--mejiro-surface-aspect'] = surfaceAspect;
    const hasVars = Object.keys(styleVars).length > 0;
    if (!(themeOverride || hasVars)) return undefined;
    return { ...themeOverride, ...styleVars } as CSSProperties;
  }, [themeOverride, pageGeometryProp, fit, surfaceAspect]);

  const resolvedMessages = useI18n({ locale, messages });
  const effectiveSubtitle = subtitle ?? resolvedMessages.logoSubtitle;

  const defaultLogo = (
    <div className="mejiro-reader-logo">
      <span className="mejiro-reader-logo-mark">{title}</span>
      {effectiveSubtitle && <span className="mejiro-reader-logo-sub">{effectiveSubtitle}</span>}
    </div>
  );
  const header = enableHeader ? (
    <header className="mejiro-reader-header">
      <div className="mejiro-reader-header-left">
        {logo === undefined ? defaultLogo : logo}
        {showChapterSelect && <MejiroChapterNav epub={e} chapter={chapter} onChange={onChapter} />}
      </div>
      <div className="mejiro-reader-header-actions">
        {enableStats && (
          <MejiroStats
            chapter={e?.chapters[chapter] ?? null}
            totalPages={layoutCtx.layout?.totalPages ?? 0}
            elapsedMs={layoutCtx.elapsedMs}
            fontLabel={fontLabel}
          />
        )}
        {enableDropZone && (
          <button
            type="button"
            className="mejiro-reader-btn"
            onClick={() => fileRef.current?.click()}
          >
            {resolvedMessages.openButton}
          </button>
        )}
        {enableImageOverlay && e && (
          <button
            type="button"
            className={`mejiro-reader-btn${imageCtx.hasImages ? ' is-active' : ''}`}
            onClick={() => imageCtx.addImage()}
          >
            {resolvedMessages.imageButton}
          </button>
        )}
        {enableSettings && (
          <button
            type="button"
            className={`mejiro-reader-btn${settingsOpen ? ' is-active' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            {resolvedMessages.settingsButton}
            <span className="mejiro-reader-btn-arrow">▾</span>
          </button>
        )}
      </div>
    </header>
  ) : null;

  const currentSpread = spreadCtx.spreadIdx;
  const rightPage = currentSpread * 2 + 1;
  const leftPage = currentSpread * 2 + 2;
  const showLeft = spreadCtx.spread != null && leftPage <= spreadCtx.spread.totalPages;
  const showRightNum = pageNumbers === 'both' || pageNumbers === 'right';
  const showLeftNum = pageNumbers === 'both' || pageNumbers === 'left';

  return (
    <MejiroI18nProvider messages={resolvedMessages}>
      <div
        className={`mejiro-reader${chromeHidden ? ' mejiro-reader--chrome-hidden' : ''}${fit === 'width' ? ' mejiro-reader--fit-width' : ''}`}
        data-mejiro-theme={themeName}
        style={themeStyle}
      >
        {header}
        {enableSettings &&
          (renderSettings ? (
            <div className={`mejiro-reader-settings-panel${settingsOpen ? ' is-open' : ''}`}>
              <div className="mejiro-reader-settings-inner">
                <div className="mejiro-reader-settings-content">
                  {renderSettings({
                    settings: editable,
                    update: setOptions,
                    open: settingsOpen,
                    toggle: () => setSettingsOpen((v) => !v),
                  })}
                </div>
              </div>
            </div>
          ) : (
            <MejiroSettingsPanel
              open={settingsOpen}
              settings={editable}
              fonts={fonts}
              onChange={setOptions}
            />
          ))}
        <div className={`mejiro-reader-body${showChapterPanel ? ' has-chapter-panel' : ''}`}>
          {showChapterPanel && (
            <MejiroChapterNav epub={e} chapter={chapter} onChange={onChapter} variant="panel" />
          )}
          <div ref={surfaceRef} className="mejiro-reader-surface">
            {!(e || epubCtx.loading) && enableDropZone && (
              <MejiroDropZone onFile={(f) => void epubCtx.loadFile(f)} />
            )}
            {epubCtx.loading && (
              <div className="mejiro-reader-loading">{resolvedMessages.loading}</div>
            )}
            {!layoutReady && fallback && <div className="mejiro-reader-fallback">{fallback}</div>}
            {layoutReady && mode === 'scroll' && layoutCtx.layout && (
              <MejiroScrollView
                layout={layoutCtx.layout}
                pageWidth={layoutCtx.pageWidth}
                pageHeight={layoutCtx.pageHeight}
                contentHeight={layoutCtx.contentHeight}
                fontFamily={bookOptions.fontFamily}
                fontSize={bookOptions.fontSize}
                lineSpacing={bookOptions.lineSpacing}
                scrollToPage={spreadCtx.spreadIdx * 2}
                onVisiblePageChange={(pageIdx, source) => {
                  if (source === 'programmatic') return;
                  const target = Math.floor(pageIdx / 2);
                  if (target !== spreadCtx.spreadIdx) spreadCtx.setSpread(target);
                }}
              />
            )}
            {layoutReady && mode === 'paginated' && spreadCtx.spread && (
              <MejiroSpread
                key={`${chapter}-${spreadCtx.spreadIdx}-${layoutCtx.pageWidth}x${layoutCtx.pageHeight}`}
                singlePage={effectiveSingle}
                onSwipe={(dir) => (dir === 'next' ? spreadCtx.next() : spreadCtx.prev())}
                onSurfaceTap={enableSurfaceTap ? () => setChromeHidden((v) => !v) : undefined}
                spread={spreadCtx.spread}
                pageWidth={layoutCtx.pageWidth}
                pageHeight={layoutCtx.pageHeight}
                contentHeight={layoutCtx.contentHeight}
                fontFamily={bookOptions.fontFamily}
                fontSize={bookOptions.fontSize}
                lineSpacing={bookOptions.lineSpacing}
                turning={spreadCtx.turning}
                rightHeader={{
                  title: runningTitleRight,
                  pageNumber: showRightNum ? rightPage : null,
                }}
                leftHeader={{
                  title: runningTitleLeft,
                  pageNumber: showLeft && showLeftNum ? leftPage : null,
                }}
                images={imageCtx.currentImages}
                indicator={
                  enablePageIndicator ? (
                    <MejiroPageIndicator
                      current={spreadCtx.spreadIdx + 1}
                      total={spreadCtx.totalSpreads}
                    />
                  ) : null
                }
                onPrev={spreadCtx.prev}
                onNext={spreadCtx.next}
                onImagePointerDown={imageCtx.onOverlayPointerDown}
                onImageResizePointerDown={imageCtx.onResizePointerDown}
                onImageClose={imageCtx.removeImage}
                spreadIdx={spreadCtx.spreadIdx}
                selectionRects={annotationRects.length ? annotationRects : undefined}
              />
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".epub"
          hidden
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            if (file) void epubCtx.loadFile(file);
          }}
        />
        <div className="mejiro-reader-sr-only" role="status" aria-live="polite">
          {spreadCtx.totalSpreads > 0
            ? formatMessage(resolvedMessages.spreadAnnouncement, {
                spread: spreadCtx.spreadIdx + 1,
                total: spreadCtx.totalSpreads,
              })
            : ''}
        </div>
      </div>
    </MejiroI18nProvider>
  );
}

const MejiroReader = forwardRef<MejiroReaderHandle, MejiroReaderProps>(MejiroReaderInner);
MejiroReader.displayName = 'MejiroReader';

export { MejiroReader };
