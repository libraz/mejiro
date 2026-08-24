import { computeBreaks } from '../layout.js';
import { normalizeAnnotatedText } from '../normalize.js';
import type { RubyAnnotation } from '../ruby.js';
import type { TcyAnnotation } from '../tcy.js';
import { buildTcyAnnotations } from '../tcy.js';
import { toCodepoints } from '../text.js';
import type { BreakCostOptions, BreakResult, TypographyHints } from '../types.js';
import { FontLoader } from './font-loader.js';
import { CharMeasurer, deriveRubyFont } from './measure.js';
import type {
  ChapterLayoutOptions,
  ChapterLayoutResult,
  FontFamily,
  InlineAnnotation,
  InlineRubyAnnotation,
  LayoutOptions,
  MejiroBrowserOptions,
} from './types.js';
import { toFontSpec } from './types.js';

/**
 * Safety margin ratio for vertical line width.
 *
 * CSS vertical-rl text advance can be slightly larger than
 * Canvas.measureText horizontal advance, accumulating over
 * a full column of ~40 characters. This ratio (applied to
 * fontSize) compensates for the difference.
 */
const VERTICAL_SAFETY_RATIO = 0.5;

/**
 * Computes the effective line width for vertical text layout.
 *
 * In CSS `writing-mode: vertical-rl`, each column's height is the
 * inline dimension. Canvas.measureText measures horizontal advance,
 * which can be slightly smaller than the vertical advance used by
 * the browser. This function applies a safety margin to prevent
 * columns from overflowing.
 *
 * @param containerHeight - Available height in pixels (CSS inline dimension).
 * @param fontSize - Base font size in pixels.
 * @returns Effective line width for the line breaking algorithm.
 */
export function verticalLineWidth(containerHeight: number, fontSize: number): number {
  return containerHeight - fontSize * VERTICAL_SAFETY_RATIO;
}

/**
 * Filters inline annotations to ruby variants and measures their advance widths.
 *
 * Tate-chu-yoko takes the separate {@link buildTcyAnnotations} path; the
 * remaining variants (emphasis, em/strong, link, footnote) are render-only and
 * reach the line breaker not at all.
 */
function buildRubyAnnotations(
  annotations: readonly InlineAnnotation[],
  rubyFontSpec: string,
  measurer: CharMeasurer,
): RubyAnnotation[] {
  const rubies = annotations.filter((a): a is InlineRubyAnnotation => a.kind === 'ruby');
  return rubies.map((ann) => {
    const rubyCps = toCodepoints(ann.rubyText);
    const rubyAdvances = measurer.measureAll(rubyFontSpec, rubyCps);
    return {
      startIndex: ann.startIndex,
      endIndex: ann.endIndex,
      rubyText: rubyCps,
      rubyAdvances,
      type: ann.type,
      jukugoSplitPoints: ann.jukugoSplitPoints,
    };
  });
}

/**
 * Glyphs used to detect that a requested family silently resolved to a
 * fallback font. Latin letters carry family-specific metrics; full-width CJK
 * glyphs are one em in nearly every font and cannot discriminate.
 */
const FALLBACK_PROBE_CODEPOINTS = [0x4d, 0x69, 0x57, 0x67]; // M i W g

/** Family name no host can provide, so it always measures as the default font. */
const FALLBACK_SENTINEL_FAMILY = '"__mejiro_absent_family__"';

/**
 * Reports whether `fontFamily` measures exactly like a family that is
 * guaranteed to be missing — the observable signature of a silent fallback.
 *
 * Heuristic by nature: it catches the common case where the requested family
 * resolves to the host's default font, and stays silent when the family's own
 * CSS fallback list absorbs the miss.
 */
function measuresAsFallback(
  measurer: CharMeasurer,
  fontFamily: FontFamily,
  fontSize: number,
): boolean {
  const wanted = toFontSpec(fontFamily, fontSize);
  const sentinel = `${fontSize}px ${FALLBACK_SENTINEL_FAMILY}`;
  if (wanted === sentinel) return false;
  return FALLBACK_PROBE_CODEPOINTS.every(
    (cp) => measurer.measure(wanted, cp) === measurer.measure(sentinel, cp),
  );
}

/** Concatenates every ruby reading so font readiness covers their ranges too. */
function rubyTextOf(annotations: readonly InlineAnnotation[]): string {
  let out = '';
  for (const ann of annotations) {
    if (ann.kind === 'ruby') out += ann.rubyText;
  }
  return out;
}

/**
 * Standalone function to lay out text with a specified font.
 * Handles font loading, measurement, and line break computation in one call.
 *
 * Accepts the same fields as {@link MejiroBrowser.layout} and produces the same
 * {@link BreakResult} for them, except that `fontFamily` and `fontSize` are
 * required: there is no instance to inherit fixed values from. Prefer
 * {@link MejiroBrowser} when laying out repeatedly, so the width cache and the
 * loaded-font set survive between calls.
 */
