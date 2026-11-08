import { MejiroBrowser, measurerOf, verticalLineWidth } from '../browser/integration.js';
import type { CharMeasurer } from '../browser/measure.js';
import { deriveRubyFont } from '../browser/measure.js';
import type { FontFamily } from '../browser/types.js';
import { toFontSpec } from '../browser/types.js';
import type { WidthCacheStats } from '../browser/width-cache.js';
import { MejiroError } from '../errors.js';
import { type ManuscriptDialect, parseManuscript } from '../manuscript.js';
import { manuscriptParagraphs, parseInlineImageMarker } from '../manuscript-paragraphs.js';
import { normalizeAnnotatedText } from '../normalize.js';
import { type HeadingStyle, isHeadingParagraph } from '../render/measures.js';
import type { RenderEntry } from '../render/types.js';
import type { RubyAnnotation } from '../ruby.js';
import type { TcyAnnotation } from '../tcy.js';
import { buildTcyAnnotations } from '../tcy.js';
import { toCodepoints } from '../text.js';
import {
  type AnalyzerIdentity,
  type BreakCostOptions,
  type ChapterSource,
  DEFAULT_LINE_SPACING,
  type InlineAnnotation,
  type InlineRubyAnnotation,
  type KinsokuMode,
  type ManuscriptChapter,
  type TextAnalysis,
  type TextAnalyzer,
  type TypographyHints,
} from '../types.js';
import { deriveTypographyHints } from '../typography-hints.js';
import type { CachedParagraph, ChapterLayout, LayoutConfig } from './chapter-layout.js';
import {
  assertPageSize,
  chapterLayoutChannel,
  createChapterLayout,
  paragraphFontSize,
} from './chapter-layout.js';
import { DEFAULT_PAGE_GEOMETRY, DEFAULT_PAGE_PADDING } from './constants.js';
import { type ChapterLayoutSnapshot, readChapterLayoutSnapshot } from './snapshot.js';
import type {
  BookOptions,
  BookOptionsPatch,
  BookParagraph,
  FitPageSizeOptions,
  PageGeometry,
  PageSize,
  ResolvedBookOptions,
} from './types.js';

/** Options for {@link MejiroBook.layoutManuscript}. */
export interface LayoutManuscriptOptions {
  /** Chapters to lay out, sequentially; the returned layouts follow the same order. */
  chapters: readonly ManuscriptChapter[];
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
}

function manuscriptChapterToParagraphs(
  chapter: ManuscriptChapter,
  dialect: ManuscriptDialect,
): BookParagraph[] {
  const paragraphs: BookParagraph[] = [];
  if (chapter.title) {
    paragraphs.push({
      text: chapter.title,
      inlineAnnotations: [],
      headingLevel: 1,
    });
  }
  for (const block of manuscriptParagraphs(chapter.body)) {
    if (parseInlineImageMarker(block)) continue;
    const parsed = parseManuscript(block, { dialect });
    paragraphs.push({
      text: parsed.text,
      inlineAnnotations: parsed.inlineAnnotations,
    });
  }
  return paragraphs;
}

interface InternalOptions {
  fontFamily: FontFamily;
  fontSize: number;
  lineSpacing: number;
  kinsoku: KinsokuMode;
  enableHanging: boolean;
  headingStyles?: Record<number, HeadingStyle>;
  headingScale: number;
}

/** The geometry a book lays out for: a page size, and its heights when a fit measured them. */
type BookPageSize = Required<PageSize> &
  Partial<Pick<PageGeometry, 'pageHeight' | 'contentHeight'>>;

function buildLayoutRubyAnnotations(
  annotations: readonly InlineAnnotation[] | undefined,
  rubyFontSpec: string,
  measurer: CharMeasurer,
): RubyAnnotation[] | undefined {
  if (!annotations?.length) return undefined;
  const rubies = annotations.filter((a): a is InlineRubyAnnotation => a.type === 'ruby');
  if (!rubies.length) return undefined;
  return rubies.map((ann) => {
    const rubyText = toCodepoints(ann.rubyText);
    return {
      startIndex: ann.startIndex,
      endIndex: ann.endIndex,
      rubyText,
      rubyAdvances: measurer.measureAll(rubyFontSpec, rubyText),
      rubyType: ann.rubyType,
      jukugoSplitPoints: ann.jukugoSplitPoints,
    };
  });
}

/** True when two analyzer identities describe the same analyzer, absence included. */
function sameAnalyzer(a: AnalyzerIdentity | undefined, b: AnalyzerIdentity | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.name === b.name && a.version === b.version;
}

/**
 * Writes a recovered failure to the console, for a book given no `onError`.
 *
 * A failing analyzer costs break quality, never availability, but the notice
 * still has to reach the developer. Guarded, because the layout path also runs
 * on hosts without a console.
 */
