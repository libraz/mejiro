// biome-ignore-all lint/correctness/useHookAtTopLevel: MejiroReaderInner is a React forwardRef render function.
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
import { toError } from './errors.js';
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
import { mergeDefined } from './persistence.js';
import { useChapterLayout } from './useChapterLayout.js';
import { useEpub } from './useEpub.js';
import { useMejiroBook } from './useMejiroBook.js';
import { useMultiImageOverlay } from './useMultiImageOverlay.js';
import { type UseSpreadReturn, useSpread } from './useSpread.js';

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
 * page of that position. The Vue MejiroReader carries an identical copy.
 */
function scrollTargetPage(
  spread: Pick<UseSpreadReturn, 'spreadIdx' | 'firstPage' | 'indexOfPage'>,
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
 * states; the Vue MejiroReader carries an identical copy.
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
 * Sole owner of the pending `goToAnchor` request; the Vue MejiroReader carries
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

/** Imperative handle returned by `ref={...}` on {@link MejiroReader}. */
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
   * current one, the chapter is switched first; once the new layout is ready
   * the anchor is resolved and the matching spread is opened. A call made
   * before the book has loaded is applied once it has.
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
   * reported through {@link MejiroReaderProps.onError} rather than rejecting
   * the promise.
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
   *
   * `strictFontCheck` is read once, when the reader mounts.
   */
  options?: Partial<MejiroBookOptions>;
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
   * navigation. A spread index does not survive reflow, so persist the
   * reading position with `useReadingPosition` and the handle's
   * `getAnchor` / `goToAnchor` instead.
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
   * Spread layout. `double` (default) renders two pages; `single` renders one
   * page at a time, and `spreadIdx`, `goToSpread`, `onSpreadIdxChange` and
   * `spreadChanged` then count pages; `auto` flips to `single` for portrait
   * viewports, keeping the page on screen visible.
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
  limits?: Partial<EpubParseLimits>;
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
   * change fails (such as a font that measures as a fallback under
   * `strictFontCheck`; without it, a font that fails to load is not an error).
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
  const [chromeHidden, setChromeHidden] = useState(false);
  // Page a user scroll settled on, scoped to the layout it was reported against.
  const [userScroll, setUserScroll] = useState<{ layout: ChapterLayout; page: number } | null>(
    null,
  );
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
    const geometry = pageGeometryProp ?? {};
    if (fit !== 'width') return mergeDefined<ComputePageSizeOptions>({ columns }, geometry);
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

  const resolvedOptions = useMemo<MejiroBookOptions>(
    () => mergeDefined<MejiroBookOptions>(DEFAULT_BOOK_OPTIONS, optionsProp ?? {}),
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
    setOptions: applyBookOptions,
  } = useMejiroBook(resolvedOptions, {
    debounceMs: OPTIONS_DEBOUNCE_MS,
    onError: reportError,
  });
  // Settles with the latest application (never rejects: failures go to onError).
  const lastApplyRef = useRef<Promise<void>>(Promise.resolve());
  const setOptions = useCallback(
    (partial: Partial<BookOptions>): Promise<void> => {
      const applied = applyBookOptions(partial);
      lastApplyRef.current = applied;
      return applied;
    },
    [applyBookOptions],
  );

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

  // Keyed on content, not array identity: the live-preview pattern hands over a
  // fresh `manuscript` array on every render.
  const manuscriptSourceKey = manuscriptKey(manuscriptProp);
  const synthesizedEpub = useMemo<EpubBook | null>(() => {
    if (manuscriptSourceKey === undefined) return null;
    const chapters = JSON.parse(manuscriptSourceKey) as ManuscriptChapter[];
    return manuscriptToEpubBook(chapters, { dialect: dialectProp });
  }, [manuscriptSourceKey, dialectProp]);

  const epubCtx = useEpub({
    // `epub` / `manuscript` take precedence: skip the URL fetch when a parsed
    // book (or a synthesized manuscript book) is supplied.
    defaultUrl: epubProp !== undefined || manuscriptProp !== undefined ? undefined : epubUrl,
    fetchOptions,
    limits,
    fetchEpub: fetchEpubFn,
    onLoad: (b) => {
      if (chapterProp == null) setChapterState(0);
      clearImagesRef.current();
      onLoad?.(b);
    },
  });

  const controlled = epubProp !== undefined || manuscriptProp !== undefined;
  const isManuscriptSource = manuscriptProp !== undefined;
  const e = isManuscriptSource ? synthesizedEpub : controlled ? (epubProp ?? null) : epubCtx.epub;
  // Book identity: changes on a swap, not on a manuscript content edit.
  const sourceKey = isManuscriptSource ? MANUSCRIPT_SOURCE : epubProp;
  const bookKey: unknown = controlled ? sourceKey : epubCtx.epub;
  const chapter = clampChapter(chapterProp ?? chapterState, e);
  // A controlled source owns the book, so the reader offers no file of its own.
  const filePicker = enableDropZone && !controlled;

  useEffect(() => {
    if (epubCtx.error) onErrorRef.current?.(epubCtx.error);
  }, [epubCtx.error]);

  // Refs that let the (stable) layout-composable callbacks read the latest
  // geometry and spread index without re-creating `recompute`.
  const pageGeometryRef = useRef(resolvedGeometry);
  pageGeometryRef.current = resolvedGeometry;
  // Reads the current position through the same anchor resolution `getAnchor`
  // uses (skips image-blocked pages, handles single mode); set once `spreadCtx`
  // exists below.
  const spreadAnchorRef = useRef<() => InChapterAnchor | null>(() => null);
  const spreadIdxPropRef = useRef(spreadIdxProp);
  spreadIdxPropRef.current = spreadIdxProp;

  // Anchor at the start of the spread on screen, taken when that spread settled:
  // an option change re-paginates the live layout in place before the reflow
  // captures from it, so reading the layout at capture time can drift.
  const visibleAnchorRef = useRef<{ layout: ChapterLayout; anchor: InChapterAnchor | null } | null>(
    null,
  );
  const layoutCtx = useChapterLayout(book, e, chapter, surfaceRef, {
    pageGeometry: () => pageGeometryRef.current,
    // Preserve the reading position across a reflow re-layout (size / option
    // changes), but only in uncontrolled mode — when `spreadIdx` is controlled
    // the host owns the position and the controlled-restore effect handles it.
    capturePosition: (layout) => {
      if (spreadIdxPropRef.current != null) return null;
      const visible = visibleAnchorRef.current;
      if (visible?.layout === layout) return visible.anchor;
      return spreadAnchorRef.current();
    },
  });

  // Last index reported to the host, consumed by the controlled reconcile below.
  const reportedSpreadIdxRef = useRef<number | null>(null);
  const spreadChangedRef = useRef<((i: number) => void) | undefined>(undefined);
  spreadChangedRef.current = (i: number) => {
    reportedSpreadIdxRef.current = i;
    onSpreadChange?.(i);
    onSpreadIdxChange?.(i);
  };
  const spreadCtx = useSpread(layoutCtx.layout, {
    enableKeyboard,
    single: effectiveSingle,
    onChange: (i) => spreadChangedRef.current?.(i),
  });
  spreadAnchorRef.current = () => spreadCtx.anchorAt(spreadCtx.spreadIdx);
  const indexOfPageRef = useRef(spreadCtx.indexOfPage);
  indexOfPageRef.current = spreadCtx.indexOfPage;
  // A single/double flip keeps the anchor of the page that was on screen: the
  // converted index may start earlier, and the re-layout restores from it.
  const anchorSingleRef = useRef(effectiveSingle);
  useLayoutEffect(() => {
    const l = layoutCtx.layout;
    const flipped = anchorSingleRef.current !== effectiveSingle;
    anchorSingleRef.current = effectiveSingle;
    if (flipped && l && visibleAnchorRef.current?.layout === l) return;
    visibleAnchorRef.current = l
      ? { layout: l, anchor: spreadCtx.anchorAt(spreadCtx.spreadIdx) }
      : null;
  }, [layoutCtx.layout, spreadCtx.spreadIdx, spreadCtx.anchorAt, effectiveSingle]);

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
    setSpreadRef.current(loc ? indexOfPageRef.current(loc.pageIdx) : 0);
    // A capture that runs before the restored index renders must see this anchor.
    visibleAnchorRef.current = { layout: layoutCtx.layout, anchor };
  }, [layoutCtx.layout]);

  // Re-flow when metric-affecting options change at runtime. useMejiroBook keeps
  // the book + snapshot in sync, but an options change does not otherwise re-run
  // layout, so the settings-panel font / line-spacing / kinsoku / hanging
  // controls would only restyle the wrapper while the typeset content stayed
  // frozen. Debounced so dragging a continuous control coalesces into one
  // re-flow; the pending option change is awaited first so the re-layout sees
  // the metrics it will be measured with. Awaited, not re-sent: re-sending the
  // snapshot would re-apply (and re-report) a change the book rejected.
  const optionsKey = reflowOptionsKey(bookOptions);
  const optionsKeyRef = useRef(optionsKey);
  const recomputeRef = useRef(layoutCtx.recompute);
  recomputeRef.current = layoutCtx.recompute;
  useEffect(() => {
    // Skip the first run: the initial layout already reflects the initial options.
    if (optionsKeyRef.current === optionsKey) return;
    optionsKeyRef.current = optionsKey;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await lastApplyRef.current;
          await recomputeRef.current({ blank: false });
        } catch (err) {
          reportError(toError(err));
        }
      })();
    }, OPTIONS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [optionsKey, reportError]);

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

  const imageCtx = useMultiImageOverlay(layoutCtx.layout, spreadCtx.layoutSpreadIdx, {
    defaultX: IMAGE_DEFAULT_X,
    onUpdate: () => spreadCtx.refresh(),
  });

  // The layout reflows in place when images change, so the image state keys this too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentImages changes whenever the layout's exclusions do.
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
  }, [annotations, layoutCtx.layout, chapter, imageCtx.currentImages]);

  // Controlled mode: render `epub` / `manuscript` directly instead of copying
  // it into the loader state. Copying introduces a render where layout can see
  // the old book with the new chapter index. A book swap is a new `epub` object
  // or a switch into manuscript source; manuscript content edits are not.
  const clearImagesRef = useRef(imageCtx.clearImages);
  clearImagesRef.current = imageCtx.clearImages;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const eRef = useRef(e);
  eRef.current = e;
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourceKey is the book identity this effect keys on.
  useEffect(() => {
    if (!controlled) return;
    if (chapterIsUncontrolled) setChapterState(0);
    clearImagesRef.current();
    book.clearCache();
    if (eRef.current) onLoadRef.current?.(eRef.current);
  }, [controlled, sourceKey, book, chapterIsUncontrolled]);

  // Images belong to the chapter they were placed on; another chapter starts bare.
  const imagesChapterRef = useRef(chapter);
  useEffect(() => {
    if (imagesChapterRef.current === chapter) return;
    imagesChapterRef.current = chapter;
    clearImagesRef.current();
  }, [chapter]);

  // Controlled spreadIdx → host-driven navigation: animate to the prop value.
  // Every commit is reconciled, not just the ones where the prop value changed:
  // a host that rejects a change (keeping the prop where it was) must see the
  // rendered spread return to the prop value, so the drift is snapped back
  // without a turn animation. A drift reported in this very commit gets one more
  // commit for the host to follow before it counts as rejected.
  const spreadGoToRef = useRef(spreadCtx.goTo);
  spreadGoToRef.current = spreadCtx.goTo;
  const appliedSpreadIdxPropRef = useRef(spreadIdxProp);
  const [hostTurn, setHostTurn] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hostTurn re-runs the reconcile one commit later.
  useEffect(() => {
    const reported = reportedSpreadIdxRef.current;
    reportedSpreadIdxRef.current = null;
    if (spreadIdxProp == null) {
      appliedSpreadIdxPropRef.current = spreadIdxProp;
      return;
    }
    const propChanged = appliedSpreadIdxPropRef.current !== spreadIdxProp;
    appliedSpreadIdxPropRef.current = spreadIdxProp;
    if (spreadCtx.spreadIdx === spreadIdxProp) return;
    if (propChanged) spreadGoToRef.current(spreadIdxProp);
    else if (reported === spreadCtx.spreadIdx) setHostTurn((n) => n + 1);
    else setSpreadRef.current(spreadIdxProp);
  }, [spreadIdxProp, spreadCtx.spreadIdx, hostTurn]);

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
    (index: number) => {
      const i = clampChapter(index, e);
      if (i === chapter) return;
      if (chapterProp == null) setChapterState(i);
      onChapterChange?.(i);
    },
    [chapter, chapterProp, onChapterChange, e],
  );
  const onChapterRef = useRef(onChapter);
  onChapterRef.current = onChapter;

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

  // The layout only counts for `chapter` of the shown book once it was built
  // for them: after a chapter switch or a book swap the previous layout
  // survives until the re-layout replaces it.
  const layoutOwnerRef = useRef<{ layout: ChapterLayout | null; chapter: number; book: unknown }>({
    layout: null,
    chapter,
    book: bookKey,
  });
  if (layoutOwnerRef.current.layout !== layoutCtx.layout) {
    layoutOwnerRef.current = { layout: layoutCtx.layout, chapter, book: bookKey };
  }
  const owner = layoutOwnerRef.current;
  const layout = owner.chapter === chapter && owner.book === bookKey ? layoutCtx.layout : null;
  const anchorTarget: AnchorTarget = { book: epubCtx.loading ? null : e, chapter, layout };
  const anchorTargetRef = useRef(anchorTarget);
  anchorTargetRef.current = anchorTarget;
  const anchorResolverRef = useRef<ReturnType<typeof createAnchorResolver> | null>(null);
  anchorResolverRef.current ??= createAnchorResolver({
    goToChapter: (i) => onChapterRef.current(i),
    goToPage: (pageIdx) => spreadGoToRef.current(indexOfPageRef.current(pageIdx)),
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target ref is read for these values.
  useEffect(() => {
    anchorResolverRef.current?.update(anchorTargetRef.current);
  }, [anchorTarget.book, chapter, layout]);
  // Settle any in-flight anchor on unmount so awaiting callers never hang.
  useEffect(() => () => anchorResolverRef.current?.dispose(), []);

  // spreadChanged / chapterFinished / onPageRead are all decided by the tracker.
  const onPageReadRef = useRef(onPageRead);
  onPageReadRef.current = onPageRead;
  const onChapterCompletedRef = useRef(onChapterCompleted);
  onChapterCompletedRef.current = onChapterCompleted;
  const trackLifecycleRef = useRef<ReturnType<typeof createLifecycleTracker> | null>(null);
  trackLifecycleRef.current ??= createLifecycleTracker({
    spreadChanged: (ch, spreadIdx) => emit('spreadChanged', { chapter: ch, spreadIdx }),
    chapterFinished: (ch) => {
      emit('chapterFinished', { chapter: ch });
      onChapterCompletedRef.current?.(ch);
    },
    pageRead: (anchor, dwellMs) => onPageReadRef.current?.(anchor, dwellMs),
  });
  useEffect(() => {
    const view = layout
      ? { total: spreadCtx.totalSpreads, anchor: spreadCtx.anchorAt(spreadCtx.spreadIdx) }
      : null;
    trackLifecycleRef.current?.(bookKey, chapter, spreadCtx.spreadIdx, view, spreadIdxProp);
  }, [
    bookKey,
    chapter,
    spreadCtx.spreadIdx,
    spreadCtx.totalSpreads,
    spreadCtx.anchorAt,
    layout,
    spreadIdxProp,
  ]);

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
        anchorResolverRef.current?.request(anchor, anchorTargetRef.current) ?? Promise.resolve(),
      getAnchor: () => {
        if (!layout) return null;
        const inCh = spreadCtx.anchorAt(spreadCtx.spreadIdx);
        return inCh ? { chapter, ...inCh } : null;
      },
      getVisibleRange: () => {
        if (!layout) return null;
        const start = spreadCtx.anchorAt(spreadCtx.spreadIdx);
        if (!start) return null;
        const end = spreadCtx.anchorAt(spreadCtx.spreadIdx + 1) ?? layout.endAnchor() ?? start;
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
      spreadCtx.anchorAt,
      onChapter,
      chapter,
      layout,
      setOptions,
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
            totalPages={spreadCtx.totalPages}
            elapsedMs={layoutCtx.elapsedMs}
            fontLabel={fontLabel}
          />
        )}
        {filePicker && (
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
            onClick={() =>
              imageCtx.addImage(
                singlePageImagePlacement(
                  mode === 'paginated' ? spreadCtx.singleSide : null,
                  layoutCtx.pageWidth,
                ),
              )
            }
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

  const currentSpread = spreadCtx.layoutSpreadIdx;
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
            {!(e || epubCtx.loading) && filePicker && (
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
                scrollToPage={scrollTargetPage(
                  spreadCtx,
                  userScroll?.layout === layoutCtx.layout ? userScroll.page : null,
                )}
                onVisiblePageChange={(pageIdx, source) => {
                  if (source === 'programmatic') return;
                  if (layoutCtx.layout) setUserScroll({ layout: layoutCtx.layout, page: pageIdx });
                  const target = spreadCtx.indexOfPage(pageIdx);
                  if (target !== spreadCtx.spreadIdx) spreadCtx.setSpread(target);
                }}
                selectionRects={annotationRects.length ? annotationRects : undefined}
                spreadIdx={spreadCtx.layoutSpreadIdx}
                images={imageCtx.currentImages}
                onImagePointerDown={imageCtx.onOverlayPointerDown}
                onImageResizePointerDown={imageCtx.onResizePointerDown}
                onImageClose={imageCtx.removeImage}
              />
            )}
            {layoutReady && mode === 'paginated' && spreadCtx.spread && (
              <MejiroSpread
                key={`${chapter}-${spreadCtx.spreadIdx}-${layoutCtx.pageWidth}x${layoutCtx.pageHeight}`}
                singlePage={effectiveSingle}
                singleSide={spreadCtx.singleSide ?? undefined}
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
                spreadIdx={spreadCtx.layoutSpreadIdx}
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
            // Cleared so picking the same file again still fires `change`.
            ev.target.value = '';
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

/**
 * Full-page EPUB reader. Composes the package's primitives into a working
 * reader; features opt out via the `enableX` props or all chrome via `bare`.
 * The `ref` exposes {@link MejiroReaderHandle} for imperative navigation.
 */
const MejiroReader = forwardRef<MejiroReaderHandle, MejiroReaderProps>(MejiroReaderInner);
MejiroReader.displayName = 'MejiroReader';

export { MejiroReader };