export async function layoutText(options: {
  text: string;
  fontFamily: FontFamily;
  fontSize: number;
  lineWidth: number;
  mode?: 'strict' | 'loose';
  enableHanging?: boolean;
  inlineAnnotations?: readonly InlineAnnotation[];
  /**
   * Token boundary indices for morphological-aware line breaking.
   * @see {@link LayoutOptions.tokenBoundaries}
   */
  tokenBoundaries?: Uint32Array | readonly number[];
  /**
   * Line breaking hints derived from a morphological analysis of `text`.
   * @see {@link LayoutOptions.hints}
   */
  hints?: TypographyHints;
  /** Weights for the penalty search. @see {@link LayoutOptions.breakCost} */
  breakCost?: BreakCostOptions;
}): Promise<BreakResult> {
  const fontSpec = toFontSpec(options.fontFamily, options.fontSize);
  const loader = new FontLoader();
  const { text, inlineAnnotations } = normalizeAnnotatedText(
    options.text,
    options.inlineAnnotations ?? [],
  );
  await loader.ensureLoaded(fontSpec, text);

  const measurer = new CharMeasurer();
  const codepoints = toCodepoints(text);
  const advances = measurer.measureAll(fontSpec, codepoints);

  let rubyAnnotations: RubyAnnotation[] | undefined;
  let tcyAnnotations: TcyAnnotation[] | undefined;
  if (inlineAnnotations.length) {
    const rubyFontSpec = deriveRubyFont(options.fontFamily, options.fontSize);
    await loader.ensureLoaded(rubyFontSpec, rubyTextOf(inlineAnnotations));
    rubyAnnotations = buildRubyAnnotations(inlineAnnotations, rubyFontSpec, measurer);
    tcyAnnotations = buildTcyAnnotations(inlineAnnotations, options.fontSize);
  }

  return computeBreaks({
    text: codepoints,
    advances,
    lineWidth: options.lineWidth,
    mode: options.mode,
    enableHanging: options.enableHanging,
    rubyAnnotations,
    tcyAnnotations,
    tokenBoundaries: options.tokenBoundaries,
    // Hint clusters go in as the *base* cluster IDs. `computeBreaks` hands them
    // to the tate-chu-yoko preprocessor and then to the ruby one, each of which
    // overwrites the IDs inside its own span, so an annotated run wins over a
    // hint cluster covering the same range.
    clusterIds: options.hints?.clusterIds,
    breakPenalties: options.hints?.breakPenalties,
    breakCost: options.breakCost,
  });
}

/**
 * Main browser integration class.
 * Manages font loading, width caching, and layout computation.
 */
export class MejiroBrowser {
  private fontLoader: FontLoader;
  private measurer: CharMeasurer;
  private options: MejiroBrowserOptions;

  /**
   * Wires a fresh measurer to a font loader that clears the width cache on
   * every `loadingdone`, so widths measured against a fallback face are
   * discarded once the real font arrives.
   *
   * @param options - Fixed font family / size used when a layout call omits
   *   them, plus the `strictFontCheck` guard. Captured at construction; layout
   *   calls override the fixed values per call rather than mutating these.
   */
  constructor(options?: MejiroBrowserOptions) {
    this.options = options ?? {};
    this.measurer = new CharMeasurer();
    this.fontLoader = new FontLoader({
      onFontsLoaded: () => {
        this.measurer.getCache().clear();
      },
    });
  }

  /**
   * Computes line breaks for the given text and font.
   *
   * The text is normalized to NFC and the supplied `inlineAnnotations` move
   * with it, so a decomposed `が` and a precomposed `が` produce the same
   * break points and keep every annotation over the character it was authored
   * for. Annotations left covering nothing by the composition are dropped.
   *
   * @param options - Layout options including text, font, and line width.
   * @throws If no font family or font size is specified and no fixed values were configured.
   * @throws If `strictFontCheck` is enabled and the requested family measures
   *   like the host's default font, i.e. it silently fell back.
   */
  async layout(options: LayoutOptions): Promise<BreakResult> {
    const fontFamily = options.fontFamily ?? this.options.fixedFontFamily;
    const fontSize = options.fontSize ?? this.options.fixedFontSize;
    if (!fontFamily) throw new Error('fontFamily must be specified');
    if (!fontSize) throw new Error('fontSize must be specified');

    const fontSpec = toFontSpec(fontFamily, fontSize);
    const { text, inlineAnnotations } = normalizeAnnotatedText(
      options.text,
      options.inlineAnnotations ?? [],
    );
    await this.fontLoader.ensureLoaded(fontSpec, text);

    if (this.options.strictFontCheck && measuresAsFallback(this.measurer, fontFamily, fontSize)) {
      throw new Error(`Font not available (possible fallback): ${fontSpec}`);
    }

    const codepoints = toCodepoints(text);
    const advances = this.measurer.measureAll(fontSpec, codepoints);

    let rubyAnnotations: RubyAnnotation[] | undefined;
    let tcyAnnotations: TcyAnnotation[] | undefined;
    if (inlineAnnotations.length) {
      const rubyFontSpec = deriveRubyFont(fontFamily, fontSize);
      await this.fontLoader.ensureLoaded(rubyFontSpec, rubyTextOf(inlineAnnotations));
      rubyAnnotations = buildRubyAnnotations(inlineAnnotations, rubyFontSpec, this.measurer);
      tcyAnnotations = buildTcyAnnotations(inlineAnnotations, fontSize);
    }

    return computeBreaks({
      text: codepoints,
      advances,
      lineWidth: options.lineWidth,
      mode: options.mode,
      enableHanging: options.enableHanging,
      rubyAnnotations,
      tcyAnnotations,
      tokenBoundaries: options.tokenBoundaries,
      // Hint clusters go in as the *base* cluster IDs. `computeBreaks` hands
      // them to the tate-chu-yoko preprocessor and then to the ruby one, each
      // of which overwrites the IDs inside its own span, so an annotated run
      // wins over a hint cluster covering the same range.
      clusterIds: options.hints?.clusterIds,
      breakPenalties: options.hints?.breakPenalties,
      breakCost: options.breakCost,
    });
  }