function warnRecovered(error: MejiroError): void {
  // biome-ignore lint/suspicious/noConsole: the documented default of BookOptions.onError
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  // biome-ignore lint/suspicious/noConsole: the documented default of BookOptions.onError
  console.warn(`[mejiro] MejiroBook: ${error.message}`, error.cause);
}

/**
 * High-level API for Japanese vertical text layout.
 *
 * Manages font loading, character measurement, and provides a simple
 * interface for layout, pagination, and image exclusion.
 *
 * @example
 * ```ts
 * const book = new MejiroBook({
 *   fontFamily: '"Noto Serif JP"',
 *   fontSize: 16,
 *   lineSpacing: 1.8,
 *   headingStyles: { 1: { scale: 1.6, gapAfterEm: 1.4 } },
 *   pageSize: { pageWidth: 400, lineWidth: 600 },
 * });
 *
 * const layout = await book.layoutChapter(chapter);
 * const spread = layout.getSpread(0);
 * // render spread.right and spread.left
 * ```
 */
export class MejiroBook {
  private opts: InternalOptions;
  private size: BookPageSize | null = null;
  private browser: MejiroBrowser;
  // Share the browser's measurer so MejiroBook's caching and propagation
  // touch the same WidthCache instance the browser populates during initial
  // layout.
  private get measurer(): CharMeasurer {
    return measurerOf(this.browser);
  }
  // WeakRef tracking lets the caller drop a layout without us holding it
  // alive. `updateOptions` walks the set on each call and prunes refs whose
  // referent has been collected.
  private layouts = new Set<WeakRef<ChapterLayout>>();
  private listeners = new Set<() => void>();
  // Desired options of the in-flight measurement, staged until the font has
  // loaded so a failed load never becomes observable through `getOptions`.
  private pendingOpts: InternalOptions | null = null;
  // Monotonic counter used to abandon an `updateOptions` call that a later one
  // superseded while its font was still loading.
  private optionsGeneration = 0;

  // Typography-hint configuration. Held apart from `opts` because
  // `updateOptions` cannot change any of it: re-staging the analysis of every
  // live layout is not something a font-size patch should do behind the
  // caller's back.
  private analyzer?: TextAnalyzer;
  private wordAwareBreaking: 'off' | 'clusters' | 'full';
  private keepWholePos?: readonly string[];
  private keepWholePenalty?: number;
  private breakCost?: BreakCostOptions;
  private onError?: (error: MejiroError) => void;
  // One notice per book: a broken analyzer would otherwise report once per paragraph.
  private analyzerWarned = false;
  // Hints already derived for a source paragraph, so laying the same chapter
  // out again (resize, option change) replays them instead of re-analysing.
  private derivedHints = new WeakMap<
    BookParagraph,
    { text: string; hints: TypographyHints | undefined }
  >();
  // Paragraphs parsed from a manuscript chapter, kept while its text is
  // unchanged so they stay the same objects the hints above are keyed on.
  private manuscriptParagraphs = new WeakMap<
    ManuscriptChapter,
    { title: string; body: string; dialect: ManuscriptDialect; paragraphs: BookParagraph[] }
  >();

  /**
   * Records the typographic options and creates the browser-side measurer.
   * Nothing is measured or loaded yet: fonts are loaded lazily on the first
   * layout. Give the page geometry as {@link BookOptions.pageSize}, or later
   * through {@link MejiroBook.setPageSize} or {@link MejiroBook.fitPageSize};
   * until one of them has run, `layoutChapter` rejects.
   *
   * Live layouts are re-measured whenever the host reports newly loaded
   * fonts, so widths taken against a fallback face do not outlive it.
   *
   * @param options - Typography plus the construction-time keys listed on
   *   {@link BookOptions}.
   * @throws TypeError when `fontFamily` is absent or empty, or `fontSize` is absent.
   * @throws RangeError when `fontSize` is not a positive finite number, or
   *   `pageSize` fails the checks of {@link MejiroBook.setPageSize}.
   */
  constructor(options: BookOptions) {
    if (options.fontFamily === undefined || options.fontSize === undefined) {
      throw new TypeError('MejiroBook: fontFamily and fontSize are required');
    }
    // The browser checks both values, so a book never holds an unusable font.
    this.browser = new MejiroBrowser({
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      strictFontCheck: options.strictFontCheck,
      onFontsLoaded: () => {
        this.remeasureLayouts();
        this.notify();
      },
    });
    this.opts = {
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      lineSpacing: options.lineSpacing ?? DEFAULT_LINE_SPACING,
      kinsoku: options.kinsoku ?? 'strict',
      enableHanging: options.enableHanging ?? true,
      headingStyles: options.headingStyles,
      headingScale: options.headingScale ?? 1.4,
    };
    this.analyzer = options.analyzer;
    this.wordAwareBreaking = options.wordAwareBreaking ?? 'off';
    this.keepWholePos = options.keepWholePos;
    this.keepWholePenalty = options.keepWholePenalty;
    this.breakCost = options.breakCost;
    this.onError = options.onError;
    if (options.pageSize) this.setPageSize(options.pageSize);
  }

