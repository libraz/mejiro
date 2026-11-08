// biome-ignore-all lint/correctness/useHookAtTopLevel: MejiroReaderInner is a React forwardRef render function.
import type { BinaryInput } from '@libraz/mejiro';
import type {
  BookOptions,
  BookOptionsPatch,
  ChapterLayout,
  FitPageSizeOptions,
  InChapterAnchor,
  ManuscriptChapter,
  ReadingAnchor,
} from '@libraz/mejiro/book';
import { DEFAULT_BOOK_OPTIONS, DEFAULT_PAGE_GEOMETRY } from '@libraz/mejiro/book';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import type { EpubBook, EpubParseLimits, ManuscriptDialect } from '@libraz/mejiro/epub';
import { manuscriptToEpubBook } from '@libraz/mejiro/epub';
import { type PageNumberDisplay, pageNumberFor } from '@libraz/mejiro/render';
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { bookIdentity, type LayoutEpubMemo, resolveLayoutEpub } from './bookIdentity.js';
import { toError } from './errors.js';
import {
  formatMessage,
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
import { MejiroSpread, type ReaderAnnotation } from './MejiroSpread.js';
import { MejiroStats } from './MejiroStats.js';
import { mergeDefined } from './persistence.js';
import { useChapterLayout } from './useChapterLayout.js';
import type { FetchEpubOptions } from './useEpub.js';
import { useEpub } from './useEpub.js';
import { useImageOverlay } from './useImageOverlay.js';
import { useMejiroBook } from './useMejiroBook.js';
import { type ResolvedSpreadMode, type UseSpreadReturn, useSpread } from './useSpread.js';

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

/** Default image x (px, relative to the right page), as `useImageOverlay` places it. */
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
    o.kinsoku,
    o.enableHanging,
    o.headingScale,
    o.headingStyles,
  ]);
}

