import { MejiroBrowser, verticalLineWidth } from '../browser/integration.js';
import type { CharMeasurer } from '../browser/measure.js';
import { deriveRubyFont } from '../browser/measure.js';
import type { FontFamily, InlineAnnotation, InlineRubyAnnotation } from '../browser/types.js';
import { toFontSpec } from '../browser/types.js';
import { type ManuscriptDialect, parseManuscript } from '../manuscript.js';
import { normalizeAnnotatedText } from '../normalize.js';
import type { HeadingStyle } from '../render/measures.js';
import type { RenderEntry } from '../render/types.js';
import type { RubyAnnotation } from '../ruby.js';
import type { TcyAnnotation } from '../tcy.js';
import { buildTcyAnnotations } from '../tcy.js';
import { toCodepoints } from '../text.js';
import type { CachedParagraph, LayoutConfig } from './chapter-layout.js';
import { ChapterLayout } from './chapter-layout.js';
import { DEFAULT_PAGE_GEOMETRY, DEFAULT_PAGE_PADDING } from './constants.js';
import type { ChapterLayoutSnapshot } from './snapshot.js';
import type { BookOptions, BookParagraph, ComputePageSizeOptions, PageSize } from './types.js';

/**
 * Constructor options for {@link MejiroBook} — {@link BookOptions} plus the
 * browser-integration switches a book owns on the caller's behalf.
 */
export interface MejiroBookOptions extends BookOptions {
  /**
   * When true, layout throws if the requested font family measures exactly
   * like the host's default font, which is how a silent fallback presents
   * itself. @defaultValue false
   */
  strictFontCheck?: boolean;
}

/** Manuscript chapter input accepted by {@link MejiroBook.layoutManuscript}. */
export interface ManuscriptChapter {
  /** Optional id used as the key in the returned map. */
  id?: string;
  /** Chapter title — emitted as an `h1` paragraph at the top of the layout. */
  title: string;
  /** Raw manuscript body. Blank lines separate paragraphs. */
  body: string;
}

/** Options for {@link MejiroBook.layoutManuscript}. */
export interface LayoutManuscriptOptions {
  /**
   * Chapters to lay out. Laid out sequentially, and keyed in the returned map
   * by `id` — or by `chapter-<position>` when a chapter carries no id, so
   * duplicate or missing ids collapse entries.
   */
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
  const blocks = chapter.body
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t　]*\n+/u)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);
  for (const block of blocks) {
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
  mode: 'strict' | 'loose';
  enableHanging: boolean;
  headingStyles?: Record<number, HeadingStyle>;
  headingScale: number;
}

function resolveScale(
  level: number | undefined,
  opts: { headingStyles?: Record<number, HeadingStyle>; headingScale: number },
): number {
  if (level == null) return 1;
  return opts.headingStyles?.[level]?.scale ?? opts.headingScale;
}

function paragraphIsHeading(p: Pick<BookParagraph, 'headingLevel' | 'kind'>): boolean {
  return p.headingLevel != null || p.kind === 'heading';
}

function paragraphHeadingScale(
  p: Pick<CachedParagraph, 'headingLevel' | 'isHeading'>,
  opts: InternalOptions,
): number {
  if (p.headingLevel != null) return resolveScale(p.headingLevel, opts);
  return p.isHeading === true ? opts.headingScale : 1;
}

