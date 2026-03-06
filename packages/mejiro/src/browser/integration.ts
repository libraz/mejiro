import { computeBreaks } from '../layout.js';
import type { RubyAnnotation } from '../ruby.js';
import type { BreakResult } from '../types.js';
import { FontLoader } from './font-loader.js';
import { CharMeasurer, deriveRubyFont } from './measure.js';
import type {
  ChapterLayoutOptions,
  ChapterLayoutResult,
  LayoutOptions,
  MejiroBrowserOptions,
  RubyInputAnnotation,
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

/** Converts a string to a Uint32Array of Unicode codepoints. */
function textToCodepoints(text: string): Uint32Array {
  const codepoints: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) codepoints.push(cp);
  }
  return new Uint32Array(codepoints);
}

/**
 * Converts string-based ruby annotations to core RubyAnnotation format
 * by measuring ruby text advances.
 */
function buildRubyAnnotations(
  annotations: RubyInputAnnotation[],
  rubyFontSpec: string,
  measurer: CharMeasurer,
): RubyAnnotation[] {
  return annotations.map((ann) => {
    const rubyCps = textToCodepoints(ann.rubyText);
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
 * Standalone function to lay out text with a specified font.
 * Handles font loading, measurement, and line break computation in one call.
 */
export async function layoutText(options: {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineWidth: number;
  mode?: 'strict' | 'loose';
  enableHanging?: boolean;
  rubyAnnotations?: RubyInputAnnotation[];
}): Promise<BreakResult> {
  const fontSpec = toFontSpec(options.fontFamily, options.fontSize);
  const loader = new FontLoader();
  await loader.ensureLoaded(fontSpec);

  const measurer = new CharMeasurer();
  const codepoints = textToCodepoints(options.text);
  const advances = measurer.measureAll(fontSpec, codepoints);

  let rubyAnnotations: RubyAnnotation[] | undefined;
  if (options.rubyAnnotations?.length) {
    const rubyFontSpec = deriveRubyFont(options.fontFamily, options.fontSize);
    await loader.ensureLoaded(rubyFontSpec);
    rubyAnnotations = buildRubyAnnotations(options.rubyAnnotations, rubyFontSpec, measurer);
  }

  return computeBreaks({
    text: codepoints,
    advances,
    lineWidth: options.lineWidth,
    mode: options.mode,
    enableHanging: options.enableHanging,
    rubyAnnotations,
  });
}

/**
 * Main browser integration class.
 * Manages font loading, width caching, and layout computation.
 */
export class MejiroBrowser {
  private fontLoader = new FontLoader();
  private measurer: CharMeasurer;
  private options: MejiroBrowserOptions;

  constructor(options?: MejiroBrowserOptions) {
    this.options = options ?? {};
    this.measurer = new CharMeasurer();
  }

  /**
   * Computes line breaks for the given text and font.
   * @param options - Layout options including text, font, and line width.
   * @throws If no font family or font size is specified and no fixed values were configured.
   */
  async layout(options: LayoutOptions): Promise<BreakResult> {
    const fontFamily = options.fontFamily ?? this.options.fixedFontFamily;
    const fontSize = options.fontSize ?? this.options.fixedFontSize;
    if (!fontFamily) throw new Error('fontFamily must be specified');
    if (!fontSize) throw new Error('fontSize must be specified');

    const fontSpec = toFontSpec(fontFamily, fontSize);
    await this.fontLoader.ensureLoaded(fontSpec);

    if (this.options.strictFontCheck && !document.fonts.check(fontSpec)) {
      throw new Error(`Font not available (possible fallback): ${fontSpec}`);
    }

    const codepoints = textToCodepoints(options.text);
    const advances = this.measurer.measureAll(fontSpec, codepoints);

    let rubyAnnotations: RubyAnnotation[] | undefined;
    if (options.rubyAnnotations?.length) {
      const rubyFontSpec = deriveRubyFont(fontFamily, fontSize);
      await this.fontLoader.ensureLoaded(rubyFontSpec);
      rubyAnnotations = buildRubyAnnotations(options.rubyAnnotations, rubyFontSpec, this.measurer);
    }

    return computeBreaks({
      text: codepoints,
      advances,
      lineWidth: options.lineWidth,
      mode: options.mode,
      enableHanging: options.enableHanging,
      rubyAnnotations,
    });
  }

  /**
   * Preloads a font so it is available for subsequent layout calls.
   * @param fontFamily - CSS font family to preload.
   * @param fontSize - Font size in pixels (used for the font loading check).
   */
  async preloadFont(fontFamily: string, fontSize: number): Promise<void> {
    await this.fontLoader.ensureLoaded(toFontSpec(fontFamily, fontSize));
  }

  /**
   * Lays out an entire chapter (multiple paragraphs) in one call.
   *
   * Each paragraph is measured and broken into lines. Paragraphs can
   * optionally override the font family and size (e.g. for headings).
   *
   * @param options - Chapter layout options.
   * @returns Per-paragraph layout results with break points and character arrays.
   */
  async layoutChapter(options: ChapterLayoutOptions): Promise<ChapterLayoutResult> {
    const { paragraphs: inputs, fontFamily, fontSize, lineWidth, mode, enableHanging } = options;

    const results: ChapterLayoutResult['paragraphs'] = [];
    for (const para of inputs) {
      const breakResult = await this.layout({
        text: para.text,
        fontFamily: para.fontFamily ?? fontFamily,
        fontSize: para.fontSize ?? fontSize,
        lineWidth,
        mode,
        enableHanging,
        rubyAnnotations: para.rubyAnnotations?.length ? para.rubyAnnotations : undefined,
      });
      results.push({ breakResult, chars: [...para.text] });
    }

    return { paragraphs: results };
  }

  /**
   * Clears the width measurement cache.
   * @param fontKey - If provided, clears only entries for this font.
   */
  clearCache(fontKey?: string): void {
    this.measurer.getCache().clear(fontKey);
  }
}