/** A position prop read as an index: non-finite values read as 0, fractions truncate, negatives clamp to 0. */
function positionIndex(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** Navigation index that opens layout spread `spreadIndex`: its right page in single mode. */
function navigationIndexOfSpread(spreadIndex: number, single: boolean): number {
  return single ? spreadIndex * 2 : spreadIndex;
}

/** Layout spread shown at navigation index `index`. */
function spreadIndexOfNavigation(index: number, single: boolean): number {
  return single ? Math.floor(index / 2) : index;
}

/** Whether two in-chapter anchors name the same position. */
function sameAnchor(a: InChapterAnchor | null, b: InChapterAnchor | null): boolean {
  if (!(a && b)) return a === b;
  return a.paragraphIndex === b.paragraphIndex && a.charIndex === b.charIndex;
}

/**
 * True when a keydown on the reader must not be read as navigation: the host
 * already handled it, a modifier turns it into a different gesture, or it was
 * typed into an editable field inside the reader.
 */
function ignoreNavigationKey(e: ReactKeyboardEvent<HTMLElement>): boolean {
  if (e.defaultPrevented) return true;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Page a scroll-mode reader asks the view to show: the page a user scroll
 * settled on while it still belongs to the current position, else the first
 * page of that position. The Vue MejiroReader carries an identical copy.
 */
function scrollTargetPage(
  spread: Pick<UseSpreadReturn, 'index' | 'firstPage' | 'indexOfPage'>,
  userPage: number | null,
): number {
  return userPage != null && spread.indexOfPage(userPage) === spread.index
    ? userPage
    : spread.firstPage;
}

/** Receivers for the lifecycle events {@link createLifecycleTracker} decides to fire. */
interface LifecycleSink {
  spreadIndexChange: (chapterIndex: number, spreadIndex: number) => void;
  chapterFinished: (chapterIndex: number) => void;
  pageRead: (anchor: ReadingAnchor, dwellMs: number) => void;
}

/** What the tracker reads from a settled reader state. */
interface LifecycleView {
  /** Number of navigation positions. */
  count: number;
  /** Layout spread holding the first visible page. */
  spreadIndex: number;
  /** Start of the first visible page. */
  anchor: InChapterAnchor | null;
}

/**
 * Decides spreadIndexChange / chapterFinished / page-read from successive
 * reader states; the Vue MejiroReader carries an identical copy.
 *
 * A state is skipped while `view` is null (it must be null unless the layout
 * was built for `chapterIndex` of `book`) or while `hold` is set (a position
 * still being applied). The first settled position of each `book` is the
 * baseline and emits nothing; afterwards each change of navigation position
 * reports the page read, a change of (chapter, layout spread) emits
 * spreadIndexChange, and reaching the last position emits chapterFinished. A
 * re-layout that keeps the position emits nothing.
 */
function createLifecycleTracker(
  sink: LifecycleSink,
): (
  book: unknown,
  chapterIndex: number,
  index: number,
  view: LifecycleView | null,
  hold: boolean,
) => void {
  let lastBook: unknown = null;
  let last: { chapterIndex: number; index: number; spreadIndex: number } | null = null;
  let dwell: { anchor: ReadingAnchor; ts: number } | null = null;
  return (book, chapterIndex, index, view, hold) => {
    if (!view || hold) return;
    if (book !== lastBook) {
      lastBook = book;
      last = null;
      dwell = null;
    }
    if (last && last.chapterIndex === chapterIndex && last.index === index) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const previous = last;
    if (previous && dwell) sink.pageRead(dwell.anchor, now - dwell.ts);
    const inCh = view.anchor;
    dwell = inCh ? { anchor: { chapterIndex, ...inCh }, ts: now } : null;
    last = { chapterIndex, index, spreadIndex: view.spreadIndex };
    if (!previous) return;
    if (previous.chapterIndex !== chapterIndex || previous.spreadIndex !== view.spreadIndex) {
      sink.spreadIndexChange(chapterIndex, view.spreadIndex);
    }
    if (index === view.count - 1) sink.chapterFinished(chapterIndex);
  };
}

/** Clamps a chapter index into `book`'s chapters; any index stands while no book is shown. */
function clampChapter(index: number, book: EpubBook | null): number {
  if (!book) return index;
  return Math.max(0, Math.min(book.chapters.length - 1, index));
}

/**
 * What a pending anchor resolves against. `book` is null while none is shown or
 * one is loading; `layout` must be null unless built for `chapterIndex` of `book`.
 */
interface AnchorTarget {
  book: EpubBook | null;
  chapterIndex: number;
  layout: ChapterLayout | null;
}

/**
 * Sole owner of the pending anchor request; the Vue MejiroReader carries an
 * identical copy. Every request settles exactly once: applied, unresolvable
 * (its chapter or position does not exist in the shown book), superseded by a
 * newer request, or disposed. A request made before a book is shown waits for
 * one; one that moves the spread settles on the next update, once the spread
 * is shown. `report` says whether the move counts as navigation the host is
 * told about, or as the reader applying a position it was given.
 */
function createAnchorResolver(nav: {
  goToChapter: (chapterIndex: number) => void;
  /** Shows the position holding `pageIndex`; returns whether that changes the shown position. */
  goToPage: (pageIndex: number, report: boolean) => boolean;
}): {
  request: (anchor: ReadingAnchor, target: AnchorTarget, report: boolean) => Promise<void>;
  update: (target: AnchorTarget) => void;
  pending: () => boolean;
  dispose: () => void;
} {
  let pending: {
    anchor: ReadingAnchor;
    resolve: () => void;
    report: boolean;
    chapterRequested: boolean;
    moved: boolean;
  } | null = null;
  const settle = (): void => {
    const settled = pending;
    pending = null;
    settled?.resolve();
  };
  const update = (target: AnchorTarget): void => {
    const current = pending;
    if (!(current && target.book)) return;
    if (current.moved) {
      settle();
      return;
    }
    const { anchor } = current;
    if (!(anchor.chapterIndex >= 0 && anchor.chapterIndex < target.book.chapters.length)) {
      settle();
      return;
    }
    if (anchor.chapterIndex !== target.chapterIndex) {
      // Asked once: a host driving a controlled chapter may decline.
      if (current.chapterRequested) return;
      current.chapterRequested = true;
      nav.goToChapter(anchor.chapterIndex);
      return;
    }
    if (!target.layout) return;
    const loc = target.layout.locateAnchor({
      paragraphIndex: anchor.paragraphIndex,
      charIndex: anchor.charIndex,
    });
    if (loc && nav.goToPage(loc.pageIndex, current.report)) {
      current.moved = true;
      return;
    }
    settle();
  };
  return {
    request: (anchor, target, report) =>
      new Promise<void>((resolve) => {
        settle();
        pending = { anchor, resolve, report, chapterRequested: false, moved: false };
        update(target);
      }),
    update,
    pending: () => pending !== null,
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
 * - `single` — render one page at a time, centered.
 * - `auto` — switch based on the surface aspect ratio (single when portrait),
 *   keeping the page on screen visible.
 */
export type MejiroSpreadMode = 'double' | 'single' | 'auto';

/** Which page of a spread prints its page number (`'both'`, `'right'`, `'left'` or `'none'`). */
export type { PageNumberDisplay };

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

/**
 * Spread-level position of a reader, as {@link MejiroReaderHandle.getSpreadPosition}
 * reports it. A spread index does not survive a re-layout; persist a
 * {@link ReadingAnchor} to keep a reading position.
 */
export interface SpreadPosition {
  /** Zero-based index of the current chapter. */
  chapterIndex: number;
  /** Zero-based index of the layout spread holding the visible page(s). */
  spreadIndex: number;
  /** Number of spreads in the current chapter's layout. */
  spreadCount: number;
  /** Number of pages in the current chapter's layout. */
  pageCount: number;
}

/** Payload of the `spreadIndexChange` reader event. */
export interface MejiroReaderSpreadIndexChangeEvent {
  /** Chapter the spread belongs to. */
  chapterIndex: number;
  /** Layout spread now shown. */
  spreadIndex: number;
}

/** Payload of the `chapterFinished` reader event. */
export interface MejiroReaderChapterFinishedEvent {
  /** Chapter whose last position was reached. */
  chapterIndex: number;
}

/** Payload of the `turnStart` reader event. */
export interface MejiroReaderTurnStartEvent {
  /** Navigation position the turn leaves: a page in single mode, a spread otherwise. */
  from: number;
}

/** Payload of the `turnEnd` reader event. */
export interface MejiroReaderTurnEndEvent {
  /** Navigation position the turn landed on: a page in single mode, a spread otherwise. */
  to: number;
}

/** Half-open range of reading anchors, as {@link MejiroReaderHandle.getVisibleRange} returns it. */
export interface ReadingAnchorRange {
  /** First visible position (inclusive). */
  start: ReadingAnchor;
  /** Position where the text after the visible range begins (exclusive). */
  end: ReadingAnchor;
}

/**
 * Event payloads emitted by {@link MejiroReaderHandle.subscribe}.
 *
 * Each property maps an event name to its listener signature. An event that
 * has a prop twin is named after it without the `on` prefix.
 */
export interface MejiroReaderEventMap {
  /** Fires once the reader shows another layout spread or chapter. */
  spreadIndexChange: (payload: MejiroReaderSpreadIndexChangeEvent) => void;
  /** Fires when a turn animation begins (before the new position is shown). */
  turnStart: (payload: MejiroReaderTurnStartEvent) => void;
  /** Fires after a turn animation completes (the new position is now shown). */
  turnEnd: (payload: MejiroReaderTurnEndEvent) => void;
  /** Fires when the reader reaches the last position of the current chapter. */
  chapterFinished: (payload: MejiroReaderChapterFinishedEvent) => void;
}

/** Imperative handle returned by `ref={...}` on {@link MejiroReader}. */
export interface MejiroReaderHandle {
  /**
   * Turns to a layout spread (0-based, clamped to the chapter's spreads). In
   * single-page mode the spread opens on its right page.
   *
   * @throws RangeError when `spreadIndex` is not an integer.
   */
  goToSpread(spreadIndex: number): void;
  /** Advance one position: a page in single-page mode, a spread otherwise. */
  next(): void;
  /** Go back one position. */
  prev(): void;
  /** Jump to a chapter (clamped to the book's chapters; opens at its first spread). */
  goToChapter(chapterIndex: number): void;
  /** Reads the current spread-level position. */
  getSpreadPosition(): SpreadPosition;
  /**
   * Navigate to a {@link ReadingAnchor}. If the chapter differs from the
   * current one, the chapter is switched first; once the new layout is ready
   * the anchor is resolved and the matching position is opened. A call made
   * before the book has loaded is applied once it has.
   *
   * Returns a promise that resolves once the position has been applied, or
   * without moving when the anchor's chapter or position does not exist in the
   * book. If another `goToAnchor` is invoked before the previous one settles,
   * the earlier promise resolves immediately (superseded). Resolves on unmount.
   */
  goToAnchor(anchor: ReadingAnchor): Promise<void>;
  /**
   * Returns the {@link ReadingAnchor} at the start of the text on the current
   * position, or `null` if the layout is not ready. When an image blocks every
   * page shown, the anchor is where the text resumes after it; `null` again if
   * none follows.
   */
  getAnchor(): ReadingAnchor | null;
  /**
   * Returns the half-open range of {@link ReadingAnchor}s visible on the
   * current position. `end` points at the start of the text on the next
   * position that has any (or the end of the chapter when none does).
   */
  getVisibleRange(): ReadingAnchorRange | null;
  /**
   * Merges `patch` into the book options at runtime; font / size changes
   * re-measure and re-layout asynchronously.
   *
   * Successive calls are coalesced into a single application; the returned
   * promise resolves once that application has settled. A failed application
   * (such as a font that measures as a fallback under `strictFontCheck`) is
   * reported through {@link MejiroReaderCommonProps.onError} rather than
   * rejecting the promise.
   */
  updateOptions(patch: BookOptionsPatch): Promise<void>;
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
  /** Merges a settings change into the book options and re-flows the chapter. */
  update: (patch: BookOptionsPatch) => void;
  /** Whether the settings panel is currently open. */
  open: boolean;
  /** Toggles the settings panel open/closed (same as the header button). */
  toggle: () => void;
}

/**
 * Props shared across every {@link MejiroReader} source mode.
 *
 * The position props come in value / handler pairs (`chapterIndex` /
 * `onChapterIndexChange`, `spreadIndex` / `onSpreadIndexChange`, `anchor` /
 * `onAnchorChange`). A value without its handler is the initial position; with
 * its handler the pair is controlled: the reader reports each navigation
 * through the handler and shows the value it is given, returning to it when
 * the host keeps it unchanged (an absent index reads as 0). When `anchor` is
 * given it decides the chapter and spread, and `chapterIndex` / `spreadIndex`
 * are not read.
 */
export interface MejiroReaderCommonProps {
  /**
   * Book options. Optional — defaults to {@link DEFAULT_BOOK_OPTIONS}
   * (`serif` 16px, line spacing 1.8, strict kinsoku, hanging punctuation on);
   * the keys given here override those defaults.
   *
   * The keys `MejiroBook.updateOptions` accepts follow this prop by content;
   * the construction-only keys (`strictFontCheck`, `analyzer`, …) are read
   * once, when the reader mounts.
   */
  options?: Partial<BookOptions>;
  /**
   * Page-geometry overrides forwarded to `MejiroBook.fitPageSize`. Use to
   * tune how the spread is sized inside the surface — most usefully to shrink
   * the reserved margins so the pages fill their frame, e.g.
   * `pageGeometry={{ gutterOffset: 0, headerOffset: 0 }}`. Also accepts
   * `aspect`, `minWidth`, `minHeight`, `maxHeight`, and the page padding;
   * omitted fields fall back to the built-in defaults.
   */
  pageGeometry?: FitPageSizeOptions;
  /** Font choices for the settings panel. */
  fonts?: readonly FontChoice[];
  /**
   * Chapter to show. The initial chapter unless
   * {@link MejiroReaderCommonProps.onChapterIndexChange} is given, which
   * makes it controlled. An uncontrolled chapter resets to 0 when the book
   * changes. @defaultValue 0
   */
  chapterIndex?: number;
  /**
   * Called with the chapter the reader moves to. Passing it makes
   * {@link MejiroReaderCommonProps.chapterIndex} controlled.
   */
  onChapterIndexChange?: (chapterIndex: number) => void;
  /**
   * Layout spread to show — always a spread of the chapter layout, also in
   * single-page mode, where the spread opens on its right page (the first in
   * reading order). The initial spread unless
   * {@link MejiroReaderCommonProps.onSpreadIndexChange} is given, which makes
   * it controlled. A spread index does not survive a re-layout; use `anchor`
   * to keep a reading position. @defaultValue 0
   */
  spreadIndex?: number;
  /**
   * Called with the layout spread the reader moves to. Turning from the right
   * to the left page of one spread in single-page mode keeps the spread, so it
   * does not fire; follow `onAnchorChange` for page-level changes. Passing it
   * makes {@link MejiroReaderCommonProps.spreadIndex} controlled.
   */
  onSpreadIndexChange?: (spreadIndex: number) => void;
  /**
   * Reading position to show. When given, it decides the chapter and spread
   * and `chapterIndex` / `spreadIndex` are not read. The initial position
   * unless {@link MejiroReaderCommonProps.onAnchorChange} is given, which
   * makes it controlled.
   */
  anchor?: ReadingAnchor | null;
  /**
   * Called with the anchor at the start of the text the reader moves to, on
   * each move of the visible page(s) or chapter. Passing it makes
   * {@link MejiroReaderCommonProps.anchor} controlled. Pair with
   * `useReadingPosition` to persist the position.
   */
  onAnchorChange?: (anchor: ReadingAnchor) => void;
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
   * page at a time; `auto` flips to `single` for portrait viewports, keeping
   * the page on screen visible.
   */
  spreadMode?: MejiroSpreadMode;
  /**
   * How the reader sizes itself in its container. `fill` (default) fills the
   * container height and letterboxes the spread; `width` makes the reader
   * self-size — it derives its height from its width and the page aspect, so an
   * embedding host only has to constrain the width (no height/aspect magic
   * numbers, no letterbox). In `width` mode the reserved `gutterOffset` /
   * `headerOffset` default to 0 so the spread fills edge-to-edge; override via
   * {@link MejiroReaderCommonProps.pageGeometry} if you still want them. @defaultValue 'fill'
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
   * Custom EPUB fetcher used in place of the global `fetch`; resolves to the
   * raw bytes. `options.signal` aborts when the load is superseded or the
   * reader unmounts. Overrides {@link MejiroReaderCommonProps.fetchOptions}
   * when set.
   */
  fetchEpub?: (url: string, options: FetchEpubOptions) => Promise<BinaryInput>;
  /**
   * Built-in locale for UI strings (`'en'` / `'ja'`). Pair with `messages`
   * to override individual strings. Defaults to the nearest `MejiroI18nProvider`
   * locale, or `'en'` without one.
   */
  locale?: MejiroLocale;
  /**
   * Partial override of the message catalog. Merged on top of the catalog
   * selected by `locale`. Useful for projects that ship their own UI strings
   * without re-implementing every label.
   */
  messages?: Partial<MejiroMessages>;
  /**
   * Header title text. The header — chapter select, stats, Open / Image /
   * Settings buttons — is drawn only when a title or a
   * {@link MejiroReaderCommonProps.logo} is given.
   */
  title?: string;
  /** Header subtitle, shown under the title. @defaultValue `messages.logoSubtitle` */
  subtitle?: string;
  /**
   * Header slot replacing the default logo block (title + subtitle). Giving
   * it draws the header; pass `null` to draw the header without a logo.
   */
  logo?: ReactNode;
  /**
   * Show the drop zone affordance. SaaS-style readers should keep this off
   * (the host controls which EPUB is delivered); set true to accept
   * user-supplied books.
   * @defaultValue false
   */
  enableDropZone?: boolean;
  /**
   * Where to render the built-in chapter navigation; `'none'` renders
   * neither. The `'select'` dropdown sits in the header.
   * @defaultValue 'select'
   */
  chapterNavMode?: MejiroChapterNavMode;
  /**
   * Show the settings panel and its header toggle. @defaultValue true
   */
  showSettings?: boolean;
  /**
   * Replaces the built-in settings controls with custom UI while keeping the
   * panel chrome and its open/close accordion. Receives a
   * {@link MejiroReaderSettingsSlot} wired to the live reader, so a host can
   * build its own settings form without a parallel `options` shadow. The header
   * "Settings" button still toggles the panel. `showSettings` remains the
   * on/off switch.
   */
  renderSettings?: (slot: MejiroReaderSettingsSlot) => ReactNode;
  /** Show the header button that places a sample image overlay. @defaultValue false */
  showImageOverlayButton?: boolean;
  /** Show the layout statistics in the header. @defaultValue false */
  showStats?: boolean;
  /**
   * Bind ArrowLeft / ArrowRight to navigation while focus is inside the
   * reader. The reader root takes focus for this. @defaultValue true
   */
  enableKeyboard?: boolean;
  /** Show the "n / total" indicator. @defaultValue true */
  showPageIndicator?: boolean;
  /**
   * Which page of a spread shows its page number in the running head.
   * `'both'` numbers each page (right = odd, left = even), `'right'` /
   * `'left'` number only that side, `'none'` hides them (the
   * {@link MejiroReaderCommonProps.showPageIndicator} "n / total" badge is
   * independent). @defaultValue 'both'
   */
  pageNumbers?: PageNumberDisplay;
  /**
   * Reader-side annotations to render as highlights. Each annotation whose
   * `chapterIndex` matches the current chapter is converted to spread-local
   * rectangles via `ChapterLayout.selectionRects`; the rectangles landing on
   * the spread on screen are drawn on top of the page content. Pair with
   * {@link useAnnotations} for persistence.
   */
  annotations?: readonly ReaderAnnotation[];

  /** Called after a successful EPUB load. */
  onLoad?: (epub: EpubBook) => void;
  /**
   * Called when loading or parsing an EPUB fails, and when applying an option
   * change fails (such as a font that measures as a fallback under
   * `strictFontCheck`; without it, a font that fails to load is not an error).
   */
  onError?: (error: Error) => void;
  /**
   * Called when the reader moves from one position to another within the
   * shown book (a change of chapter or navigation position). Receives the
   * anchor of the position that was just left and the dwell time in
   * milliseconds (computed via `performance.now()`). A book swap and unmount
   * do not report the position being left. Useful for engagement analytics.
   */
  onPageRead?: (anchor: ReadingAnchor, dwellMs: number) => void;
  /**
   * Called with the chapter index when the reader reaches the last position
   * of a chapter. Same trigger as the `chapterFinished` event on
   * {@link MejiroReaderHandle.subscribe}.
   */
  onChapterFinished?: (chapterIndex: number) => void;
}

/**
 * Parsed-source variant: render a pre-parsed `EpubBook`. Pass `null` to
 * render an empty reader (e.g. while the book is still loading on the host).
 */
export interface MejiroReaderParsedProps extends MejiroReaderCommonProps {
  /** Pre-parsed EPUB. Cannot be combined with `epubUrl` / `manuscript`. */
  epub: EpubBook | null;
  /** Not accepted alongside `epub`. */
  epubUrl?: never;
  /** Not accepted alongside `epub`. */
  manuscript?: never;
}

/**
 * URL-source variant: the reader fetches and parses the EPUB itself.
 * Use this for "just open this book" scenarios.
 */
export interface MejiroReaderUrlProps extends MejiroReaderCommonProps {
  /** EPUB URL, fetched on mount and whenever it changes. Cannot be combined with `epub` / `manuscript`. */
  epubUrl: string;
  /** Not accepted alongside `epubUrl`. */
  epub?: never;
  /** Not accepted alongside `epubUrl`. */
  manuscript?: never;
}

/**
 * Picker-source variant: the reader exposes its drop zone / file picker.
 * Neither `epub` nor `epubUrl` is supplied — useful for free-form viewers
 * that accept user-supplied books.
 */
export interface MejiroReaderPickerProps extends MejiroReaderCommonProps {
  /** Not accepted by the picker source. */
  epub?: never;
  /** Not accepted by the picker source. */
  epubUrl?: never;
  /** Not accepted by the picker source. */
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
  /** Not accepted alongside `manuscript`. */
  epub?: never;
  /** Not accepted alongside `manuscript`. */
  epubUrl?: never;
}

/**
 * Props for {@link MejiroReader}. Discriminated union of the four source
 * modes — TypeScript prevents passing more than one source at once.
 */
export type MejiroReaderProps =
  | MejiroReaderParsedProps
  | MejiroReaderUrlProps
  | MejiroReaderPickerProps
  | MejiroReaderManuscriptProps;

/** A position the reader holds for a controlled pair, or `null` when nothing pins it. */
type PinnedPosition =
  | { kind: 'anchor'; anchor: ReadingAnchor }
  | { kind: 'spread'; spreadIndex: number }
  | null;

/** Navigation state of the last commit, as the index-change handler compares against it. */
interface ShownNavigation {
  chapterIndex: number;
  book: unknown;
  index: number;
  single: boolean;
}

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
    chapterIndex: chapterIndexProp,
    onChapterIndexChange,
    spreadIndex: spreadIndexProp,
    onSpreadIndexChange,
    anchor: anchorProp,
    onAnchorChange,
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
    title,
    subtitle,
    logo,
    enableDropZone = false,
    chapterNavMode = 'select',
    showSettings = true,
    renderSettings,
    showImageOverlayButton = false,
    showStats = false,
    enableKeyboard = true,
    showPageIndicator = true,
    pageNumbers = 'both',
    annotations,
    onLoad,
    onError,
    onPageRead,
    onChapterFinished,
  } = props;

  const anchorGiven = anchorProp != null;
  const anchorControlled = onAnchorChange !== undefined;
  const chapterControlled = onChapterIndexChange !== undefined;
  const spreadControlled = onSpreadIndexChange !== undefined;
  // A given anchor wins over the index pairs; a controlled pair holds the host's value.
  const pinned: PinnedPosition =
    anchorGiven && (anchorControlled || chapterControlled || spreadControlled)
      ? { kind: 'anchor', anchor: anchorProp }
      : spreadControlled
        ? { kind: 'spread', spreadIndex: positionIndex(spreadIndexProp) }
        : null;
  const chapterPinned = chapterControlled || pinned?.kind === 'anchor';
  const pinnedChapter = anchorGiven
    ? positionIndex(anchorProp.chapterIndex)
    : positionIndex(chapterIndexProp);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterState, setChapterState] = useState(pinnedChapter);
  const [chromeHidden, setChromeHidden] = useState(false);
  // Page a user scroll settled on, scoped to the layout it was reported against.
  const [userScroll, setUserScroll] = useState<{ layout: ChapterLayout; page: number } | null>(
    null,
  );
  const [autoSingle, setAutoSingle] = useState(false);

  useEffect(() => {
    if (spreadMode !== 'auto') return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const update = () => {
      const rect = surface.getBoundingClientRect();
      // A `fit="width"` surface derives its height from the current mode, so
      // its width is judged against the viewport height the host supplies.
      setAutoSingle(rect.width < (fit === 'width' ? window.innerHeight : rect.height));
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(surface);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [spreadMode, fit]);

  const resolvedSpreadMode: ResolvedSpreadMode =
    spreadMode === 'single' || (spreadMode === 'auto' && autoSingle) ? 'single' : 'double';
  const single = resolvedSpreadMode === 'single';

  // Page geometry forwarded to `fitPageSize`. In `fit="width"` mode the
  // surface self-sizes its height from its width via `aspect-ratio`, and the
  // book must exactly fill it. The fill-mode safety rails fight that invariant:
  // the reserved gutter / header offsets, the `maxHeight` cap, and the
  // `minWidth` / `minHeight` floors would size the book to something other than
  // the surface, leaving a reserved empty band around the spread. So default
  // them all off here (offsets 0, no clamp) — the spread tracks the surface
  // edge-to-edge. The host can still override any field via `pageGeometry`.
  const resolvedGeometry = useMemo<FitPageSizeOptions>(() => {
    // A single-page reader derives its page width from the full container width
    // instead of halving it for a two-page spread (the host can still override
    // `columns` via `pageGeometry`).
    const columns: 1 | 2 = single ? 1 : 2;
    const geometry = pageGeometryProp ?? {};
    if (fit !== 'width') return mergeDefined<FitPageSizeOptions>({ columns }, geometry);
    return mergeDefined<FitPageSizeOptions>(
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
  }, [fit, pageGeometryProp, single]);

  // The spread aspect (width / height) used to self-size the surface in
  // `fit="width"` mode: one or two page columns wide, `aspect` tall. Exposed as
  // a CSS `aspect-ratio` value so the browser derives the surface height from
  // its width with no JS measurement feedback loop.
  const surfaceAspect = useMemo(() => {
    const columns = single ? 1 : 2;
    const aspect = resolvedGeometry.aspect ?? DEFAULT_PAGE_GEOMETRY.aspect;
    return `${columns} / ${aspect}`;
  }, [single, resolvedGeometry]);

  const resolvedOptions = useMemo<BookOptions>(
    () => mergeDefined<BookOptions>(DEFAULT_BOOK_OPTIONS, optionsProp ?? {}),
    [optionsProp],
  );

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const reportError = useCallback((error: Error) => onErrorRef.current?.(error), []);

  // Option changes are coalesced before they reach the book: the settings panel
  // emits one per keystroke / slider step, and every metric change costs a font
  // load plus a full re-measurement. Failures surface through `onError` instead
  // of an unhandled rejection, since most call sites here are fire-and-forget.
  // The hook follows the runtime keys of `options` by content.
  const {
    book,
    options: bookOptions,
    updateOptions: applyBookOptions,
  } = useMejiroBook(resolvedOptions, {
    debounceMs: OPTIONS_DEBOUNCE_MS,
    onError: reportError,
  });
  // Settles with the latest application (never rejects: failures go to onError).
  const lastApplyRef = useRef<Promise<void>>(Promise.resolve());
  const updateOptions = useCallback(
    (patch: BookOptionsPatch): Promise<void> => {
      const applied = applyBookOptions(patch);
      lastApplyRef.current = applied;
      return applied;
    },
    [applyBookOptions],
  );

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
    url: epubProp !== undefined || manuscriptProp !== undefined ? undefined : epubUrl,
    fetchOptions,
    limits,
    fetchEpub: fetchEpubFn,
    onLoad: (loaded) => {
      clearOverlaysRef.current();
      onLoad?.(loaded);
    },
  });

  const sourceGiven = epubProp !== undefined || manuscriptProp !== undefined;
  const isManuscriptSource = manuscriptProp !== undefined;
  const e = isManuscriptSource ? synthesizedEpub : sourceGiven ? (epubProp ?? null) : epubCtx.epub;
  // Book identity: changes on a swap, not on a manuscript content edit.
  const sourceKey = isManuscriptSource ? MANUSCRIPT_SOURCE : bookIdentity(epubProp);
  const bookKey: unknown = sourceGiven ? sourceKey : epubCtx.epub;
  // A book swap resets the uncontrolled chapter in the same render that first
  // sees the new book, so the one layout started for it targets chapter 0.
  const [seenBookKey, setSeenBookKey] = useState<unknown>(bookKey);
  let chapterRaw = chapterState;
  if (seenBookKey !== bookKey) {
    setSeenBookKey(bookKey);
    if (!chapterPinned) {
      setChapterState(0);
      chapterRaw = 0;
    }
  }
  const chapter = clampChapter(chapterPinned ? pinnedChapter : chapterRaw, e);
  // A given source owns the book, so the reader offers no file of its own.
  const filePicker = enableDropZone && !sourceGiven;

  useEffect(() => {
    if (epubCtx.error) onErrorRef.current?.(epubCtx.error);
  }, [epubCtx.error]);

  // Refs that let the (stable) layout-hook callbacks read the latest
  // geometry and position without re-creating `recompute`.
  const pageGeometryRef = useRef(resolvedGeometry);
  pageGeometryRef.current = resolvedGeometry;
  // Reads the current position through the same anchor resolution `getAnchor`
  // uses (skips image-blocked pages, handles single mode); set once `spreadCtx`
  // exists below.
  const spreadAnchorRef = useRef<() => InChapterAnchor | null>(() => null);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  // Anchor at the start of the position on screen, taken when that position
  // settled: an option change re-paginates the live layout in place before the
  // reflow captures from it, so reading the layout at capture time can drift.
  const visibleAnchorRef = useRef<{ layout: ChapterLayout; anchor: InChapterAnchor | null } | null>(
    null,
  );
  // An edit outside the shown chapter keeps the layout source as it was.
  const layoutMemoRef = useRef<LayoutEpubMemo | null>(null);
  layoutMemoRef.current = resolveLayoutEpub(layoutMemoRef.current, e, bookKey, chapter);
  const layoutCtx = useChapterLayout(book, {
    epub: layoutMemoRef.current.epub,
    chapterIndex: chapter,
    surface: surfaceRef,
    pageGeometry: () => pageGeometryRef.current,
    // Preserve the reading position across a reflow re-layout (size / option
    // changes) unless a controlled pair pins it — the pinned-position restore
    // below handles that case.
    capturePosition: (layout) => {
      if (pinnedRef.current != null) return null;
      const visible = visibleAnchorRef.current;
      if (visible?.layout === layout) return visible.anchor;
      return spreadAnchorRef.current();
    },
    onError: reportError,
  });

  // Navigation the reader applies itself (restores, pinned positions); the
  // index-change handler does not report it to the host.
  const programmaticIndexRef = useRef<number | null>(null);
  // Layout spread / anchor reported to the host in the current commit, read by the reconcile below.
  const reportedRef = useRef(false);
  const shownNavigationRef = useRef<ShownNavigation | null>(null);
  const indexChangedRef = useRef<(index: number) => void>(() => {});
  const spreadCtx = useSpread(layoutCtx.layout, {
    enableKeyboard: false,
    spreadMode: resolvedSpreadMode,
    onIndexChange: (index) => indexChangedRef.current(index),
  });
  spreadAnchorRef.current = () => spreadCtx.anchorAt(spreadCtx.index);
  const indexOfPageRef = useRef(spreadCtx.indexOfPage);
  indexOfPageRef.current = spreadCtx.indexOfPage;
  const anchorAtRef = useRef(spreadCtx.anchorAt);
  anchorAtRef.current = spreadCtx.anchorAt;
  const spreadIndexNowRef = useRef(spreadCtx.spreadIndex);
  spreadIndexNowRef.current = spreadCtx.spreadIndex;
  const spreadGoToRef = useRef(spreadCtx.goTo);
  spreadGoToRef.current = spreadCtx.goTo;
  const singleRef = useRef(single);
  singleRef.current = single;

  /** Moves to navigation index `index` as the reader's own doing, not reported to the host. */
  const applyIndex = useCallback((index: number, animate = false) => {
    programmaticIndexRef.current = index;
    spreadGoToRef.current(index, { animate });
  }, []);

  const onSpreadIndexChangeRef = useRef(onSpreadIndexChange);
  onSpreadIndexChangeRef.current = onSpreadIndexChange;
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;
  const reportAnchor = useCallback((anchor: ReadingAnchor) => {
    reportedRef.current = true;
    onAnchorChangeRef.current?.(anchor);
  }, []);
  // Runs after useSpread's index effect, so the handler sees the previous commit here.
  useEffect(() => {
    shownNavigationRef.current = {
      chapterIndex: chapter,
      book: bookKey,
      index: spreadCtx.index,
      single,
    };
  });
  // A replaced layout opens at index 0; that reset is not navigation.
  useLayoutEffect(() => {
    if (layoutCtx.layout) programmaticIndexRef.current = 0;
  }, [layoutCtx.layout]);
  indexChangedRef.current = (index: number) => {
    const prev = shownNavigationRef.current;
    const programmatic = programmaticIndexRef.current === index;
    programmaticIndexRef.current = null;
    // A mode flip converts the index, and a chapter or book change starts over; neither is a move.
    if (programmatic || !prev || prev.single !== single) return;
    if (prev.chapterIndex !== chapter || prev.book !== bookKey) return;
    const spreadIndex = spreadIndexOfNavigation(index, single);
    if (spreadIndexOfNavigation(prev.index, single) !== spreadIndex) {
      reportedRef.current = true;
      onSpreadIndexChangeRef.current?.(spreadIndex);
    }
    const anchor = anchorAtRef.current(index);
    if (anchor && !sameAnchor(anchor, anchorAtRef.current(prev.index))) {
      reportAnchor({ chapterIndex: chapter, ...anchor });
    }
  };

  // A single/double flip keeps the anchor of the page that was on screen: the
  // converted index may start earlier, and the re-layout restores from it.
  const anchorSingleRef = useRef(single);
  useLayoutEffect(() => {
    const l = layoutCtx.layout;
    const flipped = anchorSingleRef.current !== single;
    anchorSingleRef.current = single;
    if (flipped && l && visibleAnchorRef.current?.layout === l) return;
    visibleAnchorRef.current = l
      ? { layout: l, anchor: spreadCtx.anchorAt(spreadCtx.index) }
      : null;
  }, [layoutCtx.layout, spreadCtx.index, spreadCtx.anchorAt, single]);

  // Restore the reading position after a reflow re-layout. This runs *after*
  // useSpread's own layout effect has reset the index to 0 (useSpread is called
  // above, so its effect is registered first), so the anchor-derived index wins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the layout object; refs hold the latest callbacks.
  useLayoutEffect(() => {
    const anchor = layoutCtx.pendingRestore.current;
    if (!(anchor && layoutCtx.layout)) return;
    layoutCtx.pendingRestore.current = null;
    const loc = layoutCtx.layout.locateAnchor(anchor);
    applyIndex(loc ? indexOfPageRef.current(loc.pageIndex) : 0);
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
  const geometryKey = JSON.stringify(resolvedGeometry);
  const geometryKeyRef = useRef(geometryKey);
  useEffect(() => {
    if (geometryKeyRef.current === geometryKey) return;
    geometryKeyRef.current = geometryKey;
    void recomputeRef.current({ blank: false });
  }, [geometryKey]);

  const imageCtx = useImageOverlay(layoutCtx.layout, {
    spreadIndex: spreadCtx.spreadIndex,
    defaultX: IMAGE_DEFAULT_X,
    onReflow: () => spreadCtx.refresh(),
  });

  // The layout reflows in place when images change, so the image state keys this too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentImages changes whenever the layout's exclusions do.
  const annotationRects = useMemo(() => {
    if (!(annotations && layoutCtx.layout)) return [];
    const result = [];
    for (const annotation of annotations) {
      if (annotation.chapterIndex !== chapter) continue;
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

  // A given source is rendered directly instead of being copied into the
  // loader state. Copying introduces a render where layout can see the old
  // book with the new chapter index. A book swap is a new `epub` object or a
  // switch into manuscript source; manuscript content edits are not.
  const clearOverlaysRef = useRef(imageCtx.clearOverlays);
  clearOverlaysRef.current = imageCtx.clearOverlays;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const eRef = useRef(e);
  eRef.current = e;
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourceKey is the book identity this effect keys on.
  useEffect(() => {
    if (!sourceGiven) return;
    clearOverlaysRef.current();
    book.clearCache();
    if (eRef.current) onLoadRef.current?.(eRef.current);
  }, [sourceGiven, sourceKey, book]);

  // Images belong to the chapter they were placed on; another chapter starts bare.
  const imagesChapterRef = useRef(chapter);
  useEffect(() => {
    if (imagesChapterRef.current === chapter) return;
    imagesChapterRef.current = chapter;
    clearOverlaysRef.current();
  }, [chapter]);

  const onChapter = useCallback(
    (index: number) => {
      const i = clampChapter(index, e);
      if (i === chapter) return;
      if (!chapterPinned) setChapterState(i);
      onChapterIndexChange?.(i);
      // Another chapter opens at its first spread.
      if (spreadIndexNowRef.current !== 0) onSpreadIndexChangeRef.current?.(0);
      reportAnchor({ chapterIndex: i, paragraphIndex: 0, charIndex: 0 });
    },
    [chapter, chapterPinned, onChapterIndexChange, e, reportAnchor],
  );
  const onChapterRef = useRef(onChapter);
  onChapterRef.current = onChapter;

  // ── Event bus + anchor handling ──
  type EventName = keyof MejiroReaderEventMap;
  type AnyListener = (payload: never) => void;
  const listenersRef = useRef<Map<EventName, Set<AnyListener>>>(new Map());
  const emit = useCallback(
    <E extends EventName>(event: E, payload: Parameters<MejiroReaderEventMap[E]>[0]): void => {
      const set = listenersRef.current.get(event);
      if (!set) return;
      for (const cb of set) (cb as MejiroReaderEventMap[E])(payload as never);
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
  const anchorTarget: AnchorTarget = {
    book: epubCtx.loading ? null : e,
    chapterIndex: chapter,
    layout,
  };
  const anchorTargetRef = useRef(anchorTarget);
  anchorTargetRef.current = anchorTarget;
  const indexNowRef = useRef(spreadCtx.index);
  indexNowRef.current = spreadCtx.index;
  const anchorResolverRef = useRef<ReturnType<typeof createAnchorResolver> | null>(null);
  anchorResolverRef.current ??= createAnchorResolver({
    goToChapter: (i) => onChapterRef.current(i),
    goToPage: (pageIndex, report) => {
      const target = indexOfPageRef.current(pageIndex);
      if (target === indexNowRef.current) return false;
      if (report) spreadGoToRef.current(target, { animate: false });
      else applyIndex(target);
      return true;
    },
  });
  // The initial position the value props give, applied once.
  const initialRef = useRef<{ anchor: ReadingAnchor | null; spreadIndex: number | null } | null>(
    null,
  );
  initialRef.current ??= {
    anchor: pinned == null && anchorGiven ? anchorProp : null,
    spreadIndex:
      pinned == null && !anchorGiven && spreadIndexProp !== undefined
        ? positionIndex(spreadIndexProp)
        : null,
  };
  const [initialPending, setInitialPending] = useState(
    () => initialRef.current?.anchor != null || initialRef.current?.spreadIndex != null,
  );
  useEffect(() => {
    const initial = initialRef.current;
    const anchor = initial?.anchor;
    if (!(initial && anchor)) return;
    initial.anchor = null;
    void anchorResolverRef.current
      ?.request(anchor, anchorTargetRef.current, false)
      .then(() => setInitialPending(false));
  }, []);
  useLayoutEffect(() => {
    const initial = initialRef.current;
    if (initial?.spreadIndex == null || !layout) return;
    const spreadIndex = initial.spreadIndex;
    initial.spreadIndex = null;
    applyIndex(navigationIndexOfSpread(spreadIndex, singleRef.current));
    setInitialPending(false);
  }, [layout, applyIndex]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target ref is read for these values.
  useEffect(() => {
    anchorResolverRef.current?.update(anchorTargetRef.current);
  }, [anchorTarget.book, chapter, layout, spreadCtx.index]);
  // Settle any in-flight anchor on unmount so awaiting callers never hang.
  useEffect(() => () => anchorResolverRef.current?.dispose(), []);

  /** Navigation index the pinned position asks for in `l`, or `null` when it cannot be placed. */
  const pinnedIndexIn = useCallback(
    (l: ChapterLayout, position: NonNullable<PinnedPosition>, shown: number): number | null => {
      const isSingle = singleRef.current;
      if (position.kind === 'anchor') {
        const loc = l.locateAnchor(position.anchor);
        return loc ? indexOfPageRef.current(loc.pageIndex) : null;
      }
      const spreadCount = Math.ceil(l.pageCount / 2);
      if (spreadCount === 0) return null;
      const spreadIndex = Math.min(spreadCount - 1, position.spreadIndex);
      // Any page of the pinned spread satisfies a spread pin.
      if (spreadIndexOfNavigation(shown, isSingle) === spreadIndex) return shown;
      return navigationIndexOfSpread(spreadIndex, isSingle);
    },
    [],
  );

  // Pinned position after a reflow re-layout: a re-layout resets useSpread to
  // 0, so return to the pinned position before paint. Only a reflow of the same
  // (book, chapter) restores; a chapter or book change keeps the reset to 0,
  // which the reconcile below reports to the host first.
  const restoredForRef = useRef<{ chapter: number; book: unknown } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the layout object; chapter and bookKey are those the layout was built for.
  useLayoutEffect(() => {
    if (!layoutCtx.layout) return;
    const previous = restoredForRef.current;
    restoredForRef.current = { chapter, book: bookKey };
    if (previous && (previous.chapter !== chapter || previous.book !== bookKey)) return;
    const position = pinnedRef.current;
    if (!position) return;
    const target = pinnedIndexIn(layoutCtx.layout, position, 0);
    if (target != null && target !== 0) applyIndex(target);
  }, [layoutCtx.layout]);

  // Pinned position → host-driven navigation. Every commit is reconciled, not
  // just the ones where the prop changed: a host that rejects a move (keeping
  // its value) must see the reader return to that value, so the drift is
  // snapped back without a turn animation. A move reported in this very commit
  // gets one more commit for the host to follow before it counts as rejected.
  const pinnedKey = pinned ? JSON.stringify(pinned) : null;
  const appliedPinnedKeyRef = useRef(pinnedKey);
  const [hostTurn, setHostTurn] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hostTurn re-runs the reconcile one commit later.
  useEffect(() => {
    const reported = reportedRef.current;
    reportedRef.current = false;
    const position = pinnedRef.current;
    const changed = appliedPinnedKeyRef.current !== pinnedKey;
    if (!(position && layout) || anchorResolverRef.current?.pending()) return;
    appliedPinnedKeyRef.current = pinnedKey;
    const target = pinnedIndexIn(layout, position, spreadCtx.index);
    if (target == null || target === spreadCtx.index) return;
    if (changed) applyIndex(target, position.kind === 'spread');
    else if (reported) setHostTurn((n) => n + 1);
    else applyIndex(target);
  }, [pinnedKey, layout, spreadCtx.index, hostTurn]);

  // spreadIndexChange / chapterFinished / onPageRead are all decided by the tracker.
  const onPageReadRef = useRef(onPageRead);
  onPageReadRef.current = onPageRead;
  const onChapterFinishedRef = useRef(onChapterFinished);
  onChapterFinishedRef.current = onChapterFinished;
  const trackLifecycleRef = useRef<ReturnType<typeof createLifecycleTracker> | null>(null);
  trackLifecycleRef.current ??= createLifecycleTracker({
    spreadIndexChange: (chapterIndex, spreadIndex) =>
      emit('spreadIndexChange', { chapterIndex, spreadIndex }),
    chapterFinished: (chapterIndex) => {
      emit('chapterFinished', { chapterIndex });
      onChapterFinishedRef.current?.(chapterIndex);
    },
    pageRead: (anchor, dwellMs) => onPageReadRef.current?.(anchor, dwellMs),
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: pinnedKey stands for the pinned position read below.
  useEffect(() => {
    // Counted from the layout: the spread on screen may still be the previous chapter's.
    const view = layout
      ? {
          count: single ? layout.pageCount : Math.ceil(layout.pageCount / 2),
          spreadIndex: spreadCtx.spreadIndex,
          anchor: spreadCtx.anchorAt(spreadCtx.index),
        }
      : null;
    const position = pinnedRef.current;
    const settling =
      initialPending ||
      (layout != null &&
        position != null &&
        (pinnedIndexIn(layout, position, spreadCtx.index) ?? spreadCtx.index) !== spreadCtx.index);
    trackLifecycleRef.current?.(bookKey, chapter, spreadCtx.index, view, settling);
  }, [
    bookKey,
    chapter,
    spreadCtx.index,
    spreadCtx.spreadIndex,
    spreadCtx.anchorAt,
    single,
    layout,
    pinnedKey,
    initialPending,
    pinnedIndexIn,
  ]);

  // Emit turnStart / turnEnd on the `turning` transition.
  const prevTurningRef = useRef(false);
  useEffect(() => {
    if (spreadCtx.turning && !prevTurningRef.current) {
      emit('turnStart', { from: spreadCtx.index });
    } else if (!spreadCtx.turning && prevTurningRef.current) {
      emit('turnEnd', { to: spreadCtx.index });
    }
    prevTurningRef.current = spreadCtx.turning;
  }, [spreadCtx.turning, spreadCtx.index, emit]);

  useImperativeHandle(
    ref,
    () => ({
      goToSpread: (spreadIndex: number) => {
        if (!Number.isInteger(spreadIndex)) {
          throw new RangeError(`goToSpread index must be an integer; got ${spreadIndex}`);
        }
        spreadGoToRef.current(navigationIndexOfSpread(spreadIndex, singleRef.current));
      },
      next: () => spreadCtx.next(),
      prev: () => spreadCtx.prev(),
      goToChapter: (i: number) => onChapter(i),
      getSpreadPosition: () => ({
        chapterIndex: chapter,
        spreadIndex: spreadCtx.spreadIndex,
        spreadCount: spreadCtx.spreadCount,
        pageCount: spreadCtx.pageCount,
      }),
      goToAnchor: (anchor: ReadingAnchor) =>
        anchorResolverRef.current?.request(anchor, anchorTargetRef.current, true) ??
        Promise.resolve(),
      getAnchor: () => {
        if (!layout) return null;
        const inCh = spreadCtx.anchorAt(spreadCtx.index);
        return inCh ? { chapterIndex: chapter, ...inCh } : null;
      },
      getVisibleRange: () => {
        if (!layout) return null;
        const start = spreadCtx.anchorAt(spreadCtx.index);
        if (!start) return null;
        const end = spreadCtx.anchorAt(spreadCtx.index + 1) ?? layout.endAnchor() ?? start;
        return {
          start: { chapterIndex: chapter, ...start },
          end: { chapterIndex: chapter, ...end },
        };
      },
      updateOptions: (patch: BookOptionsPatch) => updateOptions(patch),
      subscribe: <E extends EventName>(event: E, listener: MejiroReaderEventMap[E]) => {
        let set = listenersRef.current.get(event);
        if (!set) {
          set = new Set();
          listenersRef.current.set(event, set);
        }
        set.add(listener as AnyListener);
        return () => {
          listenersRef.current.get(event)?.delete(listener as AnyListener);
        };
      },
    }),
    [
      spreadCtx.next,
      spreadCtx.prev,
      spreadCtx.index,
      spreadCtx.spreadIndex,
      spreadCtx.spreadCount,
      spreadCtx.pageCount,
      spreadCtx.anchorAt,
      onChapter,
      chapter,
      layout,
      updateOptions,
    ],
  );

  const editable: EditableSettings = {
    fontFamily: bookOptions.fontFamily,
    fontSize: bookOptions.fontSize,
    lineSpacing: bookOptions.lineSpacing ?? DEFAULT_BOOK_OPTIONS.lineSpacing,
    kinsoku: bookOptions.kinsoku ?? 'strict',
    enableHanging: bookOptions.enableHanging ?? true,
  };
  const applySettings = useCallback(
    (next: EditableSettings) => {
      void updateOptions({
        fontFamily: next.fontFamily,
        fontSize: next.fontSize,
        lineSpacing: next.lineSpacing,
        kinsoku: next.kinsoku,
        enableHanging: next.enableHanging,
      });
    },
    [updateOptions],
  );

  const fontLabel = (() => {
    const css = normalizeFontFamily(bookOptions.fontFamily);
    const f = fonts?.find((x) => x.value === css);
    const name = f?.label ?? css;
    return `${name} ${bookOptions.fontSize}px`;
  })();

  const showChapterSelect = e && (chapterNavMode === 'select' || chapterNavMode === 'both');
  const showChapterPanel = e && (chapterNavMode === 'panel' || chapterNavMode === 'both');
  const runningTitleRight = e ? (e.author ? `${e.author}  ${e.title}` : e.title) : '';
  const runningTitleLeft = e?.chapters[chapter]?.title ?? '';
  const layoutReady = e && spreadCtx.spread && layoutCtx.layout && layoutCtx.pageWidth > 0;

  const themeName: MejiroThemeName = typeof theme === 'string' ? theme : theme.name;
  const themeOverride = typeof theme === 'string' ? undefined : theme.override;
  const themeStyle = useMemo<CSSProperties | undefined>(() => {
    // Keep the page's *visual* padding (CSS vars) in sync with the *layout*
    // padding (`pageGeometry.padding*`). Without this the text is laid out for
    // one inset but clipped at another, so a custom padding overflows the page.
    const styleVars: Record<string, string> = {};
    if (pageGeometryProp?.paddingX != null) {
      styleVars['--mejiro-page-pad-x'] = `${pageGeometryProp.paddingX}px`;
    }
    if (pageGeometryProp?.paddingY != null) {
      styleVars['--mejiro-page-pad-y'] = `${pageGeometryProp.paddingY}px`;
    }
    if (pageGeometryProp?.paddingBottom != null) {
      styleVars['--mejiro-page-pad-bottom'] = `${pageGeometryProp.paddingBottom}px`;
    }
    // In `fit="width"` the surface self-sizes from this aspect ratio.
    if (fit === 'width') styleVars['--mejiro-surface-aspect'] = surfaceAspect;
    const hasVars = Object.keys(styleVars).length > 0;
    if (!(themeOverride || hasVars)) return undefined;
    return { ...themeOverride, ...styleVars } as CSSProperties;
  }, [themeOverride, pageGeometryProp, fit, surfaceAspect]);

  const resolvedMessages = useI18n({ locale, messages });
  const effectiveSubtitle = subtitle ?? resolvedMessages.logoSubtitle;

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (!enableKeyboard || ignoreNavigationKey(event)) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      spreadCtx.next();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      spreadCtx.prev();
    }
  };

  const defaultLogo = (
    <div className="mejiro-reader-logo">
      <span className="mejiro-reader-logo-mark">{title}</span>
      {effectiveSubtitle && <span className="mejiro-reader-logo-sub">{effectiveSubtitle}</span>}
    </div>
  );
  const header =
    title !== undefined || logo !== undefined ? (
      <header className="mejiro-reader-header">
        <div className="mejiro-reader-header-left">
          {logo === undefined ? defaultLogo : logo}
          {showChapterSelect && (
            <MejiroChapterNav epub={e} chapterIndex={chapter} onChapterIndexChange={onChapter} />
          )}
        </div>
        <div className="mejiro-reader-header-actions">
          {showStats && (
            <MejiroStats
              chapter={e?.chapters[chapter] ?? null}
              pageCount={spreadCtx.pageCount}
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
          {showImageOverlayButton && e && (
            <button
              type="button"
              className={`mejiro-reader-btn${imageCtx.hasOverlays ? ' is-active' : ''}`}
              onClick={() =>
                imageCtx.addOverlay(
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
          {showSettings && (
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

  const currentSpread = spreadCtx.spreadIndex;
  const leftPage = currentSpread * 2 + 2;
  const showLeft = spreadCtx.spread != null && leftPage <= spreadCtx.spread.pageCount;
  const pageIndicator = showPageIndicator ? (
    <MejiroPageIndicator index={spreadCtx.index} count={spreadCtx.count} />
  ) : null;

  return (
    <MejiroI18nProvider messages={resolvedMessages}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the reader root takes keyboard navigation for the whole reader. */}
      <div
        className={`mejiro-reader${chromeHidden ? ' mejiro-reader--chrome-hidden' : ''}${fit === 'width' ? ' mejiro-reader--fit-width' : ''}`}
        data-mejiro-theme={themeName}
        style={themeStyle}
        tabIndex={enableKeyboard ? 0 : undefined}
        onKeyDown={onRootKeyDown}
      >
        {header}
        {showSettings &&
          (renderSettings ? (
            <div className={`mejiro-reader-settings-panel${settingsOpen ? ' is-open' : ''}`}>
              <div className="mejiro-reader-settings-inner">
                <div className="mejiro-reader-settings-content">
                  {renderSettings({
                    settings: editable,
                    update: updateOptions,
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
              onSettingsChange={applySettings}
            />
          ))}
        <div className={`mejiro-reader-body${showChapterPanel ? ' has-chapter-panel' : ''}`}>
          {showChapterPanel && (
            <MejiroChapterNav
              epub={e}
              chapterIndex={chapter}
              onChapterIndexChange={onChapter}
              variant="panel"
            />
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
                onVisiblePageChange={(pageIndex, source) => {
                  if (source === 'programmatic') return;
                  const scrolledLayout = layoutCtx.layout;
                  if (scrolledLayout) {
                    setUserScroll((prev) =>
                      prev?.layout === scrolledLayout && prev.page === pageIndex
                        ? prev
                        : { layout: scrolledLayout, page: pageIndex },
                    );
                  }
                  const target = spreadCtx.indexOfPage(pageIndex);
                  if (target !== spreadCtx.index) spreadCtx.goTo(target, { animate: false });
                }}
                selectionRects={annotationRects.length ? annotationRects : undefined}
                spreadIndex={spreadCtx.spreadIndex}
                images={imageCtx.currentImages}
                pageNumbers={pageNumbers}
                onImagePointerDown={imageCtx.onOverlayPointerDown}
                onImageResizePointerDown={imageCtx.onResizePointerDown}
                onImageClose={imageCtx.removeOverlay}
              />
            )}
            {layoutReady && mode === 'scroll' && layoutCtx.layout && pageIndicator}
            {layoutReady && mode === 'paginated' && spreadCtx.spread && (
              <MejiroSpread
                key={`${chapter}-${spreadCtx.index}-${layoutCtx.pageWidth}x${layoutCtx.pageHeight}`}
                spreadMode={resolvedSpreadMode}
                singleSide={spreadCtx.singleSide}
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
                  pageNumber: pageNumberFor(pageNumbers, currentSpread * 2),
                }}
                leftHeader={{
                  title: runningTitleLeft,
                  pageNumber: showLeft ? pageNumberFor(pageNumbers, currentSpread * 2 + 1) : null,
                }}
                images={imageCtx.currentImages}
                indicator={pageIndicator}
                onPrev={spreadCtx.prev}
                onNext={spreadCtx.next}
                onImagePointerDown={imageCtx.onOverlayPointerDown}
                onImageResizePointerDown={imageCtx.onResizePointerDown}
                onImageClose={imageCtx.removeOverlay}
                spreadIndex={spreadCtx.spreadIndex}
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
          {spreadCtx.count > 0
            ? formatMessage(resolvedMessages.spreadAnnouncement, {
                spread: spreadCtx.index + 1,
                total: spreadCtx.count,
              })
            : ''}
        </div>
      </div>
    </MejiroI18nProvider>
  );
}

/**
 * Full-page EPUB reader. Composes the package's primitives into a working
 * reader: the header (drawn when a `title` or `logo` is given), chapter
 * navigation, settings, page indicator and keyboard navigation scoped to the
 * reader root. The `ref` exposes {@link MejiroReaderHandle} for imperative
 * navigation.
 *
 * ```tsx
 * const reader = useRef<MejiroReaderHandle>(null);
 * reader.current?.goToSpread(12);
 * ```
 */
const MejiroReader = forwardRef<MejiroReaderHandle, MejiroReaderProps>(MejiroReaderInner);
MejiroReader.displayName = 'MejiroReader';

export { MejiroReader };
