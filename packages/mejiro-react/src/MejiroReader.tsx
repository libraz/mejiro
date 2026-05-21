// biome-ignore-all lint/correctness/useHookAtTopLevel: MejiroReaderInner is a React forwardRef render function.
import type {
  BookOptions,
  InChapterAnchor,
  ManuscriptChapter,
  ReadingAnchor,
} from '@libraz/mejiro/book';
import { DEFAULT_BOOK_OPTIONS } from '@libraz/mejiro/book';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import type { EpubBook, ManuscriptDialect } from '@libraz/mejiro/epub';
import { manuscriptToEpubBook } from '@libraz/mejiro/epub';
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
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

/** Props shared across every {@link MejiroReader} source mode. */
interface MejiroReaderCommonProps {
  /**
   * Initial book options. Optional — defaults to {@link DEFAULT_BOOK_OPTIONS}
   * (`serif` 16px, line spacing 1.8, strict kinsoku, hanging punctuation on).
   * Spread the defaults to tweak only a few:
   *
   * ```ts
   * { ...DEFAULT_BOOK_OPTIONS, fontFamily: '"Noto Serif JP"', fontSize: 18 }
   * ```
   */
  options?: BookOptions;
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
  /** Show the image-overlay editing/demo button. @defaultValue false */
  enableImageOverlay?: boolean;
  /** Show the stats line. @defaultValue `!bare` */
  enableStats?: boolean;
  /** Bind ArrowLeft/ArrowRight to navigation. @defaultValue true */
  enableKeyboard?: boolean;
  /** Show the "n / total" indicator. @defaultValue `!bare` */
  enablePageIndicator?: boolean;
  /**
   * Reader-side annotations to render as highlights. Each annotation whose
   * `chapter` matches the current chapter is converted to spread-local
   * rectangles via `ChapterLayout.selectionRects` and drawn on top of the
   * page content. Pair with {@link useAnnotations} for persistence, or pass
   * any shape that satisfies `{ chapter, start, end }`.
   */
  annotations?: ReadonlyArray<{
    chapter: number;
    start: InChapterAnchor;
    end: InChapterAnchor;
    color?: string;
  }>;

  /** Called after a successful EPUB load. */
  onLoad?: (book: EpubBook) => void;
  /** Called when loading or parsing an EPUB fails. */
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
    options = DEFAULT_BOOK_OPTIONS,
    fonts,
    epub: epubProp,
    epubUrl,
    chapter: chapterProp,
    spreadIdx: spreadIdxProp,
    theme = 'light',
    mode = 'paginated',
    spreadMode = 'double',
    enableSurfaceTap = true,
    fallback,
    fetchOptions,
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
    enableImageOverlay = false,
    enableStats = !bare,
    enableKeyboard = true,
    enablePageIndicator = !bare,
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

  const { book, options: bookOptions, setOptions } = useMejiroBook(options);

  const synthesizedEpub = useMemo<EpubBook | null>(() => {
    if (manuscriptProp === undefined) return null;
    return manuscriptToEpubBook(manuscriptProp, { dialect: dialectProp });
  }, [manuscriptProp, dialectProp]);

  const epubCtx = useEpub({
    // `epub` / `manuscript` take precedence: skip the URL fetch when a parsed
    // book (or a synthesized manuscript book) is supplied.
    defaultUrl: epubProp !== undefined || manuscriptProp !== undefined ? undefined : epubUrl,
    fetchOptions,
    fetchEpub: fetchEpubFn,
    onLoad: (b) => {
      if (chapterProp == null) setChapterState(0);
      onLoad?.(b);
    },
  });

  const controlled = epubProp !== undefined || manuscriptProp !== undefined;
  const isManuscriptSource = manuscriptProp !== undefined;
  const e = isManuscriptSource ? synthesizedEpub : controlled ? (epubProp ?? null) : epubCtx.epub;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    if (epubCtx.error) onErrorRef.current?.(epubCtx.error);
  }, [epubCtx.error]);

  const layoutCtx = useChapterLayout(book, e, chapter, surfaceRef);

  const spreadChangedRef = useRef<((i: number) => void) | undefined>(undefined);
  spreadChangedRef.current = (i: number) => {
    onSpreadChange?.(i);
    onSpreadIdxChange?.(i);
  };
  const spreadCtx = useSpread(layoutCtx.layout, {
    enableKeyboard,
    onChange: (i) => spreadChangedRef.current?.(i),
  });

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
      for (const rect of rects) result.push(rect);
    }
    return result;
  }, [annotations, layoutCtx.layout, chapter]);

  // Controlled mode: render `epub` directly instead of copying it into the
  // loader state. Copying introduces a render where layout can see the old
  // book with the new chapter index.
  const clearImagesRef = useRef(imageCtx.clearImages);
  clearImagesRef.current = imageCtx.clearImages;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    if (!controlled) return;
    if (chapterProp == null) setChapterState(0);
    clearImagesRef.current();
    book.clearCache();
    if (epubProp) onLoadRef.current?.(epubProp);
  }, [controlled, epubProp, book, chapterProp]);

  // Controlled spreadIdx: drive useSpread.goTo from the prop.
  const spreadGoToRef = useRef(spreadCtx.goTo);
  spreadGoToRef.current = spreadCtx.goTo;
  useEffect(() => {
    if (spreadIdxProp == null) return;
    if (spreadIdxProp === spreadCtx.spreadIdx) return;
    spreadGoToRef.current(spreadIdxProp);
  }, [spreadIdxProp, spreadCtx.spreadIdx]);

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
  const themeStyle = themeOverride as CSSProperties | undefined;

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

  return (
    <MejiroI18nProvider messages={resolvedMessages}>
      <div
        className={`mejiro-reader${chromeHidden ? ' mejiro-reader--chrome-hidden' : ''}`}
        data-mejiro-theme={themeName}
        style={themeStyle}
      >
        {header}
        {enableSettings && (
          <MejiroSettingsPanel
            open={settingsOpen}
            settings={editable}
            fonts={fonts}
            onChange={setOptions}
          />
        )}
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
                onVisiblePageChange={(pageIdx) => {
                  const target = Math.floor(pageIdx / 2);
                  if (target !== spreadCtx.spreadIdx) spreadGoToRef.current(target);
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
                rightHeader={{ title: runningTitleRight, pageNumber: rightPage }}
                leftHeader={{
                  title: runningTitleLeft,
                  pageNumber: showLeft ? leftPage : null,
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