  /**
   * Calls `listener` whenever the book changes its live layouts: after an
   * {@link MejiroBook.updateOptions} takes effect, and after newly loaded
   * fonts re-measure them. Read what changed from the layouts themselves.
   *
   * A listener that throws does not stop the others; its error is rethrown on
   * a microtask.
   *
   * @returns A function that removes the listener. Idempotent.
   */
  subscribe(listener: () => void): () => void {
    const entry = () => listener();
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  /**
   * Releases the book's `document.fonts` subscription; the book stays usable,
   * and its next layout or font change subscribes again.
   *
   * Lets the book, its width cache and its layouts be collected once the host
   * drops them. Call it when the owning view unmounts. Idempotent.
   */
  dispose(): void {
    this.browser.dispose();
  }

  /**
   * Returns a snapshot of the options the book is using, construction-time
   * ones (`analyzer`, `wordAwareBreaking`, `keepWholePos`, `keepWholePenalty`,
   * `breakCost`) included.
   */
  getOptions(): ResolvedBookOptions {
    return {
      ...this.opts,
      analyzer: this.analyzer,
      wordAwareBreaking: this.wordAwareBreaking,
      keepWholePos: this.keepWholePos,
      keepWholePenalty: this.keepWholePenalty,
      breakCost: this.breakCost,
    };
  }

  /**
   * Merges `patch` into the book's options and propagates the change to every
   * live {@link ChapterLayout} produced by this book. Keys left out of the
   * patch keep their current values.
   *
   * Changes that need no re-measurement (`lineSpacing` / `kinsoku` /
   * `enableHanging`) are applied synchronously and the returned promise is
   * already resolved. Font family / size / heading scale changes require
   * re-measurement: the new values are staged and only become visible to
   * {@link getOptions} once the font has loaded, so every live layout always
   * holds advances measured with the font recorded in its own config.
   * Subscribers are notified once the change has reached the layouts.
   *
   * Overlapping calls converge on the last one — an earlier call whose font is
   * still loading resolves without overwriting the newer options.
   *
   * @throws MejiroError `font-unavailable` if `strictFontCheck` is enabled and
   *   the font of a staged change measures as a fallback, or `font-load-failed`
   *   if it fails to load. The rejection leaves the previously applied options
   *   in place. Without `strictFontCheck`, a font that fails to load is
   *   committed and measured as the host resolves it.
   */
  updateOptions(patch: BookOptionsPatch): Promise<void> {
    // Stack the patch on the in-flight request when there is one, so a change
    // that is still loading is not silently dropped by the next call.
    const next: InternalOptions = { ...(this.pendingOpts ?? this.opts) };
    if (patch.fontFamily != null) next.fontFamily = patch.fontFamily;
    if (patch.fontSize != null) next.fontSize = patch.fontSize;
    if (patch.lineSpacing != null) next.lineSpacing = patch.lineSpacing;
    if (patch.kinsoku != null) next.kinsoku = patch.kinsoku;
    if (patch.enableHanging != null) next.enableHanging = patch.enableHanging;
    if (patch.headingStyles !== undefined) next.headingStyles = patch.headingStyles;
    if (patch.headingScale != null) next.headingScale = patch.headingScale;

    // A layout restored from a snapshot may hold advances measured at another
    // size; it is re-measured on the first option change, not relabelled.
    const needsMeasurement =
      next.fontFamily !== this.opts.fontFamily ||
      next.fontSize !== this.opts.fontSize ||
      next.headingStyles !== this.opts.headingStyles ||
      next.headingScale !== this.opts.headingScale ||
      [...this.liveLayouts()].some((layout) => !chapterLayoutChannel(layout).measuredAt(next));

    const generation = ++this.optionsGeneration;
    if (!needsMeasurement) {
      this.pendingOpts = null;
      this.opts = next;
      this.applyConfigToLayouts();
      this.notify();
      return Promise.resolve();
    }
    this.pendingOpts = next;
    return this.commitMeasuredOptions(next, generation);
  }

  /**
   * Loads the font for a staged option set, then commits it and re-measures
   * every live layout in one synchronous step so advances and config can never
   * be observed out of sync.
   */
  private async commitMeasuredOptions(next: InternalOptions, generation: number): Promise<void> {
    try {
      await this.browser.preloadFont(next.fontFamily, next.fontSize);
    } catch (err) {
      if (this.optionsGeneration === generation) this.pendingOpts = null;
      throw err;
    }
    // A later updateOptions has taken over; committing here would pair its
    // config with advances measured for this (now stale) font spec.
    if (this.optionsGeneration !== generation) return;
    this.pendingOpts = null;
    this.opts = next;
    this.remeasureLayouts(this.layoutConfigSnapshot());
    this.notify();
  }

  /** Walks tracked layouts, pruning collected ones and yielding the rest. */
  private *liveLayouts(): IterableIterator<ChapterLayout> {
    for (const ref of [...this.layouts]) {
      const layout = ref.deref();
      if (layout) yield layout;
      else this.layouts.delete(ref);
    }
  }

  private applyConfigToLayouts(): void {
    const cfg = this.layoutConfigSnapshot();
    for (const layout of this.liveLayouts()) chapterLayoutChannel(layout).applyConfig(cfg);
  }

  /**
   * Re-measures every live layout. Runs to completion synchronously so no other
   * call can interleave between the advances and the config they belong to.
   *
   * @param cfg - Config to adopt, for a commit of new options. Without it each
   *   layout is re-measured against the config it already holds, so a font load
   *   refreshes advances without replacing a snapshot's config.
   */
  private remeasureLayouts(cfg?: LayoutConfig): void {
    for (const layout of this.liveLayouts()) {
      this.remeasureLayout(layout, cfg ?? chapterLayoutChannel(layout).getConfig());
    }
  }

  /** Re-measures one layout at `cfg` and adopts `cfg`. */
  private remeasureLayout(layout: ChapterLayout, cfg: LayoutConfig): void {
    const channel = chapterLayoutChannel(layout);
    const { fontFamily, fontSize } = cfg;
    const baseFontSpec = toFontSpec(fontFamily, fontSize);
    for (const para of channel.cachedParagraphs()) {
      const pFontSize = paragraphFontSize(para, cfg);
      const spec = pFontSize === fontSize ? baseFontSpec : toFontSpec(fontFamily, pFontSize);
      // Ruby is measured at half the *paragraph's* scaled size, matching the
      // initial layout path and the shipped `rt { font-size: 0.5em }` rule.
      const rubySpec = deriveRubyFont(fontFamily, pFontSize);
      para.advances = this.measurer.measureAll(spec, para.text);
      para.layoutRubyAnnotations = buildLayoutRubyAnnotations(
        para.inlineAnnotations,
        rubySpec,
        this.measurer,
      );
      // The combined box is one em of the paragraph's own size, so it has to
      // be rebuilt whenever that size changes.
      para.layoutTcyAnnotations = buildTcyAnnotations(para.inlineAnnotations, pFontSize);
    }
    channel.recomputeAfterMeasurement(cfg);
  }

  /**
   * The one path by which a layout becomes live, so every later option change
   * and font load reaches it.
   *
   * @param measured - Whether the layout's advances were measured by this
   *   book. When their family or sizes no longer match the committed options —
   *   a commit landed while the layout was being measured — the layout is
   *   re-measured before it is returned; otherwise it takes up the committed
   *   options that need no measuring. `false` for advances carried in by a
   *   snapshot, which keep their own config until the next
   *   {@link MejiroBook.updateOptions}, which re-measures them if their sizes differ.
   */
  private registerLayout(layout: ChapterLayout, measured: boolean): ChapterLayout {
    this.layouts.add(new WeakRef(layout));
    if (!measured) return layout;
    const cfg = this.layoutConfigSnapshot();
    const channel = chapterLayoutChannel(layout);
    if (!channel.measuredAt(cfg)) {
      this.remeasureLayout(layout, cfg);
    } else {
      channel.applyConfig(cfg);
    }
    return layout;
  }

  private layoutConfigSnapshot(): LayoutConfig {
    return {
      fontFamily: this.opts.fontFamily,
      fontSize: this.opts.fontSize,
      lineSpacing: this.opts.lineSpacing,
      headingStyles: this.opts.headingStyles,
      headingScale: this.opts.headingScale,
      kinsoku: this.opts.kinsoku,
      enableHanging: this.opts.enableHanging,
      breakCost: this.breakCost,
      analyzer: this.analyzer?.identity,
    };
  }

  /**
   * Derives the line breaking hints for one already-normalized paragraph.
   *
   * Called once per paragraph text, through {@link MejiroBook.hintsFor}. The
   * result is cached, so every later re-break and every re-layout of the same
   * chapter replays it: a resize, a font change or an image-exclusion reflow is
   * on the interactive path, and the analysis of a paragraph cannot change while
   * its text does not.
   *
   * @param text - The paragraph in the same NFC form the layout is given. The
   *   offsets an analysis carries address exactly this string, so an analysis
   *   of any other text yields no hints at all.
   */
  private deriveHints(text: string): TypographyHints | undefined {
    if (this.wordAwareBreaking === 'off' || !this.analyzer) return undefined;
    let analysis: TextAnalysis;
    try {
      analysis = this.analyzer.analyze(text);
    } catch (cause) {
      this.reportAnalyzerFailure(cause);
      return undefined;
    }
    if (analysis.text !== text) return undefined;
    return deriveTypographyHints(analysis, {
      penalties: this.wordAwareBreaking === 'full',
      ...(this.keepWholePos === undefined ? {} : { keepWholePos: this.keepWholePos }),
      ...(this.keepWholePenalty === undefined ? {} : { keepWholePenalty: this.keepWholePenalty }),
    });
  }

  /**
   * Hands the first analyzer failure of this book to `onError`, or to the
   * console when none was given. The paragraph is laid out without hints.
   */
  private reportAnalyzerFailure(cause: unknown): void {
    if (this.analyzerWarned) return;
    this.analyzerWarned = true;
    const error = new MejiroError(
      'analyzer-failed',
      'the configured TextAnalyzer threw; laying out without typography hints. ' +
        'Further failures from this book are not reported.',
      { cause },
    );
    if (this.onError) this.onError(error);
    else warnRecovered(error);
  }

  /** Hints for a source paragraph, derived once per paragraph text. */
  private hintsFor(p: BookParagraph, text: string): TypographyHints | undefined {
    if (this.wordAwareBreaking === 'off' || !this.analyzer) return undefined;
    const known = this.derivedHints.get(p);
    if (known?.text === text) return known.hints;
    const hints = this.deriveHints(text);
    this.derivedHints.set(p, { text, hints });
    return hints;
  }

  /** Parsed paragraphs of a manuscript chapter, reused while its text is unchanged. */
  private manuscriptParagraphsOf(
    chapter: ManuscriptChapter,
    dialect: ManuscriptDialect,
  ): BookParagraph[] {
    const known = this.manuscriptParagraphs.get(chapter);
    if (
      known?.title === chapter.title &&
      known.body === chapter.body &&
      known.dialect === dialect
    ) {
      return known.paragraphs;
    }
    const paragraphs = manuscriptChapterToParagraphs(chapter, dialect);
    this.manuscriptParagraphs.set(chapter, {
      title: chapter.title,
      body: chapter.body,
      dialect,
      paragraphs,
    });
    return paragraphs;
  }

  /**
   * Sets the page geometry used by subsequent {@link layoutChapter} calls,
   * without measuring anything; {@link MejiroBook.fitPageSize} measures a
   * container instead. A {@link PageGeometry} keeps its heights.
   *
   * @throws RangeError when `pageWidth` or `lineWidth` is absent or not a
   *   positive finite number, a padding is not a non-negative finite number,
   *   or `paddingX` is not below half of `pageWidth`. The previous size is kept.
   */
  setPageSize(size: PageSize): void {
    assertPageSize(size, 'MejiroBook.setPageSize');
    const heights = size as Partial<PageGeometry>;
    this.size = {
      pageWidth: size.pageWidth,
      lineWidth: size.lineWidth,
      paddingX: size.paddingX ?? 0,
      paddingY: size.paddingY ?? 0,
      ...(heights.pageHeight !== undefined && heights.contentHeight !== undefined
        ? { pageHeight: heights.pageHeight, contentHeight: heights.contentHeight }
        : {}),
    };
  }

  /**
   * Measures `container`, saves the result as this book's page size, and
   * returns it.
   *
   * Defaults to a 1.45 aspect ratio, page width minimums of 280×400 px,
   * a 780 px height ceiling, a 56 px header reservation, and a 48 px
   * gutter reservation. All of these are overridable via the second
   * argument; see {@link FitPageSizeOptions}.
   *
   * Padding not given in `options` follows the `--mejiro-page-pad-x`,
   * `--mejiro-page-pad-y` and `--mejiro-page-pad-bottom` custom properties the
   * container inherits, so the layout matches the inset the reader stylesheet
   * draws (it narrows on small screens); without the stylesheet it falls back
   * to {@link DEFAULT_PAGE_PADDING}.
   *
   * @param container - DOM element representing the reading surface.
   * @param options - Page geometry and padding overrides. Defaults to
   *   {@link DEFAULT_PAGE_GEOMETRY} + the drawn page padding.
   * @returns The saved geometry, ready to pass to {@link ChapterLayout.resize}.
   * @throws RangeError when the container measures zero wide or high — it is
   *   not attached or not displayed — or the fitted size fails the checks of
   *   {@link MejiroBook.setPageSize}. Nothing is saved.
   */
  fitPageSize(container: HTMLElement, options?: FitPageSizeOptions): PageGeometry {
    if (!(container.clientWidth > 0 && container.clientHeight > 0)) {
      throw new RangeError(
        'MejiroBook.fitPageSize: the container measures zero; it must be attached and displayed',
      );
    }
    // The reader stylesheet draws the page inset; laying out for another one
    // would place text and image exclusion off the drawn page.
    const drawn = stylesheetPagePadding(container);
    const paddingX = options?.paddingX ?? drawn.x ?? DEFAULT_PAGE_PADDING.paddingX;
    const paddingY = options?.paddingY ?? drawn.y ?? DEFAULT_PAGE_PADDING.paddingY;
    const paddingBottom =
      options?.paddingBottom ?? drawn.bottom ?? DEFAULT_PAGE_PADDING.paddingBottom;
    const aspect = options?.aspect ?? DEFAULT_PAGE_GEOMETRY.aspect;
    const minWidth = options?.minWidth ?? DEFAULT_PAGE_GEOMETRY.minWidth;
    const minHeight = options?.minHeight ?? DEFAULT_PAGE_GEOMETRY.minHeight;
    const maxHeight = options?.maxHeight ?? DEFAULT_PAGE_GEOMETRY.maxHeight;
    const headerOffset = options?.headerOffset ?? DEFAULT_PAGE_GEOMETRY.headerOffset;
    const gutterOffset = options?.gutterOffset ?? DEFAULT_PAGE_GEOMETRY.gutterOffset;
    const columns = options?.columns ?? 2;

    const availH = container.clientHeight - headerOffset;
    const availW = container.clientWidth - gutterOffset;

    let h = Math.min(availH, maxHeight);
    let w = Math.round(h / aspect);
    // Bound the page width by the container: a two-page spread shares the width
    // across both pages, a single-page reader gets the full width.
    if (w * columns > availW) {
      w = Math.floor(availW / columns);
      h = Math.round(w * aspect);
    }
    w = Math.max(w, minWidth);
    h = Math.max(h, minHeight);

    const contentHeight = h - paddingY - paddingBottom;
    const geometry: PageGeometry = {
      pageWidth: w,
      lineWidth: verticalLineWidth(contentHeight, this.opts.fontSize),
      paddingX,
      paddingY,
      pageHeight: h,
      contentHeight,
    };
    this.setPageSize(geometry);
    return geometry;
  }

  /**
   * Lays out a chapter and returns a {@link ChapterLayout} for pagination and rendering.
   *
   * The chapter object is compatible with `EpubChapter` from `@libraz/mejiro/epub`.
   * Font loading and character measurement are handled automatically.
   *
   * The page geometry and options in effect when the call starts are captured
   * up front, so a concurrent {@link setPageSize} / {@link updateOptions}
   * cannot leave the returned layout holding geometry its break points were
   * not computed for.
   *
   * @param chapter - Chapter with paragraphs to lay out.
   * @returns A layout object for retrieving pages and managing image exclusions.
   * @throws MejiroError `page-size-unset` if no page size has been given, by
   *   {@link BookOptions.pageSize}, {@link setPageSize} or {@link fitPageSize}.
   * @throws MejiroError `font-unavailable` / `font-load-failed` as
   *   {@link MejiroBook.updateOptions} describes.
   */
  async layoutChapter(chapter: ChapterSource): Promise<ChapterLayout> {
    if (!this.size) {
      throw new MejiroError(
        'page-size-unset',
        'Page size not set. Pass pageSize, or call setPageSize() or fitPageSize() first.',
      );
    }

    const opts: InternalOptions = { ...this.opts };
    const size: BookPageSize = { ...this.size };
    const { fontFamily, fontSize, lineSpacing, kinsoku, enableHanging } = opts;
    const { lineWidth } = size;

    // Normalize once, up front: text and its annotations have to move to NFC
    // together, and the same pair has to feed the initial break, the render
    // entries and the cached paragraphs every later re-break works from.
    const normalized = chapter.paragraphs.map((p) => {
      const isHeading = isHeadingParagraph(p);
      const annotated = normalizeAnnotatedText(p.text, p.inlineAnnotations ?? []);
      return {
        ...annotated,
        isHeading,
        paragraphFontSize: paragraphFontSize(p, opts),
        // The analysis runs here, once, against the NFC text — the same string
        // the break, the render entries and every later re-break work from. A
        // paragraph carrying its own hints is taken at its word and the
        // analyzer is not consulted for it.
        hints: p.hints ?? this.hintsFor(p, annotated.text),
      };
    });

    // Initial layout via MejiroBrowser (handles font loading + ruby)
    const result = await this.browser.layoutParagraphs({
      paragraphs: normalized.map((p) => ({
        text: p.text,
        inlineAnnotations: p.inlineAnnotations.length ? p.inlineAnnotations : undefined,
        fontSize: p.isHeading ? p.paragraphFontSize : undefined,
        hints: p.hints,
      })),
      fontFamily,
      fontSize,
      lineWidth,
      kinsoku,
      enableHanging,
      breakCost: this.breakCost,
    });

    // Build render entries from initial layout results
    const renderEntries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
      chars: result.paragraphs[i].chars,
      breakPoints: result.paragraphs[i].breakResult.breakPoints,
      inlineAnnotations: normalized[i].inlineAnnotations,
      headingLevel: p.headingLevel,
      kind: p.kind,
    }));

    // Cache paragraph data for re-layout on resize/exclusion
    const baseFontSpec = toFontSpec(fontFamily, fontSize);
    const cached: CachedParagraph[] = chapter.paragraphs.map((p, i) => {
      const { text, inlineAnnotations, paragraphFontSize, hints } = normalized[i];
      const spec =
        paragraphFontSize === fontSize ? baseFontSpec : toFontSpec(fontFamily, paragraphFontSize);
      const rubySpec = deriveRubyFont(fontFamily, paragraphFontSize);
      const codepoints = toCodepoints(text);
      const advances = this.measurer.measureAll(spec, codepoints);
      return {
        text: codepoints,
        advances,
        chars: result.paragraphs[i].chars,
        inlineAnnotations,
        layoutRubyAnnotations: buildLayoutRubyAnnotations(
          inlineAnnotations,
          rubySpec,
          this.measurer,
        ),
        layoutTcyAnnotations: buildTcyAnnotations(inlineAnnotations, paragraphFontSize),
        headingLevel: p.headingLevel,
        // Cached so every re-break replays this analysis instead of redoing it.
        hintClusterIds: hints?.clusterIds,
        hintBreakPenalties: hints?.breakPenalties,
      };
    });

    // The analyzer identity travels with the config so that a snapshot taken of
    // this layout records which analyzer the hints above came from.
    const config: LayoutConfig = {
      fontFamily,
      fontSize,
      lineSpacing,
      headingStyles: opts.headingStyles,
      headingScale: opts.headingScale,
      kinsoku,
      enableHanging,
      breakCost: this.breakCost,
      analyzer: this.analyzer?.identity,
    };

    return this.registerLayout(createChapterLayout(cached, renderEntries, config, size), true);
  }

  /**
   * Lays out one or more manuscript chapters directly, skipping the EPUB ZIP
   * round-trip used by `MejiroEditor` / `EpubProject.export`. Intended for
   * live preview in manuscript editors.
   *
   * Each chapter body is split into paragraphs on blank lines, keeping the
   * ideographic spaces that indent a paragraph or stand alone as a scene
   * divider, and run through {@link parseManuscript} so the renderer sees the
   * same paragraphs and `InlineAnnotation`s an exported EPUB would carry.
   * Inline-image markers are skipped, as the exported figures are.
   *
   * @returns One layout per chapter, at the chapter's index in `options.chapters`.
   * @throws The same errors as {@link MejiroBook.layoutChapter}.
   */
  async layoutManuscript(options: LayoutManuscriptOptions): Promise<ChapterLayout[]> {
    const dialect = options.dialect ?? 'mejiro';
    const result: ChapterLayout[] = [];
    for (const chapter of options.chapters) {
      const paragraphs = this.manuscriptParagraphsOf(chapter, dialect);
      result.push(await this.layoutChapter({ paragraphs }));
    }
    return result;
  }

  /**
   * Rebuilds a {@link ChapterLayout} from a {@link ChapterLayout.snapshot}.
   *
   * Skips the measurement round-trip (font loading + Canvas.measureText for
   * every codepoint) by reusing the pre-computed `advances` and ruby layout
   * baked into the snapshot. Intended for SSR / build-time pre-computation:
   * the server runs `layout.snapshot()`, ships the JSON to the client, and
   * the client calls this method on mount.
   *
   * The returned layout uses the **snapshot's** config and page geometry,
   * not this book's current options. Its advances are taken to be measured in
   * this book's font family, which the snapshot does not record. The next
   * {@link MejiroBook.updateOptions} re-measures it against the book's options
   * whenever the snapshot's font size or heading scales differ from them, so
   * a restored layout never carries the book's sizes over advances measured
   * at others.
   *
   * Typography hints are carried over only when the snapshot was produced by
   * the same analyzer this book is configured with; otherwise they are dropped
   * and future re-breaks fall back to the character-class rules. Nothing is
   * re-analysed here — see {@link ChapterLayoutSnapshotConfig.analyzer}.
   *
   * @param snapshot - Value previously returned by `layout.snapshot()`, as an
   *   object or parsed back from JSON. A snapshot in the previous (version 2)
   *   format is read too.
   * @returns A {@link ChapterLayout} positioned exactly as it was at snapshot time.
   * @throws MejiroError `snapshot-invalid` if the value is not an object, is of
   *   an unsupported format version, or is malformed: an advance array whose
   *   length is not the paragraph's codepoint count, break points that are not
   *   strictly increasing inside the paragraph, an annotation span outside it,
   *   or a missing or non-finite field.
   */
  layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout {
    snapshot = readChapterLayoutSnapshot(snapshot);
    // A snapshot carrying no hints has nothing to weigh an identity against, so
    // the comparison is only worth making once one is found.
    const hasHints = snapshot.paragraphs.some(
      (p) => p.hintClusterIds !== undefined || p.hintBreakPenalties !== undefined,
    );
    const keepHints = hasHints && sameAnalyzer(snapshot.config.analyzer, this.analyzer?.identity);
    const cached: CachedParagraph[] = snapshot.paragraphs.map((p) => {
      const codepoints = toCodepoints(p.text);
      const chars = [...p.text];
      const advances = new Float32Array(p.advances);
      const layoutRubyAnnotations: RubyAnnotation[] | undefined = p.layoutRubyAnnotations?.map(
        (r) => ({
          startIndex: r.startIndex,
          endIndex: r.endIndex,
          rubyText: new Uint32Array(r.rubyText),
          rubyAdvances: new Float32Array(r.rubyAdvances),
          ...(r.rubyType ? { rubyType: r.rubyType } : {}),
          ...(r.jukugoSplitPoints ? { jukugoSplitPoints: [...r.jukugoSplitPoints] } : {}),
        }),
      );
      const layoutTcyAnnotations: TcyAnnotation[] | undefined = p.layoutTcyAnnotations?.map(
        (t) => ({ ...t }),
      );
      return {
        text: codepoints,
        advances,
        chars,
        inlineAnnotations: p.inlineAnnotations,
        ...(layoutRubyAnnotations ? { layoutRubyAnnotations } : {}),
        ...(layoutTcyAnnotations ? { layoutTcyAnnotations } : {}),
        ...(keepHints && p.hintClusterIds
          ? { hintClusterIds: new Uint32Array(p.hintClusterIds) }
          : {}),
        ...(keepHints && p.hintBreakPenalties
          ? { hintBreakPenalties: new Uint8Array(p.hintBreakPenalties) }
          : {}),
        ...(p.kind != null ? { kind: p.kind } : {}),
        ...(p.headingLevel != null ? { headingLevel: p.headingLevel } : {}),
      };
    });
    const entries: RenderEntry[] = snapshot.paragraphs.map((p, i) => ({
      chars: cached[i].chars,
      breakPoints: new Uint32Array(p.breakPoints),
      inlineAnnotations: p.inlineAnnotations,
      ...(p.kind != null ? { kind: p.kind } : {}),
      ...(p.headingLevel != null ? { headingLevel: p.headingLevel } : {}),
    }));
    const config: LayoutConfig = {
      fontFamily: this.opts.fontFamily,
      fontSize: snapshot.config.fontSize,
      lineSpacing: snapshot.config.lineSpacing,
      kinsoku: snapshot.config.kinsoku,
      enableHanging: snapshot.config.enableHanging,
      headingScale: snapshot.config.headingScale,
      ...(snapshot.config.headingStyles ? { headingStyles: snapshot.config.headingStyles } : {}),
      ...(snapshot.config.breakCost ? { breakCost: snapshot.config.breakCost } : {}),
      // Only claim the analyzer whose hints survived the restore, so a snapshot
      // taken of the restored layout records what its breaks really depend on.
      ...(keepHints && snapshot.config.analyzer ? { analyzer: snapshot.config.analyzer } : {}),
    };
    const layout = createChapterLayout(cached, entries, config, { ...snapshot.size });
    // Restoring adopts the images without reflowing once per spread.
    chapterLayoutChannel(layout).restoreImages(snapshot.images ?? []);
    return this.registerLayout(layout, false);
  }

  /**
   * Clears the character width measurement cache.
   *
   * @param fontSpec - A CSS font shorthand such as `'16px serif'` whose widths
   *   to drop; every font's when omitted.
   */
  clearCache(fontSpec?: string): void {
    this.browser.clearCache(fontSpec);
  }

  /**
   * Returns the current measurement cache size.
   * Useful for capacity monitoring across long reader sessions.
   *
   * @returns Number of font specs cached and the total number of codepoints
   *   measured across all fonts.
   */
  cacheStats(): WidthCacheStats {
    return this.browser.cacheStats();
  }
}

/**
 * Page padding the reader stylesheet applies around `container`, read from the
 * `--mejiro-page-pad-*` custom properties it inherits. A side is `undefined`
 * when no stylesheet sets it.
 */
function stylesheetPagePadding(container: HTMLElement): {
  x?: number;
  y?: number;
  bottom?: number;
} {
  const style = getComputedStyle(container);
  const read = (name: string): number | undefined => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    x: read('--mejiro-page-pad-x'),
    y: read('--mejiro-page-pad-y'),
    bottom: read('--mejiro-page-pad-bottom'),
  };
}
