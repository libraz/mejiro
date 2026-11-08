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
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  shallowRef,
  type VNode,
  watch,
} from 'vue';
import { bookIdentity, resolveLayoutEpub } from './bookIdentity.js';
import { toError } from './errors.js';
import {
  formatMessage,
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
import { MejiroSpread, type ReaderAnnotation, type SelectionRect } from './MejiroSpread.js';
import { MejiroStats } from './MejiroStats.js';
import { mergeDefined } from './persistence.js';
import { useChapterLayout } from './useChapterLayout.js';
import { type FetchEpubOptions, useEpub } from './useEpub.js';
import { useImageOverlay } from './useImageOverlay.js';
import { useMejiroBook } from './useMejiroBook.js';
import { type ResolvedSpreadMode, useSpread } from './useSpread.js';

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

/** Owner key a position value takes over: whichever book and chapter are shown first. */
const FIRST_SHOWN = Symbol('first shown');

/**
 * Content key of a manuscript source: equal chapters give an equal key whatever
 * the array identity, and the key parses back into those chapters.
 */
function manuscriptKey(manuscript: readonly ManuscriptChapter[] | undefined): string | undefined {
  if (manuscript === undefined) return undefined;
  return JSON.stringify(manuscript.map(({ id, title, body }) => ({ id, title, body })));
}

/** Key over every option the book re-measures or re-breaks for; a change re-flows the chapter. */
function reflowOptionsKey(o: Readonly<BookOptions>): string {
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

/**
 * True when a keydown on the reader must not be read as page navigation: the
 * host already handled it, a modifier turns it into a different gesture, or it
 * was typed into an editable field inside the reader.
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
 * A position prop as a usable index: `undefined` when absent, otherwise a
 * non-negative integer. A non-finite value reads as 0 and a fraction is
 * truncated.
 */
function positionValue(value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Page a scroll-mode reader asks the view to show: the page a user scroll
 * settled on while it still belongs to the current position, else the first
 * page of that position. The React MejiroReader carries an identical copy.
 */
function scrollTargetPage(
  spread: { index: number; firstPage: number; indexOfPage: (pageIndex: number) => number },
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

/** A settled reader state as {@link createLifecycleTracker} reads it. */
interface LifecycleView {
  /** Navigation index on screen. */
  index: number;
  /** Number of navigation positions. */
  count: number;
  /** Layout spread on screen. */
  spreadIndex: number;
  /** Start of the first visible page. */
  anchor: InChapterAnchor | null;
}

/**
 * Decides spreadIndexChange / chapterFinished / page-read from successive reader
 * states; the React MejiroReader carries an identical copy.
 *
 * A state is skipped while `view` is null (it must be null unless the layout
 * was built for `chapterIndex` of `book`) or while `settled` is false (a
 * position the host controls is still being applied). The first settled
 * position of each `book` is the baseline and emits nothing; afterwards each
 * change of navigation position emits one page-read, a change of layout spread
 *  one spreadIndexChange, and reaching the last position one chapterFinished. A
 * re-layout that keeps the position emits nothing.
 */
function createLifecycleTracker(
  sink: LifecycleSink,
): (book: unknown, chapterIndex: number, view: LifecycleView | null, settled: boolean) => void {
  let lastBook: unknown = null;
  let last: { chapterIndex: number; index: number; spreadIndex: number } | null = null;
  let dwell: { anchor: ReadingAnchor; ts: number } | null = null;
  return (book, chapterIndex, view, settled) => {
    if (!(view && settled)) return;
    if (book !== lastBook) {
      lastBook = book;
      last = null;
      dwell = null;
    }
    if (last && last.chapterIndex === chapterIndex && last.index === view.index) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const previous = last;
    if (previous && dwell) sink.pageRead(dwell.anchor, now - dwell.ts);
    dwell = view.anchor ? { anchor: { chapterIndex, ...view.anchor }, ts: now } : null;
    last = { chapterIndex, index: view.index, spreadIndex: view.spreadIndex };
    if (!previous) return;
    if (previous.chapterIndex !== chapterIndex || previous.spreadIndex !== view.spreadIndex) {
      sink.spreadIndexChange(chapterIndex, view.spreadIndex);
    }
    if (view.index === view.count - 1) sink.chapterFinished(chapterIndex);
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
 * Sole owner of the pending `goToAnchor` request; the React MejiroReader carries
 * an identical copy. Every request settles exactly once: applied, unresolvable
 * (its chapter or position does not exist in the shown book), superseded by a
 * newer request, or disposed. A request made before a book is shown waits for one;
 * one that moves the spread settles on the next update, once the spread is shown.
 */
function createAnchorResolver(nav: {
  goToChapter: (chapterIndex: number) => void;
  /** Shows the position holding `pageIndex`; returns whether that changes the shown position. */
  goToPage: (pageIndex: number) => boolean;
}): {
  request: (anchor: ReadingAnchor, target: AnchorTarget) => Promise<void>;
  update: (target: AnchorTarget) => void;
  dispose: () => void;
} {
  let pending: {
    anchor: ReadingAnchor;
    resolve: () => void;
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
      // Asked once: a host controlling the chapter may decline.
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
    if (loc && nav.goToPage(loc.pageIndex)) {
      current.moved = true;
      return;
    }
    settle();
  };
  return {
    request: (anchor, target) =>
      new Promise<void>((resolve) => {
        settle();
        pending = { anchor, resolve, chapterRequested: false, moved: false };
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

/** Spread-level position returned by {@link MejiroReaderHandle.getSpreadPosition}. */
export interface SpreadPosition {
  /** Zero-based index of the current chapter. */
  chapterIndex: number;
  /** Zero-based index of the layout spread on screen, whatever the spread mode. */
  spreadIndex: number;
  /** Number of spreads in the current chapter's layout. */
  spreadCount: number;
  /** Number of pages in the current chapter's layout. */
  pageCount: number;
}

/** Payload of the `spreadIndexChange` reader event. */
export interface MejiroReaderSpreadIndexChangeEvent {
  /** Zero-based index of the chapter shown. */
  chapterIndex: number;
  /** Zero-based index of the layout spread now on screen. */
  spreadIndex: number;
}

/** Payload of the `turnStart` reader event. */
export interface MejiroReaderTurnStartEvent {
  /** Navigation position the turn leaves: a page in single-page mode, a spread otherwise. */
  from: number;
}

/** Payload of the `turnEnd` reader event. */
export interface MejiroReaderTurnEndEvent {
  /** Navigation position the turn landed on: a page in single-page mode, a spread otherwise. */
  to: number;
}

/** Payload of the `chapterFinished` reader event. */
export interface MejiroReaderChapterFinishedEvent {
  /** Zero-based index of the chapter whose last position was reached. */
  chapterIndex: number;
}

/**
 * Event payloads emitted by {@link MejiroReaderHandle.subscribe}.
 *
 * Each property maps an event name to its listener signature. An event that
 * has an emit twin is named after it in camelCase.
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
  /** Merges a settings change into the book options and re-flows the chapter. */
  update: (patch: BookOptionsPatch) => void;
  /** Whether the settings panel is currently open. */
  open: boolean;
  /** Toggles the settings panel open/closed. */
  toggle: () => void;
}

/** Imperative handle exposed via `ref` on {@link MejiroReader}. */
export interface MejiroReaderHandle {
  /**
   * Turn to a layout spread, clamped to `[0, spreadCount − 1]`. In single-page
   * mode the spread's right page (first in reading order) is shown.
   *
   * @throws RangeError If `spreadIndex` is not a finite integer.
   */
  goToSpread(spreadIndex: number): void;
  /** Advance one position (a page in single-page mode, a spread otherwise). */
  next(): void;
  /** Go back one position. */
  prev(): void;
  /** Jump to a chapter (clamped to the book's chapters), at its first spread. */
  goToChapter(chapterIndex: number): void;
  /** Read the current spread-level position. */
  getSpreadPosition(): SpreadPosition;
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
   * position, or `null` if the layout is not ready. When an image blocks every
   * page shown, the anchor is where the text resumes after it; `null` again if
   * none follows.
   */
  getAnchor(): ReadingAnchor | null;
  /**
   * Returns the half-open range of {@link ReadingAnchor}s visible at the
   * current position. `end` points at the start of the text on the next
   * position that has any (or the end of the chapter when none does).
   */
  getVisibleRange(): ReadingAnchorRange | null;
  /**
   * Merges `patch` into the book options at runtime, like
   * {@link MejiroBook.updateOptions} — font / size changes re-measure and
   * re-layout asynchronously.
   *
   * Successive calls are coalesced into a single application; the returned
   * promise resolves once that application has settled. A failed application
   * (such as a font that measures as a fallback under `strictFontCheck`) is
   * emitted as `error` rather than rejecting the promise.
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

/** A half-open range between two {@link ReadingAnchor}s. */
export interface ReadingAnchorRange {
  /** First visible position. */
  start: ReadingAnchor;
  /** Position just past the last visible one. */
  end: ReadingAnchor;
}

/**
 * Props {@link MejiroReader} takes whatever the book source is.
 *
 * A position pair (`chapterIndex`, `spreadIndex`, `anchor`) is controlled only
 * while its `update:` event is listened to (`v-model:chapter-index`,
 * `v-model:spread-index`, `v-model:anchor`): the reader then shows the prop
 * value and reports navigation through the event instead of moving on its
 * own. Without a listener the value is where the reader starts, and a later
 * change moves it there.
 */
export interface MejiroReaderCommonProps {
  /**
   * Book options. Any omitted field falls back to {@link DEFAULT_BOOK_OPTIONS},
   * shallowly (a supplied `headingStyles` replaces the default map).
   * Construction-time keys such as `strictFontCheck` are read once, at mount;
   * remount with `:key` to change them.
   */
  options?: Partial<BookOptions>;
  /** Page-geometry overrides forwarded to `MejiroBook.fitPageSize`. */
  pageGeometry?: FitPageSizeOptions;
  /** Font choices displayed in the settings panel. */
  fonts?: readonly FontChoice[];
  /**
   * Chapter shown (zero-based). Clamped to the book's chapters. A value counts
   * for the book it was set on: a book swap starts the new book at chapter 0
   * and reports it through `update:chapterIndex`.
   */
  chapterIndex?: number;
  /**
   * Layout spread shown (zero-based), whatever the spread mode. With one page
   * shown at a time, a spread index alone shows that spread's right page, and
   * turning to its left page keeps the spread index, so `update:spreadIndex`
   * does not fire; follow `anchor` for page granularity. A value counts for
   * the chapter it was set on.
   */
  spreadIndex?: number;
  /**
   * Reading position shown. When set it decides the position, and
   * `chapterIndex` / `spreadIndex` are not read; their events still fire.
   * Reported at page granularity: `update:anchor` carries the start of the
   * first page now on screen.
   */
  anchor?: ReadingAnchor | null;
  /** Visual theme preset, or `{ name, override }`. @defaultValue 'light' */
  theme?: MejiroTheme;
  /** Reading-flow mode. @defaultValue 'paginated' */
  mode?: MejiroReaderMode;
  /** Two pages, one page, or one page on a portrait surface. @defaultValue 'double' */
  spreadMode?: MejiroSpreadMode;
  /** How the reader sizes itself in its container. @defaultValue 'fill' */
  fit?: MejiroReaderFit;
  /** Toggle the chrome by tapping the spread center. @defaultValue true */
  enableSurfaceTap?: boolean;
  /** Built-in locale for UI strings; defaults to the nearest provider's, else `'en'`. */
  locale?: MejiroLocale;
  /** Extra options merged into the EPUB `fetch` call in URL mode. */
  fetchOptions?: RequestInit;
  /** Resource limits applied while parsing an EPUB the reader loads itself. */
  limits?: Partial<EpubParseLimits>;
  /** Custom EPUB loader used in place of the global `fetch`; overrides `fetchOptions`. */
  fetchEpub?: (url: string, options: FetchEpubOptions) => Promise<BinaryInput>;
  /** Partial override of the message catalog, merged over the one `locale` selects. */
  messages?: Partial<MejiroMessages>;
  /** Header title. The header is drawn only when this or a `header` / `logo` slot is given. */
  title?: string;
  /** Header subtitle. @defaultValue `messages.logoSubtitle` */
  subtitle?: string;
  /** Offer the open-file button and drop zone while no book is shown. @defaultValue false */
  enableDropZone?: boolean;
  /** Where the chapter navigation goes; `'none'` removes it. @defaultValue 'select' */
  chapterNavMode?: MejiroChapterNavMode;
  /** Show the settings panel and its header toggle. @defaultValue true */
  showSettings?: boolean;
  /** Show the header button that adds an image overlay. @defaultValue false */
  showImageOverlayButton?: boolean;
  /** Show the layout statistics in the header. @defaultValue false */
  showStats?: boolean;
  /** Turn pages with ArrowLeft / ArrowRight while the reader has focus. @defaultValue true */
  enableKeyboard?: boolean;
  /** Show the "n / count" indicator below the book. @defaultValue true */
  showPageIndicator?: boolean;
  /** Which page of a spread prints its page number. @defaultValue 'both' */
  pageNumbers?: PageNumberDisplay;
  /** Highlights drawn over the text; those of other chapters are skipped. */
  annotations?: readonly ReaderAnnotation[];
}

/** {@link MejiroReader} showing a book the host has already parsed. */
export interface MejiroReaderParsedProps extends MejiroReaderCommonProps {
  /** The parsed book, or `null` while the host has none. Wins over `epubUrl`. */
  epub: EpubBook | null;
  /** Not combined with `epub`; when both are given, `epub` wins. */
  epubUrl?: never;
  /** Not combined with `epub`. */
  manuscript?: never;
  /** Only read with `manuscript`. */
  dialect?: never;
}

/** {@link MejiroReader} fetching and parsing a book from a URL. */
export interface MejiroReaderUrlProps extends MejiroReaderCommonProps {
  /** URL fetched and parsed once mounted, and again whenever it changes. */
  epubUrl: string;
  /** Not combined with `epubUrl`. */
  epub?: never;
  /** Not combined with `epubUrl`. */
  manuscript?: never;
  /** Only read with `manuscript`. */
  dialect?: never;
}

/** {@link MejiroReader} waiting for the user to pick a book (`enableDropZone`). */
export interface MejiroReaderPickerProps extends MejiroReaderCommonProps {
  /** No book source: the user opens one. */
  epub?: never;
  /** No book source: the user opens one. */
  epubUrl?: never;
  /** No book source: the user opens one. */
  manuscript?: never;
  /** Only read with `manuscript`. */
  dialect?: never;
}

/** {@link MejiroReader} rendering manuscript chapters without an EPUB round-trip. */
export interface MejiroReaderManuscriptProps extends MejiroReaderCommonProps {
  /** Chapters whose bodies are parsed as manuscript notation. */
  manuscript: readonly ManuscriptChapter[];
  /** Manuscript notation dialect. @defaultValue 'mejiro' */
  dialect?: ManuscriptDialect;
  /** Not combined with `manuscript`. */
  epub?: never;
  /** Not combined with `manuscript`. */
  epubUrl?: never;
}

/**
 * Full-page EPUB reader component. Composes the rest of the
 * `@libraz/mejiro-vue` building blocks into a working reader.
 *
 * The shortest call shows the book with a page indicator and a settings panel;
 * the header appears once a `title` or a `header` / `logo` slot is given, and
 * arrow keys turn pages while the reader has focus. Bind the position with
 * `v-model:chapter-index`, `v-model:spread-index` or `v-model:anchor`; see
 * {@link MejiroReaderCommonProps} for when each is controlled.
 *
 * Until the client layout is ready the `fallback` slot is shown — for
 * example the static HTML `renderEpubStatic` produced on the server:
 *
 * ```vue
 * <MejiroReader :epub="epub">
 *   <template #fallback><div v-html="staticHtml" /></template>
 * </MejiroReader>
 * ```
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
 *   <MejiroReader ref="reader" epub-url="/book.epub" />
 * </template>
 * ```
 */
export const MejiroReader = defineComponent({
  name: 'MejiroReader',
  props: {
    /** Book options; omitted fields fall back to `DEFAULT_BOOK_OPTIONS`. */
    options: {
      type: Object as PropType<Partial<BookOptions>>,
      default: () => ({}),
    },
    /** Page-geometry overrides forwarded to `MejiroBook.fitPageSize`. */
    pageGeometry: {
      type: Object as PropType<FitPageSizeOptions>,
      default: undefined,
    },
    /** Font choices displayed in the settings panel. */
    fonts: { type: Array as PropType<readonly FontChoice[]>, default: undefined },
    /** Pre-parsed EPUB to display. Wins over `manuscript` and `epubUrl`. */
    epub: { type: Object as PropType<EpubBook | null>, default: undefined },
    /** URL fetched and parsed once mounted, and again whenever it changes. */
    epubUrl: { type: String, default: undefined },
    /** Manuscript chapters rendered without an EPUB round-trip. */
    manuscript: {
      type: Array as PropType<readonly ManuscriptChapter[]>,
      default: undefined,
    },
    /** Manuscript notation dialect, read with `manuscript`. @defaultValue 'mejiro' */
    dialect: { type: String as PropType<ManuscriptDialect>, default: undefined },
    /** Chapter shown; controlled while `update:chapterIndex` is listened to. */
    chapterIndex: { type: Number, default: undefined },
    /** Layout spread shown; controlled while `update:spreadIndex` is listened to. */
    spreadIndex: { type: Number, default: undefined },
    /** Reading position shown; controlled while `update:anchor` is listened to. */
    anchor: { type: Object as PropType<ReadingAnchor | null>, default: undefined },
    /** Visual theme preset, or `{ name, override }`. @defaultValue 'light' */
    theme: {
      type: [String, Object] as PropType<MejiroTheme>,
      default: 'light',
    },
    /** Reading-flow mode. @defaultValue 'paginated' */
    mode: {
      type: String as PropType<MejiroReaderMode>,
      default: 'paginated',
    },
    /** Two pages, one page, or one page on a portrait surface. @defaultValue 'double' */
    spreadMode: {
      type: String as PropType<MejiroSpreadMode>,
      default: 'double',
    },
    /** How the reader sizes itself in its container. @defaultValue 'fill' */
    fit: {
      type: String as PropType<MejiroReaderFit>,
      default: 'fill',
    },
    /** Toggle the chrome by tapping the spread center. @defaultValue true */
    enableSurfaceTap: { type: Boolean, default: true },
    /** Built-in locale for UI strings; defaults to the nearest provider's, else `'en'`. */
    locale: { type: String as PropType<MejiroLocale>, default: undefined },
    /** Extra options merged into the EPUB `fetch` call in URL mode. */
    fetchOptions: { type: Object as PropType<RequestInit>, default: undefined },
    /** Resource limits applied while parsing an EPUB the reader loads itself. */
    limits: { type: Object as PropType<Partial<EpubParseLimits>>, default: undefined },
    /** Custom EPUB loader used in place of the global `fetch`; overrides `fetchOptions`. */
    fetchEpub: {
      type: Function as PropType<(url: string, options: FetchEpubOptions) => Promise<BinaryInput>>,
      default: undefined,
    },
    /** Partial override of the message catalog, merged over the one `locale` selects. */
    messages: { type: Object as PropType<Partial<MejiroMessages>>, default: undefined },
    /** Header title; the header is drawn only when this or a `header` / `logo` slot is given. */
    title: { type: String, default: undefined },
    /** Header subtitle. @defaultValue `messages.logoSubtitle` */
    subtitle: { type: String, default: undefined },
    /** Offer the open-file button and drop zone while no book is shown. @defaultValue false */
    enableDropZone: { type: Boolean, default: false },
    /** Where the chapter navigation goes; `'none'` removes it. @defaultValue 'select' */
    chapterNavMode: {
      type: String as PropType<MejiroChapterNavMode>,
      default: 'select',
    },
    /** Show the settings panel and its header toggle. @defaultValue true */
    showSettings: { type: Boolean, default: true },
    /** Show the header button that adds an image overlay. @defaultValue false */
    showImageOverlayButton: { type: Boolean, default: false },
    /** Show the layout statistics in the header. @defaultValue false */
    showStats: { type: Boolean, default: false },
    /** Turn pages with ArrowLeft / ArrowRight while the reader has focus. @defaultValue true */
    enableKeyboard: { type: Boolean, default: true },
    /** Show the "n / count" indicator below the book. @defaultValue true */
    showPageIndicator: { type: Boolean, default: true },
    /** Which page of a spread prints its page number. @defaultValue 'both' */
    pageNumbers: { type: String as PropType<PageNumberDisplay>, default: 'both' },
    /** Highlights drawn over the text; those of other chapters are skipped. */
    annotations: {
      type: Array as PropType<readonly ReaderAnnotation[]>,
      default: undefined,
    },
  },
  emits: {
    /** A book was shown: loaded, supplied through `epub`, or synthesized from `manuscript`. */
    load: (_epub: EpubBook) => true,
    /** Loading, laying out or applying options failed. */
    error: (_error: Error) => true,
    /** The chapter changed, or would have under a controlled `chapterIndex`. */
    'update:chapterIndex': (_chapterIndex: number) => true,
    /** The layout spread changed, or would have under a controlled `spreadIndex`. */
    'update:spreadIndex': (_spreadIndex: number) => true,
    /** The first page on screen changed, or would have under a controlled `anchor`. */
    'update:anchor': (_anchor: ReadingAnchor) => true,
    /** The reader left a position after showing it for `dwellMs` milliseconds. */
    'page-read': (_anchor: ReadingAnchor, _dwellMs: number) => true,
    /** The reader reached the last position of a chapter. */
    'chapter-finished': (_chapterIndex: number) => true,
  },
  setup(props, { emit, slots, expose }) {
    const instance = getCurrentInstance();
    const rootEl = ref<HTMLElement | null>(null);
    const surfaceEl = ref<HTMLElement | null>(null);
    const settingsOpen = ref(false);
    const chromeHidden = ref(false);
    const autoSingle = ref(false);
    // Page a user scroll settled on, scoped to the layout it was reported against.
    const userScroll = shallowRef<{ layout: ChapterLayout; page: number } | null>(null);

    /**
     * A position pair is controlled while the parent listens to its `update:`
     * event. Declared emits are stripped from `attrs`, so the raw vnode props
     * are the only place the listener is observable.
     */
    function listens(event: string): boolean {
      const vnodeProps = instance?.vnode.props as Record<string, unknown> | null | undefined;
      if (!vnodeProps) return false;
      const kebab = event.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return vnodeProps[`onUpdate:${event}`] != null || vnodeProps[`onUpdate:${kebab}`] != null;
    }
    const chapterControlled = (): boolean => listens('chapterIndex');
    const spreadControlled = (): boolean => listens('spreadIndex');
    const anchorControlled = (): boolean => listens('anchor');

    const chapterProp = computed(() => positionValue(props.chapterIndex));
    const spreadProp = computed(() => positionValue(props.spreadIndex));
    const anchorProp = computed<ReadingAnchor | null>(() => props.anchor ?? null);

    function toggleSettings(): void {
      settingsOpen.value = !settingsOpen.value;
    }

    let resizeObserver: ResizeObserver | null = null;
    function updateAutoSingle(): void {
      const surface = surfaceEl.value;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      // A `fit="width"` surface derives its height from the current mode, so
      // its width is judged against the viewport height the host supplies.
      autoSingle.value = rect.width < (props.fit === 'width' ? window.innerHeight : rect.height);
    }

    function stopAutoSingleObserver(): void {
      resizeObserver?.disconnect();
      resizeObserver = null;
      window.removeEventListener('resize', updateAutoSingle);
    }
    function startAutoSingleObserver(): void {
      stopAutoSingleObserver();
      if (props.spreadMode !== 'auto') return;
      updateAutoSingle();
      window.addEventListener('resize', updateAutoSingle);
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
    watch(
      () => props.fit,
      () => {
        if (props.spreadMode === 'auto') updateAutoSingle();
      },
    );
    const resolvedSpreadMode = computed<ResolvedSpreadMode>(() =>
      props.spreadMode === 'single' || (props.spreadMode === 'auto' && autoSingle.value)
        ? 'single'
        : 'double',
    );
    const effectiveSingle = computed(() => resolvedSpreadMode.value === 'single');

    // Page geometry forwarded to `fitPageSize`. In `fit="width"` mode the
    // surface self-sizes its height from its width via `aspect-ratio`, and the
    // book must exactly fill it, so the fill-mode safety rails (reserved
    // offsets, the height cap and the size floors) default off there. The host
    // can still override any field via `pageGeometry`.
    const resolvedGeometry = computed<FitPageSizeOptions | undefined>(() => {
      // A single-page reader derives its page width from the full container
      // width instead of halving it for a two-page spread.
      const columns: 1 | 2 = effectiveSingle.value ? 1 : 2;
      const geometry = props.pageGeometry ?? {};
      if (props.fit !== 'width') return mergeDefined<FitPageSizeOptions>({ columns }, geometry);
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
    });

    // The spread aspect (width / height) used to self-size the surface in
    // `fit="width"` mode, as a CSS `aspect-ratio` value so the browser derives
    // the surface height from its width with no JS measurement feedback loop.
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

    const pageIndicator = (): VNode =>
      h(MejiroPageIndicator, {
        index: spreadCtx.index.value,
        count: spreadCtx.count.value,
      });

    // Fill any omitted option from the defaults so a host can pass just the
    // fields it cares about. Shallow by design — a supplied nested map (e.g.
    // `headingStyles`) replaces, not merges.
    const resolvedOptions = computed<BookOptions>(() =>
      mergeDefined<BookOptions>(DEFAULT_BOOK_OPTIONS, props.options ?? {}),
    );
    // The book follows the `options` prop only when its *value* changes: a
    // parent re-render that hands over a new but equal object must not roll
    // back runtime changes made through `updateOptions` or the settings panel.
    const bookOptionsSource = shallowRef<BookOptions>(resolvedOptions.value);
    watch(
      () => JSON.stringify(resolvedOptions.value),
      () => {
        bookOptionsSource.value = resolvedOptions.value;
      },
    );
    // Option changes are coalesced before they reach the book: the settings
    // panel emits one per keystroke / slider step, and every metric change
    // costs a font load plus a full re-measurement. Failures are emitted as
    // `error` instead of an unhandled rejection.
    const {
      book,
      options,
      updateOptions: applyBookOptions,
    } = useMejiroBook(bookOptionsSource, {
      debounceMs: OPTIONS_DEBOUNCE_MS,
      onError: (err) => emit('error', err),
    });
    // Settles with the latest application (never rejects: failures are emitted).
    let lastApply: Promise<void> = Promise.resolve();
    function updateOptions(patch: BookOptionsPatch): Promise<void> {
      lastApply = applyBookOptions(patch);
      return lastApply;
    }

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
      url: () =>
        props.epub !== undefined || props.manuscript !== undefined ? undefined : props.epubUrl,
      get fetchOptions() {
        return props.fetchOptions;
      },
      get limits() {
        return props.limits;
      },
      get fetchEpub() {
        return props.fetchEpub;
      },
      onLoad: (loaded) => {
        imageCtx.clearOverlays();
        emit('load', loaded);
      },
    });
    watch(
      epub.error,
      (next) => {
        if (next) emit('error', next);
      },
      { flush: 'sync' },
    );

    // Book identity: changes on a swap, not on a manuscript content edit.
    const bookKey = computed<unknown>(() =>
      props.manuscript !== undefined ? MANUSCRIPT_SOURCE : bookIdentity(epub.epub.value),
    );

    // ── Chapter ──
    // The chapter the reader keeps itself; the starting value prefers the anchor.
    const chapterState = ref(positionValue(props.anchor?.chapterIndex) ?? chapterProp.value ?? 0);
    // A chapter value only counts for the book it was set on, so a swap reads
    // as chapter 0 in the same step the new book is published: one layout, for it.
    const chapterBook = shallowRef<unknown>(FIRST_SHOWN);
    watch(
      bookKey,
      (key) => {
        if (chapterBook.value === FIRST_SHOWN && key != null) chapterBook.value = key;
      },
      { immediate: true, flush: 'sync' },
    );
    const activeChapter = computed(() => {
      const anchor = anchorProp.value;
      if (anchor && anchorControlled()) {
        return clampChapter(positionValue(anchor.chapterIndex) ?? 0, epub.epub.value);
      }
      const value = !anchor && chapterControlled() ? (chapterProp.value ?? 0) : chapterState.value;
      const owns = chapterBook.value === FIRST_SHOWN || chapterBook.value === bookKey.value;
      return clampChapter(owns ? value : 0, epub.epub.value);
    });
    // A new chapter value moves the reader there and binds it to the book shown.
    watch(
      chapterProp,
      (next) => {
        if (next === undefined || anchorProp.value) return;
        chapterState.value = next;
        if (bookKey.value != null) chapterBook.value = bookKey.value;
      },
      { flush: 'sync' },
    );
    // The reset on a book swap is a chapter change the host has not been told about yet.
    watch([bookKey, activeChapter], ([nextBook, next], [prevBook, prev]) => {
      if (nextBook !== prevBook && next !== prev) emit('update:chapterIndex', next);
    });
    // A controlled source owns the book, so the reader offers no file of its own.
    const filePicker = computed(
      () => props.enableDropZone && props.epub === undefined && props.manuscript === undefined,
    );

    // Bridge between the layout and spread composables: a reflow re-layout
    // produces a new layout object (which resets the navigation index to 0), so
    // capture the reading anchor beforehand and restore it afterwards — unless
    // the host controls the position, which the landing step re-applies.
    const positionBridge = {
      capture(layout: ChapterLayout): InChapterAnchor | null {
        if (hostTarget() !== null) return null;
        if (visibleAnchor?.layout === layout) return visibleAnchor.anchor;
        // Same anchor resolution as `getAnchor`: skips image-blocked pages and
        // handles single mode.
        return spreadCtx.anchorAt(spreadCtx.index.value);
      },
      restore(layout: ChapterLayout, anchor: InChapterAnchor): void {
        const loc = layout.locateAnchor(anchor);
        spreadCtx.goTo(loc ? spreadCtx.indexOfPage(loc.pageIndex) : 0, { animate: false });
        // A capture that runs before the restored index settles must see this anchor.
        visibleAnchor = { layout, anchor };
      },
    };

    // An edit outside the shown chapter keeps the layout source as it was.
    let layoutMemo: ReturnType<typeof resolveLayoutEpub> | null = null;
    const layoutEpub = computed(() => {
      layoutMemo = resolveLayoutEpub(
        layoutMemo,
        epub.epub.value,
        bookKey.value,
        activeChapter.value,
      );
      return layoutMemo.epub;
    });
    const layoutCtx = useChapterLayout(book, {
      epub: layoutEpub,
      chapterIndex: activeChapter,
      surface: surfaceEl,
      pageGeometry: () => resolvedGeometry.value,
      capturePosition: (layout) => positionBridge.capture(layout),
      restorePosition: (layout, anchor) => positionBridge.restore(layout, anchor),
      onError: (err) => emit('error', err),
    });

    // Re-flow when the resolved page geometry changes at runtime (covers both
    // host `pageGeometry` edits and `fit`-driven offset changes). Keyed on the
    // value: an inline geometry literal is a new object on every parent render.
    watch(
      () => JSON.stringify(resolvedGeometry.value ?? null),
      () => void layoutCtx.recompute({ blank: false }),
    );

    // Re-flow when metric-affecting options change at runtime: an option change
    // does not otherwise re-run layout. Debounced so dragging a continuous
    // control coalesces into a single re-flow; the pending option change is
    // awaited first so the re-layout sees the metrics it will be measured with.
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

    // Layout spread and anchor last reported to the host; nothing is reported
    // for the position the reader settles on when it mounts.
    let reportedSpread: number | null = null;
    let reportedAnchor: ReadingAnchor | null = anchorProp.value;

    /** Whether `anchor` lies on the navigation position on screen. */
    function anchorOnScreen(anchor: ReadingAnchor | null): boolean {
      const layout = chapterLayout.value;
      if (!(anchor && layout) || anchor.chapterIndex !== activeChapter.value) return false;
      const loc = layout.locateAnchor(anchor);
      return loc != null && spreadCtx.indexOfPage(loc.pageIndex) === spreadCtx.index.value;
    }

    /** Reports the anchor of `chapterIndex` at `anchor` unless it is the one last reported. */
    function reportAnchor(anchor: ReadingAnchor): void {
      const last = reportedAnchor;
      if (
        last &&
        last.chapterIndex === anchor.chapterIndex &&
        last.paragraphIndex === anchor.paragraphIndex &&
        last.charIndex === anchor.charIndex
      ) {
        return;
      }
      reportedAnchor = anchor;
      emit('update:anchor', anchor);
    }

    /** Reports a committed navigation move: the layout spread and the first page now shown. */
    function reportNavigation(): void {
      if (reportedSpread === null) return;
      // A chapter or book change blanks the layout, which is the new start at spread 0.
      const spreadIndex = spreadCtx.spreadIndex.value;
      if (spreadIndex !== reportedSpread) {
        reportedSpread = spreadIndex;
        emit('update:spreadIndex', spreadIndex);
      }
      if (!chapterLayout.value || anchorOnScreen(reportedAnchor)) return;
      const here = spreadCtx.anchorAt(spreadCtx.index.value);
      if (here) reportAnchor({ chapterIndex: activeChapter.value, ...here });
    }

    const spreadCtx = useSpread(layoutCtx.layout, {
      // The reader binds the arrow keys on its own root element.
      enableKeyboard: false,
      spreadMode: resolvedSpreadMode,
      onIndexChange: () => reportNavigation(),
    });

    /** Layout spread a spread value names, clamped to the layout's spreads. */
    function clampSpread(spreadIndex: number): number {
      return Math.max(0, Math.min(spreadCtx.spreadCount.value - 1, spreadIndex));
    }

    /** Navigation index showing the first page of layout spread `spreadIndex`. */
    function indexOfSpread(spreadIndex: number): number {
      return spreadCtx.indexOfPage(clampSpread(spreadIndex) * 2);
    }

    // Owner of the spread value: the book and chapter it was set for. A value
    // set for another chapter is not re-applied after a chapter or book change.
    let spreadOwner: { book: unknown; chapterIndex: number } | typeof FIRST_SHOWN = FIRST_SHOWN;
    const ownsSpread = (): boolean =>
      spreadOwner !== FIRST_SHOWN &&
      spreadOwner.book === bookKey.value &&
      spreadOwner.chapterIndex === activeChapter.value;

    /**
     * Where the host keeps the reader: a navigation index that must stay on
     * screen, a layout spread, or `null` when no controlled position applies
     * (the reader then moves on its own).
     */
    function hostTarget(): { index: number } | { spreadIndex: number } | null {
      const anchor = anchorProp.value;
      if (anchor) {
        if (!anchorControlled()) return null;
        const layout = chapterLayout.value;
        if (!layout) return null;
        const loc = layout.locateAnchor(anchor);
        return loc ? { index: spreadCtx.indexOfPage(loc.pageIndex) } : null;
      }
      const value = spreadProp.value;
      if (!(spreadControlled() && ownsSpread())) return null;
      return { spreadIndex: value ?? 0 };
    }

    /** Whether the reader is where the host keeps it. */
    function atHostTarget(): boolean {
      const target = hostTarget();
      if (!target || spreadCtx.count.value === 0) return true;
      if ('index' in target) return spreadCtx.index.value === target.index;
      return spreadCtx.spreadIndex.value === clampSpread(target.spreadIndex);
    }

    /** Moves the reader to where the host keeps it, without a turn animation. */
    function enforceHostTarget(): void {
      if (atHostTarget()) return;
      const target = hostTarget();
      if (!target) return;
      reportedAnchor = anchorProp.value;
      spreadCtx.goTo('index' in target ? target.index : indexOfSpread(target.spreadIndex), {
        animate: false,
      });
    }

    // Anchor at the start of the position on screen, taken when it settled: an
    // option change re-paginates the live layout in place before the reflow
    // captures from it, so reading the layout at capture time drifts. A
    // single/double flip keeps the anchor of the page that was on screen.
    let visibleAnchor: { layout: ChapterLayout; anchor: InChapterAnchor | null } | null = null;
    watch(
      [() => layoutCtx.layout.value, () => spreadCtx.index.value, effectiveSingle],
      ([layout, index, single], previous) => {
        const flipped = previous != null && previous[2] !== single;
        if (flipped && layout && visibleAnchor?.layout === layout) return;
        visibleAnchor = layout ? { layout, anchor: spreadCtx.anchorAt(index) } : null;
      },
      { immediate: true },
    );

    const imageCtx = useImageOverlay(layoutCtx.layout, {
      spreadIndex: spreadCtx.spreadIndex,
      defaultX: IMAGE_DEFAULT_X,
      onReflow: () => spreadCtx.refresh(),
    });

    const annotationRects = computed<SelectionRect[]>(() => {
      const layout = layoutCtx.layout.value;
      // The layout reflows in place when images change, so the image state keys this too.
      void imageCtx.currentImages.value;
      const list = props.annotations;
      if (!(list && layout)) return [];
      const result: SelectionRect[] = [];
      for (const annotation of list) {
        if (annotation.chapterIndex !== activeChapter.value) continue;
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
    // `dialect` changes and feed it into the useEpub state. The chapter is
    // *not* reset on content edits.
    watch(
      () => synthesizedEpub.value,
      (next) => {
        if (props.manuscript === undefined || props.epub !== undefined) return;
        epub.setEpub(next ?? null);
      },
      { immediate: true },
    );

    // Switching away from manuscript source clears the synthesized book so the
    // EPUB / URL path can take over without lingering manuscript data.
    watch(
      () => props.manuscript,
      (next, prev) => {
        if (next === undefined && prev !== undefined && props.epub === undefined) {
          epub.setEpub(null);
        }
      },
    );

    // Keep the internal EPUB ref in sync with the `epub` prop. Switching books
    // invalidates the overlay state and the font-width cache — both grow
    // per-book, and the cache is keyed by font so old entries are not reusable
    // once the book changes.
    watch(
      () => props.epub,
      (next, prev) => {
        if (next === undefined) {
          if (prev !== undefined) epub.setEpub(null);
          return;
        }
        epub.setEpub(next ?? null);
      },
      { immediate: true },
    );
    watch(
      () => (props.epub ? bookIdentity(props.epub) : props.epub),
      (next, prev) => {
        if (next === prev) return;
        imageCtx.clearOverlays();
        book.clearCache();
        if (props.epub) emit('load', props.epub);
      },
      { immediate: true },
    );

    // Entering manuscript source is a book swap, as for a new `epub`; content
    // edits within it are not.
    watch(
      () => props.manuscript !== undefined && props.epub === undefined,
      (isManuscript) => {
        if (!isManuscript) return;
        imageCtx.clearOverlays();
        book.clearCache();
        if (synthesizedEpub.value) emit('load', synthesizedEpub.value);
      },
      { immediate: true },
    );

    // Images belong to the chapter they were placed on; another chapter starts bare.
    watch(activeChapter, () => imageCtx.clearOverlays());

    // A new spread value moves the reader there, turning the page like a
    // navigation request, and binds it to the chapter shown.
    watch(spreadProp, (next) => {
      if (next === undefined || anchorProp.value) return;
      spreadOwner = { book: bookKey.value, chapterIndex: activeChapter.value };
      if (!chapterLayout.value || spreadCtx.spreadIndex.value === clampSpread(next)) return;
      spreadCtx.goTo(indexOfSpread(next));
    });

    // A new anchor moves the reader there: through the chapter it names, then
    // straight to its page.
    watch(
      () => {
        const a = anchorProp.value;
        return a ? `${a.chapterIndex}:${a.paragraphIndex}:${a.charIndex}` : null;
      },
      (key) => {
        const anchor = anchorProp.value;
        reportedAnchor = anchor;
        if (!(key && anchor)) return;
        if (anchorControlled()) enforceHostTarget();
        else void anchorResolver.request(anchor, anchorTarget());
      },
    );

    // A host that declines a navigation keeps its prop where it was, so a
    // position that no longer matches it is snapped back without a turn.
    watch(
      () => spreadCtx.index.value,
      () => enforceHostTarget(),
    );

    function setChapter(index: number): void {
      const next = clampChapter(index, epub.epub.value);
      if (next === activeChapter.value) return;
      const anchor = anchorProp.value;
      if (!(anchor ? anchorControlled() : chapterControlled())) {
        chapterState.value = next;
        chapterBook.value = bookKey.value;
      }
      emit('update:chapterIndex', next);
      if (anchor && anchorControlled()) {
        reportAnchor({ chapterIndex: next, paragraphIndex: 0, charIndex: 0 });
      }
    }

    // ── Event bus + anchor handling ──
    type EventName = keyof MejiroReaderEventMap;
    const listeners = new Map<EventName, Set<(payload: never) => void>>();
    function emitReaderEvent<E extends EventName>(
      event: E,
      payload: Parameters<MejiroReaderEventMap[E]>[0],
    ): void {
      const set = listeners.get(event);
      if (!set) return;
      for (const cb of set) (cb as (value: typeof payload) => void)(payload);
    }

    // The layout only counts for the active chapter of the shown book once it
    // was built for them: after a chapter switch or a book swap the previous
    // layout survives until the re-layout replaces it. Recorded synchronously,
    // as each layout lands.
    const layoutOwner = shallowRef<{ chapterIndex: number; book: unknown } | null>(null);
    let initialPending = true;
    watch(
      () => layoutCtx.layout.value,
      (next) => {
        const owner = next ? { chapterIndex: activeChapter.value, book: bookKey.value } : null;
        layoutOwner.value = owner;
        if (!(next && owner)) return;
        if (initialPending) {
          initialPending = false;
          applyInitialPosition(next);
          spreadOwner = owner;
          reportedSpread = spreadCtx.spreadIndex.value;
          const here = spreadCtx.anchorAt(spreadCtx.index.value);
          reportedAnchor =
            anchorProp.value ?? (here ? { chapterIndex: owner.chapterIndex, ...here } : null);
          return;
        }
        enforceHostTarget();
      },
      { flush: 'sync' },
    );
    const chapterLayout = computed(() => {
      const owner = layoutOwner.value;
      return owner && owner.chapterIndex === activeChapter.value && owner.book === bookKey.value
        ? layoutCtx.layout.value
        : null;
    });

    /** Shows the position the props name on the first layout: the anchor, else the spread. */
    function applyInitialPosition(layout: ChapterLayout): void {
      const anchor = anchorProp.value;
      if (anchor) {
        if (anchor.chapterIndex !== activeChapter.value) return;
        const loc = layout.locateAnchor(anchor);
        if (loc) spreadCtx.goTo(spreadCtx.indexOfPage(loc.pageIndex), { animate: false });
        return;
      }
      const value = spreadProp.value;
      if (value !== undefined) spreadCtx.goTo(indexOfSpread(value), { animate: false });
    }

    const anchorTarget = (): AnchorTarget => ({
      book: epub.loading.value ? null : epub.epub.value,
      chapterIndex: activeChapter.value,
      layout: chapterLayout.value,
    });
    const anchorResolver = createAnchorResolver({
      goToChapter: (i) => setChapter(i),
      goToPage: (pageIndex) => {
        const target = spreadCtx.indexOfPage(pageIndex);
        if (target === spreadCtx.index.value) return false;
        spreadCtx.goTo(target, { animate: false });
        return true;
      },
    });
    watch(
      [
        () => (epub.loading.value ? null : epub.epub.value),
        activeChapter,
        chapterLayout,
        spreadCtx.index,
      ],
      () => anchorResolver.update(anchorTarget()),
    );
    // Settle any in-flight anchor so awaiting callers never hang.
    onBeforeUnmount(() => anchorResolver.dispose());

    // spreadIndexChange / chapter-finished / page-read are all decided by the tracker.
    const trackLifecycle = createLifecycleTracker({
      spreadIndexChange: (chapterIndex, spreadIndex) =>
        emitReaderEvent('spreadIndexChange', { chapterIndex, spreadIndex }),
      chapterFinished: (chapterIndex) => {
        emitReaderEvent('chapterFinished', { chapterIndex });
        emit('chapter-finished', chapterIndex);
      },
      pageRead: (anchor, dwellMs) => emit('page-read', anchor, dwellMs),
    });
    watch(
      [() => spreadCtx.index.value, activeChapter, chapterLayout, bookKey, spreadProp, anchorProp],
      ([index, chapterIndex, layout, key]) =>
        trackLifecycle(
          key,
          chapterIndex,
          layout
            ? {
                index,
                count: spreadCtx.count.value,
                spreadIndex: spreadCtx.spreadIndex.value,
                anchor: spreadCtx.anchorAt(index),
              }
            : null,
          atHostTarget(),
        ),
      { immediate: true },
    );

    // Emit turnStart / turnEnd on the `turning` transition.
    watch(
      () => spreadCtx.turning.value,
      (next, prev) => {
        if (next && !prev) emitReaderEvent('turnStart', { from: spreadCtx.index.value });
        else if (!next && prev) emitReaderEvent('turnEnd', { to: spreadCtx.index.value });
      },
    );

    expose({
      goToSpread: (spreadIndex: number) => {
        if (!Number.isInteger(spreadIndex)) {
          throw new RangeError(
            `MejiroReader.goToSpread: spreadIndex must be a finite integer, got ${spreadIndex}`,
          );
        }
        spreadCtx.goTo(indexOfSpread(spreadIndex));
      },
      next: () => spreadCtx.next(),
      prev: () => spreadCtx.prev(),
      goToChapter: (chapterIndex: number) => setChapter(chapterIndex),
      getSpreadPosition: (): SpreadPosition => ({
        chapterIndex: activeChapter.value,
        spreadIndex: spreadCtx.spreadIndex.value,
        spreadCount: spreadCtx.spreadCount.value,
        pageCount: spreadCtx.pageCount.value,
      }),
      goToAnchor: (anchor: ReadingAnchor) => anchorResolver.request(anchor, anchorTarget()),
      getAnchor: () => {
        const layout = chapterLayout.value;
        if (!layout) return null;
        const inChapter = spreadCtx.anchorAt(spreadCtx.index.value);
        return inChapter ? { chapterIndex: activeChapter.value, ...inChapter } : null;
      },
      getVisibleRange: () => {
        const layout = chapterLayout.value;
        if (!layout) return null;
        const start = spreadCtx.anchorAt(spreadCtx.index.value);
        if (!start) return null;
        const end = spreadCtx.anchorAt(spreadCtx.index.value + 1) ?? layout.endAnchor() ?? start;
        return {
          start: { chapterIndex: activeChapter.value, ...start },
          end: { chapterIndex: activeChapter.value, ...end },
        };
      },
      updateOptions: (patch: BookOptionsPatch) => updateOptions(patch),
      subscribe: <E extends EventName>(event: E, listener: MejiroReaderEventMap[E]) => {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(listener);
        return () => {
          listeners.get(event)?.delete(listener);
        };
      },
    } satisfies MejiroReaderHandle);

    function applySettings(next: BookOptionsPatch): void {
      // Fire-and-forget: the application is coalesced and a failure is emitted
      // as `error` by `useMejiroBook`, so this promise never rejects.
      void updateOptions(next);
    }

    const editable = computed<EditableSettings>(() => ({
      fontFamily: options.value.fontFamily,
      fontSize: options.value.fontSize,
      lineSpacing: options.value.lineSpacing ?? DEFAULT_BOOK_OPTIONS.lineSpacing,
      kinsoku: options.value.kinsoku ?? 'strict',
      enableHanging: options.value.enableHanging ?? true,
    }));

    /**
     * Settings region. A host can fully replace the built-in controls with the
     * `settings` slot while keeping the panel chrome and its open/close
     * accordion — the slot receives the live `settings`, an `update(patch)`
     * that re-flows the book, and the `open` / `toggle` panel state. With no
     * slot, the built-in {@link MejiroSettingsPanel} is rendered. Either way the
     * header "Settings" button toggles it.
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
                update: applySettings,
                open: settingsOpen.value,
                toggle: toggleSettings,
              } satisfies MejiroReaderSettingsSlot),
            ),
          ),
        );
      }
      return h(MejiroSettingsPanel, {
        open: settingsOpen.value,
        settings: editable.value,
        fonts: props.fonts ?? undefined,
        'onUpdate:settings': applySettings,
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

    const showChapterSelect = computed(
      () =>
        epub.epub.value != null &&
        (props.chapterNavMode === 'select' || props.chapterNavMode === 'both'),
    );
    const showChapterPanel = computed(
      () =>
        epub.epub.value != null &&
        (props.chapterNavMode === 'panel' || props.chapterNavMode === 'both'),
    );

    function renderHeader(): VNode | VNode[] | null {
      if (slots.header) return slots.header() as VNode | VNode[];
      if (props.title === undefined && !slots.logo) return null;

      const subtitleText = props.subtitle ?? resolvedMessages.value.logoSubtitle;
      const defaultLogo = h('div', { class: 'mejiro-reader-logo' }, [
        h('span', { class: 'mejiro-reader-logo-mark' }, props.title),
        subtitleText ? h('span', { class: 'mejiro-reader-logo-sub' }, subtitleText) : null,
      ]);
      const leftChildren: (VNode | VNode[] | null)[] = [
        slots.logo ? (slots.logo() as VNode | VNode[]) : defaultLogo,
        showChapterSelect.value && epub.epub.value
          ? h(MejiroChapterNav, {
              epub: epub.epub.value,
              chapterIndex: activeChapter.value,
              'onUpdate:chapterIndex': setChapter,
            })
          : null,
      ];

      const actionChildren: (VNode | null)[] = [
        props.showStats
          ? h(MejiroStats, {
              chapter: epub.epub.value?.chapters[activeChapter.value] ?? null,
              pageCount: spreadCtx.pageCount.value,
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
        props.showImageOverlayButton && epub.epub.value
          ? h(
              'button',
              {
                type: 'button',
                class: ['mejiro-reader-btn', { 'is-active': imageCtx.hasOverlays.value }],
                onClick: () =>
                  imageCtx.addOverlay(
                    singlePageImagePlacement(
                      props.mode === 'paginated' ? spreadCtx.singleSide.value : null,
                      layoutCtx.pageWidth.value,
                    ),
                  ),
              },
              resolvedMessages.value.imageButton,
            )
          : null,
        props.showSettings
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
      if (!layoutReady && slots.fallback) {
        const rendered = slots.fallback();
        if (Array.isArray(rendered)) {
          children.push(h('div', { class: 'mejiro-reader-fallback' }, rendered));
        } else if (rendered) {
          children.push(h('div', { class: 'mejiro-reader-fallback' }, [rendered as VNode]));
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
                index: spreadCtx.index.value,
                firstPage: spreadCtx.firstPage.value,
                indexOfPage: spreadCtx.indexOfPage,
              },
              userScroll.value?.layout === layoutCtx.layout.value ? userScroll.value.page : null,
            ),
            'onUpdate:visiblePage': (pageIndex: number, source: 'user' | 'programmatic') => {
              // Ignore the scroll the view performed on our behalf, otherwise
              // it feeds straight back into another `scrollToPage` request.
              if (source === 'programmatic') return;
              const layout = layoutCtx.layout.value;
              if (layout) userScroll.value = { layout, page: pageIndex };
              const target = spreadCtx.indexOfPage(pageIndex);
              if (target !== spreadCtx.index.value) spreadCtx.goTo(target, { animate: false });
            },
            selectionRects: annotationRects.value.length ? annotationRects.value : undefined,
            spreadIndex: spreadCtx.spreadIndex.value,
            images: imageCtx.currentImages.value,
            pageNumbers: props.pageNumbers,
            onImagePointerDown: (id: string, ev: PointerEvent) =>
              imageCtx.onOverlayPointerDown(id, ev),
            onImageResizePointerDown: (id: string, ev: PointerEvent) =>
              imageCtx.onResizePointerDown(id, ev),
            onImageClose: (id: string) => imageCtx.removeOverlay(id),
          }),
        );
        if (props.showPageIndicator) children.push(pageIndicator());
      } else if (layoutReady && spreadCtx.spread.value) {
        const spread = spreadCtx.spread.value;
        const currentSpread = spreadCtx.spreadIndex.value;
        const showLeft = currentSpread * 2 + 2 <= spread.pageCount;
        children.push(
          h(
            MejiroSpread,
            {
              key: `${activeChapter.value}-${spreadCtx.index.value}-${layoutCtx.pageWidth.value}x${layoutCtx.pageHeight.value}`,
              spread,
              pageWidth: layoutCtx.pageWidth.value,
              pageHeight: layoutCtx.pageHeight.value,
              contentHeight: layoutCtx.contentHeight.value,
              fontFamily: options.value.fontFamily,
              fontSize: options.value.fontSize,
              lineSpacing: options.value.lineSpacing,
              turning: spreadCtx.turning.value,
              spreadMode: resolvedSpreadMode.value,
              singleSide: spreadCtx.singleSide.value,
              rightHeader: {
                title: runningTitleRight.value,
                pageNumber: pageNumberFor(props.pageNumbers, currentSpread * 2),
              },
              leftHeader: {
                title: runningTitleLeft.value,
                pageNumber: showLeft
                  ? pageNumberFor(props.pageNumbers, currentSpread * 2 + 1)
                  : null,
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
              onImagePointerDown: (id: string, ev: PointerEvent) =>
                imageCtx.onOverlayPointerDown(id, ev),
              onImageResizePointerDown: (id: string, ev: PointerEvent) =>
                imageCtx.onResizePointerDown(id, ev),
              onImageClose: (id: string) => imageCtx.removeOverlay(id),
              spreadIndex: currentSpread,
              selectionRects: annotationRects.value.length ? annotationRects.value : undefined,
            },
            {
              indicator: () => (props.showPageIndicator ? pageIndicator() : null),
            },
          ),
        );
      }

      return h('div', { class: 'mejiro-reader-surface', ref: surfaceEl }, children);
    }

    const fileInputEl = ref<HTMLInputElement | null>(null);

    /** Keys handled on the reader root: arrows turn pages, Escape closes the settings. */
    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && settingsOpen.value) {
        settingsOpen.value = false;
        return;
      }
      if (!(props.enableKeyboard && layoutCtx.layout.value) || ignoreNavigationKey(e)) return;
      if (e.key === 'ArrowLeft') spreadCtx.next();
      else if (e.key === 'ArrowRight') spreadCtx.prev();
      else return;
      e.preventDefault();
    }

    const themeName = computed<MejiroThemeName>(() =>
      typeof props.theme === 'string' ? props.theme : props.theme.name,
    );
    const themeStyle = computed<Record<string, string> | undefined>(() => {
      const override = typeof props.theme === 'string' ? undefined : props.theme.override;
      // Keep the page's *visual* padding (CSS vars) in sync with the *layout*
      // padding (`pageGeometry.padding*`). Without this the text is laid out for
      // one inset but clipped at another, so a custom padding overflows the page.
      const geometry = props.pageGeometry;
      const padVars: Record<string, string> = {};
      if (geometry?.paddingX != null) padVars['--mejiro-page-pad-x'] = `${geometry.paddingX}px`;
      if (geometry?.paddingY != null) padVars['--mejiro-page-pad-y'] = `${geometry.paddingY}px`;
      if (geometry?.paddingBottom != null) {
        padVars['--mejiro-page-pad-bottom'] = `${geometry.paddingBottom}px`;
      }
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
                ref: rootEl,
                class: [
                  'mejiro-reader',
                  {
                    'mejiro-reader--chrome-hidden': chromeHidden.value,
                    'mejiro-reader--fit-width': props.fit === 'width',
                  },
                ],
                'data-mejiro-theme': themeName.value,
                style: themeStyle.value,
                tabindex: props.enableKeyboard ? 0 : undefined,
                onKeydown,
              },
              [
                renderHeader(),
                props.showSettings ? renderSettings() : null,
                h(
                  'div',
                  {
                    class: ['mejiro-reader-body', { 'has-chapter-panel': showChapterPanel.value }],
                  },
                  [
                    showChapterPanel.value && epub.epub.value
                      ? h(MejiroChapterNav, {
                          epub: epub.epub.value,
                          chapterIndex: activeChapter.value,
                          variant: 'panel',
                          'onUpdate:chapterIndex': setChapter,
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
                  spreadCtx.count.value > 0
                    ? formatMessage(resolvedMessages.value.spreadAnnouncement, {
                        spread: spreadCtx.index.value + 1,
                        total: spreadCtx.count.value,
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
