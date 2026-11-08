import { MejiroError } from '../errors.js';
import { computeBreaks } from '../layout.js';
import { normalizeAnnotatedText } from '../normalize.js';
import type { RubyAnnotation } from '../ruby.js';
import type { TcyAnnotation } from '../tcy.js';
import { buildTcyAnnotations } from '../tcy.js';
import { toCodepoints } from '../text.js';
import type { BreakResult } from '../types.js';
import { FontLoader } from './font-loader.js';
import { CharMeasurer, deriveRubyFont } from './measure.js';
import type {
  ChapterLayoutOptions,
  FontFamily,
  InlineAnnotation,
  InlineRubyAnnotation,
  LayoutOptions,
  LayoutTextOptions,
  MejiroBrowserOptions,
  ParagraphLayoutResult,
  ParagraphsLayoutResult,
} from './types.js';
import { toFontSpec } from './types.js';
import type { WidthCacheStats } from './width-cache.js';

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
 * Checks a font family, naming the caller's mistake.
 *
 * @throws TypeError when `fontFamily` is missing or empty.
 */
function assertFontFamily(fontFamily: FontFamily | undefined): asserts fontFamily is FontFamily {
  const usable =
    (typeof fontFamily === 'string' || Array.isArray(fontFamily)) && fontFamily.length > 0;
  if (!usable) {
    throw new TypeError(
      'fontFamily must be a non-empty string or array; pass it to the call or to the MejiroBrowser constructor.',
    );
  }
}

/**
 * Checks a font size, naming the caller's mistake.
 *
 * @throws TypeError when `fontSize` is not a number.
 * @throws RangeError when `fontSize` is not a positive finite number.
 */
function assertFontSize(fontSize: number | undefined): asserts fontSize is number {
  if (typeof fontSize !== 'number') {
    throw new TypeError(
      'fontSize must be a number; pass it to the call or to the MejiroBrowser constructor.',
    );
  }
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new RangeError(`fontSize must be a positive finite number, got ${fontSize}.`);
  }
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
  const rubies = annotations.filter((a): a is InlineRubyAnnotation => a.type === 'ruby');
  return rubies.map((ann) => {
    const rubyCps = toCodepoints(ann.rubyText);
    const rubyAdvances = measurer.measureAll(rubyFontSpec, rubyCps);
    return {
      startIndex: ann.startIndex,
      endIndex: ann.endIndex,
      rubyText: rubyCps,
      rubyAdvances,
      rubyType: ann.rubyType,
      jukugoSplitPoints: ann.jukugoSplitPoints,
    };
  });
}

/**
 * Glyphs used to detect that a requested family silently resolved to a
 * fallback font. Latin letters carry family-specific metrics; full-width CJK
 * glyphs are one em in nearly every font and cannot discriminate.
 */
const FALLBACK_PROBE_TEXT = 'MiWg';

/** Family name no host can provide, so it always measures as the default font. */
const FALLBACK_SENTINEL_FAMILY = '"__mejiro_absent_family__"';

/**
 * Reports whether `fontSpec` measures exactly like a family that is
 * guaranteed to be missing — the observable signature of a silent fallback.
 *
 * Heuristic by nature: it catches the common case where the requested family
 * resolves to the host's default font, and stays silent when the family's own
 * CSS fallback list absorbs the miss.
 */
function measuresAsFallback(measurer: CharMeasurer, fontSpec: string, fontSize: number): boolean {
  const sentinel = `${fontSize}px ${FALLBACK_SENTINEL_FAMILY}`;
  if (fontSpec === sentinel) return false;
  for (const ch of FALLBACK_PROBE_TEXT) {
    const cp = ch.codePointAt(0) as number;
    if (measurer.measure(fontSpec, cp) !== measurer.measure(sentinel, cp)) return false;
  }
  return true;
}

/**
 * Waits for `fontSpec` to cover `text`. A font that cannot be confirmed loaded
 * is not an error here: layout proceeds with whatever the host resolves, and
 * only the `strictFontCheck` probe may reject it.
 *
 * @returns Whether the host confirmed the font loaded.
 */
async function tryLoad(loader: FontLoader, fontSpec: string, text?: string): Promise<boolean> {
  try {
    await loader.ensureLoaded(fontSpec, text);
    return true;
  } catch {
    return false;
  }
}

/** Concatenates every ruby reading so font readiness covers their ranges too. */
function rubyTextOf(annotations: readonly InlineAnnotation[]): string {
  let out = '';
  for (const ann of annotations) {
    if (ann.type === 'ruby') out += ann.rubyText;
  }
  return out;
}