  /**
   * Preloads a font so it is available for subsequent layout calls.
   * @param fontFamily - CSS font family to preload (string or array).
   * @param fontSize - Font size in pixels (used for the font loading check).
   */
  async preloadFont(fontFamily?: FontFamily, fontSize?: number): Promise<void> {
    const family = fontFamily ?? this.options.fixedFontFamily;
    const size = fontSize ?? this.options.fixedFontSize;
    if (!family) throw new Error('fontFamily must be specified');
    if (!size) throw new Error('fontSize must be specified');
    await this.fontLoader.ensureLoaded(toFontSpec(family, size));
  }

  /**
   * Lays out an entire chapter (multiple paragraphs) in one call.
   *
   * Each paragraph is measured and broken into lines. Paragraphs can
   * optionally override the font family and size (e.g. for headings).
   *
   * Paragraph text is normalized to NFC together with its annotations, so the
   * returned `chars` and the annotation indices address the same characters.
   *
   * @param options - Chapter layout options.
   * @returns Per-paragraph layout results with break points and character arrays.
   */
  async layoutChapter(options: ChapterLayoutOptions): Promise<ChapterLayoutResult> {
    const fontFamily = options.fontFamily ?? this.options.fixedFontFamily;
    const fontSize = options.fontSize ?? this.options.fixedFontSize;
    if (!fontFamily) throw new Error('fontFamily must be specified');
    if (!fontSize) throw new Error('fontSize must be specified');
    const { paragraphs: inputs, lineWidth, mode, enableHanging, breakCost } = options;

    const results: ChapterLayoutResult['paragraphs'] = [];
    for (const para of inputs) {
      // Normalize here rather than leaving it to `layout()`, so the `chars` we
      // hand back are the same NFC characters the annotations now address.
      const { text, inlineAnnotations } = normalizeAnnotatedText(
        para.text,
        para.inlineAnnotations ?? [],
      );
      const breakResult = await this.layout({
        text,
        fontFamily: para.fontFamily ?? fontFamily,
        fontSize: para.fontSize ?? fontSize,
        lineWidth,
        mode,
        enableHanging,
        inlineAnnotations: inlineAnnotations.length ? inlineAnnotations : undefined,
        tokenBoundaries: para.tokenBoundaries,
        hints: para.hints,
        breakCost,
      });
      results.push({ breakResult, chars: [...text] });
    }

    return { paragraphs: results };
  }

  /**
   * Computes the effective line width for vertical text layout.
   * Uses the instance's fixedFontSize unless overridden.
   *
   * @param containerHeight - Available height in pixels.
   * @param fontSize - Font size override in pixels.
   * @returns Effective line width for the line breaking algorithm.
   */
  verticalLineWidth(containerHeight: number, fontSize?: number): number {
    const size = fontSize ?? this.options.fixedFontSize;
    if (!size) throw new Error('fontSize must be specified');
    return verticalLineWidth(containerHeight, size);
  }

  /**
   * Clears the width measurement cache.
   * @param fontKey - If provided, clears only entries for this font.
   */
  clearCache(fontKey?: string): void {
    this.measurer.getCache().clear(fontKey);
  }

  /**
   * Returns the current measurement cache size.
   * @returns Number of font specs cached and the total number of codepoints
   *   measured across all fonts.
   */
  cacheStats(): { fonts: number; codepoints: number } {
    return this.measurer.getCache().stats();
  }

  /** @internal Returns the underlying {@link CharMeasurer} so the higher-level
   * `MejiroBook` can share it with the layout pipeline. */
  getMeasurer(): CharMeasurer {
    return this.measurer;
  }
}