function buildLayoutRubyAnnotations(
  annotations: readonly InlineAnnotation[] | undefined,
  rubyFontSpec: string,
  measurer: CharMeasurer,
): RubyAnnotation[] | undefined {
  if (!annotations?.length) return undefined;
  const rubies = annotations.filter((a): a is InlineRubyAnnotation => a.kind === 'ruby');
  if (!rubies.length) return undefined;
  return rubies.map((ann) => {
    const rubyText = toCodepoints(ann.rubyText);
    return {
      startIndex: ann.startIndex,
      endIndex: ann.endIndex,
      rubyText,
      rubyAdvances: measurer.measureAll(rubyFontSpec, rubyText),
      type: ann.type,
      jukugoSplitPoints: ann.jukugoSplitPoints,
    };
  });
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
 * });
 *
 * book.setPageSize({ pageWidth: 400, lineWidth: 600 });
 *
 * const layout = await book.layoutChapter(chapter);
 * const spread = layout.getSpread(0);
 * // render spread.right and spread.left
 * ```
 */
export class MejiroBook {
  private opts: InternalOptions;
  private size: Required<PageSize> | null = null;
  private browser: MejiroBrowser;
  // Share the browser's measurer so MejiroBook's caching and propagation
  // touch the same WidthCache instance the browser populates during initial
  // layout. Splitting these into two CharMeasurers used to silently double
  // up the cache.
  private get measurer(): CharMeasurer {
    return this.browser.getMeasurer();
  }
  // WeakRef tracking lets the caller drop a layout without us holding it
  // alive. `setOptions` walks the set on each call and prunes refs whose
  // referent has been collected.
  private layouts = new Set<WeakRef<ChapterLayout>>();
  // Desired options of the in-flight measurement, staged until the font has
  // loaded so a failed load never becomes observable through `getOptions`.
  private pendingOpts: InternalOptions | null = null;
  // Monotonic counter used to abandon a `setOptions` call that a later one
  // superseded while its font was still loading.
  private optionsGeneration = 0;

  /**
   * Records the typographic options and creates the browser-side measurer.
   * Nothing is measured or loaded yet: fonts are loaded lazily on the first
   * layout, and page geometry is still unset, so call
   * {@link MejiroBook.setPageSize} (or {@link MejiroBook.computePageSize})
   * before laying out a chapter — otherwise `layoutChapter` throws.
   *
   * @param options - Typography plus the optional `strictFontCheck` guard,
   *   which is forwarded to the measurer and cannot be changed afterwards.
   */
  constructor(options: MejiroBookOptions) {
    this.browser = new MejiroBrowser({ strictFontCheck: options.strictFontCheck });
    this.opts = {
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      lineSpacing: options.lineSpacing ?? 1.8,
      mode: options.mode ?? 'strict',
      enableHanging: options.enableHanging ?? true,
      headingStyles: options.headingStyles,
      headingScale: options.headingScale ?? 1.4,
    };
  }

  /** Returns a snapshot of the current options. */
  getOptions(): Readonly<
    Required<
      Pick<
        BookOptions,
        'fontFamily' | 'fontSize' | 'lineSpacing' | 'mode' | 'enableHanging' | 'headingScale'
      >
    > &
      Pick<BookOptions, 'headingStyles'>
  > {
    return { ...this.opts };
  }

  /**
   * Updates book options and propagates the change to every live
   * {@link ChapterLayout} produced by this book.
   *
   * Changes that need no re-measurement (`lineSpacing` / `mode` /
   * `enableHanging`) are applied synchronously and the returned promise is
   * already resolved. Font family / size / heading scale changes require
   * re-measurement: the new values are staged and only become visible to
   * {@link getOptions} once the font has loaded, so every live layout always
   * holds advances measured with the font recorded in its own config.
   *
   * Overlapping calls converge on the last one — an earlier call whose font is
   * still loading resolves without overwriting the newer options.
   *
   * @throws If the font of a staged change fails to load. The rejection leaves
   *   the previously applied options in place.
   */
  setOptions(options: Partial<BookOptions>): Promise<void> {
    // Stack the patch on the in-flight request when there is one, so a change
    // that is still loading is not silently dropped by the next call.
    const next: InternalOptions = { ...(this.pendingOpts ?? this.opts) };
    if (options.fontFamily != null) next.fontFamily = options.fontFamily;
    if (options.fontSize != null) next.fontSize = options.fontSize;
    if (options.lineSpacing != null) next.lineSpacing = options.lineSpacing;
    if (options.mode != null) next.mode = options.mode;
    if (options.enableHanging != null) next.enableHanging = options.enableHanging;
    if (options.headingStyles !== undefined) next.headingStyles = options.headingStyles;
    if (options.headingScale != null) next.headingScale = options.headingScale;

    const needsMeasurement =
      next.fontFamily !== this.opts.fontFamily ||
      next.fontSize !== this.opts.fontSize ||
      next.headingStyles !== this.opts.headingStyles ||
      next.headingScale !== this.opts.headingScale;

    const generation = ++this.optionsGeneration;
    if (!needsMeasurement) {
      this.pendingOpts = null;
      this.opts = next;
      this.applyConfigToLayouts();
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
    // A later setOptions has taken over; committing here would pair its config
    // with advances measured for this (now stale) font spec.
    if (this.optionsGeneration !== generation) return;
    this.pendingOpts = null;
    this.opts = next;
    this.remeasureLayouts();
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
    for (const layout of this.liveLayouts()) layout.applyConfig(cfg);
  }

  /**
   * Re-measures every live layout against the committed options. Runs to
   * completion synchronously so no other call can interleave between the
   * advances and the config they belong to.
   */
  private remeasureLayouts(): void {
    const { fontFamily, fontSize } = this.opts;
    const baseFontSpec = toFontSpec(fontFamily, fontSize);
    const cfg = this.layoutConfigSnapshot();

    for (const layout of this.liveLayouts()) {
      const cached = layout.getCachedParagraphs();
      for (const para of cached) {
        const scale = paragraphHeadingScale(para, this.opts);
        const pFontSize =
          para.isHeading === true || para.headingLevel != null
            ? Math.round(fontSize * scale)
            : fontSize;
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
      layout.applyConfig(cfg, { rebreak: false });
      layout.recomputeAfterMeasurement();
    }
  }

  private layoutConfigSnapshot(): LayoutConfig {
    return {
      fontSize: this.opts.fontSize,
      lineSpacing: this.opts.lineSpacing,
      headingStyles: this.opts.headingStyles,
      headingScale: this.opts.headingScale,
      mode: this.opts.mode,
      enableHanging: this.opts.enableHanging,
    };
  }

  /**
   * Sets the page geometry used by subsequent {@link layoutChapter} calls.
   * Must be called before `layoutChapter`.
   */
  setPageSize(size: PageSize): void {
    this.size = {
      pageWidth: size.pageWidth,
      lineWidth: size.lineWidth,
      pagePaddingX: size.pagePaddingX ?? 0,
      pagePaddingY: size.pagePaddingY ?? 0,
    };
  }

  /**
   * Computes page dimensions from a container element and applies them
   * via {@link setPageSize}.
   *
   * Defaults to a 1.45 aspect ratio, page width minimums of 280×400 px,
   * a 780 px height ceiling, a 56 px header reservation, and a 48 px
   * gutter reservation. All of these are overridable via the second
   * argument; see {@link ComputePageSizeOptions}.
   *
   * @param container - DOM element representing the reading surface.
   * @param options - Page geometry and padding overrides. Defaults to
   *   {@link DEFAULT_PAGE_GEOMETRY} + {@link DEFAULT_PAGE_PADDING}.
   * @returns Computed page width, page height, and content height.
   */
  computePageSize(
    container: HTMLElement,
    options?: ComputePageSizeOptions,
  ): { pageWidth: number; pageHeight: number; contentHeight: number } {
    const padX = options?.padding?.x ?? DEFAULT_PAGE_PADDING.x;
    const padY = options?.padding?.y ?? DEFAULT_PAGE_PADDING.y;
    const padBottom = options?.padding?.bottom ?? DEFAULT_PAGE_PADDING.bottom;
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

    const contentHeight = h - padY - padBottom;
    const lineWidth = verticalLineWidth(contentHeight, this.opts.fontSize);

    this.setPageSize({
      pageWidth: w,
      lineWidth,
      pagePaddingX: padX,
      pagePaddingY: padY,
    });

    return { pageWidth: w, pageHeight: h, contentHeight };
  }

  /**
   * Lays out a chapter and returns a {@link ChapterLayout} for pagination and rendering.
   *
   * The chapter object is compatible with `EpubChapter` from `@libraz/mejiro/epub`.
   * Font loading and character measurement are handled automatically.
   *
   * The page geometry and options in effect when the call starts are captured
   * up front, so a concurrent {@link setPageSize} / {@link setOptions} cannot
   * leave the returned layout holding geometry its break points were not
   * computed for.
   *
   * @param chapter - Chapter with paragraphs to lay out.
   * @returns A layout object for retrieving pages and managing image exclusions.
   * @throws If {@link setPageSize} has not been called.
   */
  async layoutChapter(chapter: { paragraphs: readonly BookParagraph[] }): Promise<ChapterLayout> {
    if (!this.size) throw new Error('Page size not set. Call setPageSize() first.');

    const opts: InternalOptions = { ...this.opts };
    const size: Required<PageSize> = { ...this.size };
    const { fontFamily, fontSize, lineSpacing, mode, enableHanging } = opts;
    const { lineWidth } = size;

    // Normalize once, up front: text and its annotations have to move to NFC
    // together, and the same pair has to feed the initial break, the render
    // entries and the cached paragraphs every later re-break works from.
    const normalized = chapter.paragraphs.map((p) => {
      const isHeading = paragraphIsHeading(p);
      const scale = paragraphHeadingScale({ headingLevel: p.headingLevel, isHeading }, opts);
      return {
        ...normalizeAnnotatedText(p.text, p.inlineAnnotations ?? []),
        isHeading,
        paragraphFontSize: isHeading ? Math.round(fontSize * scale) : fontSize,
      };
    });

    // Initial layout via MejiroBrowser (handles font loading + ruby)
    const result = await this.browser.layoutChapter({
      paragraphs: normalized.map((p) => ({
        text: p.text,
        inlineAnnotations: p.inlineAnnotations.length ? p.inlineAnnotations : undefined,
        fontSize: p.isHeading ? p.paragraphFontSize : undefined,
      })),
      fontFamily,
      fontSize,
      lineWidth,
      mode,
      enableHanging,
    });

    // Build render entries from initial layout results
    const renderEntries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
      chars: result.paragraphs[i].chars,
      breakPoints: result.paragraphs[i].breakResult.breakPoints,
      inlineAnnotations: normalized[i].inlineAnnotations,
      isHeading: normalized[i].isHeading,
      headingLevel: p.headingLevel,
      kind: p.kind,
    }));

    // Cache paragraph data for re-layout on resize/exclusion
    const baseFontSpec = toFontSpec(fontFamily, fontSize);
    const cached: CachedParagraph[] = chapter.paragraphs.map((p, i) => {
      const { text, inlineAnnotations, isHeading, paragraphFontSize } = normalized[i];
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
        isHeading,
        headingLevel: p.headingLevel,
      };
    });

    const config: LayoutConfig = {
      fontSize,
      lineSpacing,
      headingStyles: opts.headingStyles,
      headingScale: opts.headingScale,
      mode,
      enableHanging,
    };

    const layout = new ChapterLayout(cached, renderEntries, config, size);
    this.layouts.add(new WeakRef(layout));
    return layout;
  }

  /**
   * Lays out one or more manuscript chapters directly, skipping the EPUB ZIP
   * round-trip used by `MejiroEditor` / `EpubProject.export`. Intended for
   * live preview in manuscript editors.
   *
   * Each chapter body is split into paragraphs on blank lines and run through
   * {@link parseManuscript} so the renderer sees the same `InlineAnnotation`s
   * an exported EPUB would carry.
   *
   * @returns A map keyed by `chapter.id` (or the array index when missing).
   */
  async layoutManuscript(options: LayoutManuscriptOptions): Promise<Map<string, ChapterLayout>> {
    const dialect = options.dialect ?? 'mejiro';
    const result = new Map<string, ChapterLayout>();
    let i = 0;
    for (const chapter of options.chapters) {
      const paragraphs = manuscriptChapterToParagraphs(chapter, dialect);
      const layout = await this.layoutChapter({ paragraphs });
      result.set(chapter.id ?? `chapter-${i + 1}`, layout);
      i++;
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
   * not this book's current options. Calling {@link MejiroBook.setOptions}
   * after restore propagates new font / size values which will trigger a
   * full re-measure (the measurer rebuilds advances from the live font).
   *
   * @param snapshot - Value previously returned by `layout.snapshot()`.
   * @returns A {@link ChapterLayout} positioned exactly as it was at snapshot time.
   */
  layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout {
    if (snapshot.version !== 1) {
      throw new Error(`Unsupported ChapterLayoutSnapshot version: ${snapshot.version}`);
    }
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
          ...(r.type ? { type: r.type } : {}),
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
        ...(p.kind != null ? { kind: p.kind } : {}),
        ...(p.isHeading === true ? { isHeading: true } : {}),
        ...(p.headingLevel != null ? { headingLevel: p.headingLevel } : {}),
      };
    });
    const entries: RenderEntry[] = snapshot.paragraphs.map((p, i) => ({
      chars: cached[i].chars,
      breakPoints: new Uint32Array(p.breakPoints),
      inlineAnnotations: p.inlineAnnotations,
      ...(p.kind != null ? { kind: p.kind } : {}),
      ...(p.isHeading === true ? { isHeading: true } : {}),
      ...(p.headingLevel != null ? { headingLevel: p.headingLevel } : {}),
    }));
    const config: LayoutConfig = {
      fontSize: snapshot.config.fontSize,
      lineSpacing: snapshot.config.lineSpacing,
      mode: snapshot.config.mode,
      enableHanging: snapshot.config.enableHanging,
      headingScale: snapshot.config.headingScale,
      ...(snapshot.config.headingStyles ? { headingStyles: snapshot.config.headingStyles } : {}),
    };
    const layout = new ChapterLayout(cached, entries, config, { ...snapshot.size });
    for (const spread of snapshot.images ?? []) {
      layout.setImages(spread.spreadIndex, spread.images);
    }
    this.layouts.add(new WeakRef(layout));
    return layout;
  }

  /** Clears the character width measurement cache. */
  clearCache(fontKey?: string): void {
    this.browser.clearCache(fontKey);
  }

  /**
   * Returns the current measurement cache size.
   * Useful for capacity monitoring across long reader sessions.
   *
   * @returns Number of font specs cached and the total number of codepoints
   *   measured across all fonts.
   */
  cacheStats(): { fonts: number; codepoints: number } {
    return this.browser.cacheStats();
  }
}