/**
 * Standalone function to lay out text with a specified font.
 * Handles font loading, measurement, and line break computation in one call.
 *
 * Accepts the same fields as {@link MejiroBrowser.layout} and produces the same
 * {@link BreakResult} for them, except that `fontFamily` and `fontSize` are
 * required: there is no instance to inherit defaults from. Prefer
 * {@link MejiroBrowser} when laying out repeatedly, so the width cache and the
 * loaded-font set survive between calls.
 *
 * @param options - See {@link LayoutTextOptions}.
 * @throws TypeError when `fontFamily` is empty, or `kinsoku` is not a built-in mode.
 * @throws RangeError when `fontSize` is not a positive finite number, or
 *   `kinsoku` names an unknown mode.
 * @throws MejiroError `environment-unsupported` when no canvas is available to measure with.
 * @see {@link LayoutOptions}
 */
export async function layoutText(options: LayoutTextOptions): Promise<BreakResult> {
  assertFontFamily(options.fontFamily);
  assertFontSize(options.fontSize);
  const fontSpec = toFontSpec(options.fontFamily, options.fontSize);
  const { text, inlineAnnotations } = normalizeAnnotatedText(
    options.text,
    options.inlineAnnotations ?? [],
  );
  // One-shot loader: released before returning so the host keeps no reference.
  const loader = new FontLoader();
  let rubyFontSpec: string | undefined;
  try {
    await tryLoad(loader, fontSpec, text);
    if (inlineAnnotations.length) {
      rubyFontSpec = deriveRubyFont(options.fontFamily, options.fontSize);
      await tryLoad(loader, rubyFontSpec, rubyTextOf(inlineAnnotations));
    }
  } finally {
    loader.dispose();
  }

  const measurer = new CharMeasurer();
  const codepoints = toCodepoints(text);
  const advances = measurer.measureAll(fontSpec, codepoints);

  let rubyAnnotations: RubyAnnotation[] | undefined;
  let tcyAnnotations: TcyAnnotation[] | undefined;
  if (rubyFontSpec) {
    rubyAnnotations = buildRubyAnnotations(inlineAnnotations, rubyFontSpec, measurer);
    tcyAnnotations = buildTcyAnnotations(inlineAnnotations, options.fontSize);
  }

  return computeBreaks({
    text: codepoints,
    advances,
    lineWidth: options.lineWidth,
    kinsoku: options.kinsoku,
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

/** The measurer of each {@link MejiroBrowser}, reachable only through {@link measurerOf}. */
const measurers = new WeakMap<MejiroBrowser, CharMeasurer>();

/**
 * Returns the {@link CharMeasurer} a browser measures with, so the book layer can
 * share its width cache. Module-internal: not re-exported from the package.
 *
 * @internal
 */
export function measurerOf(browser: MejiroBrowser): CharMeasurer {
  const measurer = measurers.get(browser);
  if (!measurer) throw new TypeError('measurerOf: not a MejiroBrowser');
  return measurer;
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
   * @param options - Default font family / size used when a layout call omits
   *   them, the `strictFontCheck` guard and the `onFontsLoaded` hook. Captured
   *   at construction; layout calls override the defaults per call rather
   *   than mutating these.
   * @throws TypeError when `options.fontFamily` is given but empty.
   * @throws RangeError when `options.fontSize` is given but not a positive finite number.
   */
  constructor(options?: MejiroBrowserOptions) {
    this.options = options ?? {};
    if (this.options.fontFamily !== undefined) assertFontFamily(this.options.fontFamily);
    if (this.options.fontSize !== undefined) assertFontSize(this.options.fontSize);
    this.measurer = new CharMeasurer();
    measurers.set(this, this.measurer);
    this.fontLoader = new FontLoader({
      onFontsLoaded: () => {
        this.measurer.getCache().clear();
        this.options.onFontsLoaded?.();
      },
    });
  }

  /**
   * Releases the `document.fonts` subscription, so an instance the host no
   * longer uses can be collected together with its width cache. The instance
   * stays usable: the next layout subscribes again. Idempotent.
   */
  dispose(): void {
    this.fontLoader.dispose();
  }

  /**
   * Makes `fontFamily` at `fontSize` ready for measuring `text`, and under
   * `strictFontCheck` rejects it when it measures as a fallback. Every path
   * that measures with a font goes through here, so none can skip the check.
   */
  private async ensureFont(fontFamily: FontFamily, fontSize: number, text?: string): Promise<void> {
    const fontSpec = toFontSpec(fontFamily, fontSize);
    const loaded = await tryLoad(this.fontLoader, fontSpec, text);
    if (!this.options.strictFontCheck) return;
    // The probe glyphs may live in a subset `text` never requested. A family
    // that loaded for `text` but cannot supply them leaves the probe blind.
    if (loaded && !(await tryLoad(this.fontLoader, fontSpec, FALLBACK_PROBE_TEXT))) return;
    if (measuresAsFallback(this.measurer, fontSpec, fontSize)) {
      throw new MejiroError(
        'font-unavailable',
        `Font not available (possible fallback): ${fontSpec}`,
      );
    }
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
   * @throws TypeError when no font family (or an empty one) or no font size is
   *   given and no defaults were configured, or `kinsoku` is not a built-in mode.
   * @throws RangeError when the font size is not a positive finite number, or
   *   `kinsoku` names an unknown mode.
   * @throws MejiroError `font-unavailable` when `strictFontCheck` is enabled and
   *   the requested family measures like the host's default font, i.e. it
   *   silently fell back. Without `strictFontCheck`, a font that fails to load
   *   is measured as the host resolves it rather than rejected.
   * @throws MejiroError `environment-unsupported` when no canvas is available to measure with.
   * @see {@link layoutText} for the standalone form.
   */
  async layout(options: LayoutOptions): Promise<BreakResult> {
    const fontFamily = options.fontFamily ?? this.options.fontFamily;
    const fontSize = options.fontSize ?? this.options.fontSize;
    assertFontFamily(fontFamily);
    assertFontSize(fontSize);

    const fontSpec = toFontSpec(fontFamily, fontSize);
    const { text, inlineAnnotations } = normalizeAnnotatedText(
      options.text,
      options.inlineAnnotations ?? [],
    );
    await this.ensureFont(fontFamily, fontSize, text);

    const codepoints = toCodepoints(text);
    const advances = this.measurer.measureAll(fontSpec, codepoints);

    let rubyAnnotations: RubyAnnotation[] | undefined;
    let tcyAnnotations: TcyAnnotation[] | undefined;
    if (inlineAnnotations.length) {
      const rubyFontSpec = deriveRubyFont(fontFamily, fontSize);
      await tryLoad(this.fontLoader, rubyFontSpec, rubyTextOf(inlineAnnotations));
      rubyAnnotations = buildRubyAnnotations(inlineAnnotations, rubyFontSpec, this.measurer);
      tcyAnnotations = buildTcyAnnotations(inlineAnnotations, fontSize);
    }

    return computeBreaks({
      text: codepoints,
      advances,
      lineWidth: options.lineWidth,
      kinsoku: options.kinsoku,
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
   * @throws TypeError when no font family or size is given and no defaults were configured.
   * @throws RangeError when the font size is not a positive finite number.
   * @throws MejiroError `font-unavailable` when `strictFontCheck` is enabled and
   *   the family measures like the host's default font — the same check
   *   {@link MejiroBrowser.layout} runs.
   */
  async preloadFont(fontFamily?: FontFamily, fontSize?: number): Promise<void> {
    const family = fontFamily ?? this.options.fontFamily;
    const size = fontSize ?? this.options.fontSize;
    assertFontFamily(family);
    assertFontSize(size);
    await this.ensureFont(family, size);
  }

  /**
   * Lays out several paragraphs in one call.
   *
   * Each paragraph is measured and broken into lines. Paragraphs can
   * optionally override the font family and size (e.g. for headings).
   *
   * Paragraph text is normalized to NFC together with its annotations, so the
   * returned `chars` and the annotation indices address the same characters.
   *
   * @param options - Paragraphs, line width and the settings they share.
   * @returns Per-paragraph layout results with break points and character arrays.
   * @throws The same errors as {@link MejiroBrowser.layout}; the font is checked
   *   up front, so an empty paragraph list is rejected too.
   */
  async layoutParagraphs(options: ChapterLayoutOptions): Promise<ParagraphsLayoutResult> {
    const fontFamily = options.fontFamily ?? this.options.fontFamily;
    const fontSize = options.fontSize ?? this.options.fontSize;
    assertFontFamily(fontFamily);
    assertFontSize(fontSize);
    const { paragraphs: inputs, lineWidth, kinsoku, enableHanging, breakCost } = options;

    const results: ParagraphLayoutResult[] = [];
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
        kinsoku,
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
   * Uses the instance's default font size unless overridden.
   *
   * @param containerHeight - Available height in pixels.
   * @param fontSize - Font size override in pixels.
   * @returns Effective line width for the line breaking algorithm.
   * @throws TypeError when no font size is given and no default was configured.
   * @throws RangeError when the font size is not a positive finite number.
   */
  verticalLineWidth(containerHeight: number, fontSize?: number): number {
    const size = fontSize ?? this.options.fontSize;
    assertFontSize(size);
    return verticalLineWidth(containerHeight, size);
  }

  /**
   * Clears the width measurement cache.
   * @param fontSpec - If provided, clears only entries for this font spec.
   */
  clearCache(fontSpec?: string): void {
    this.measurer.getCache().clear(fontSpec);
  }

  /**
   * Returns the current measurement cache size.
   * @returns Number of font specs cached and the total number of codepoints
   *   measured across all fonts.
   */
  cacheStats(): WidthCacheStats {
    return this.measurer.getCache().stats();
  }
}
