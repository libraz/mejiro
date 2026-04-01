import { MejiroBrowser } from '../browser/integration.js';
import { CharMeasurer } from '../browser/measure.js';
import type { RubyInputAnnotation } from '../browser/types.js';
import { toFontSpec } from '../browser/types.js';
import type { HeadingStyle } from '../render/measures.js';
import type { RenderEntry } from '../render/types.js';
import { toCodepoints } from '../text.js';
import type { CachedParagraph, LayoutConfig } from './chapter-layout.js';
import { ChapterLayout } from './chapter-layout.js';
import type { BookOptions, BookParagraph, PageSize } from './types.js';

interface InternalOptions {
  fontFamily: string;
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
  private browser = new MejiroBrowser();
  private measurer = new CharMeasurer();

  constructor(options: BookOptions) {
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

  /**
   * Updates book options. Existing {@link ChapterLayout} instances are not
   * affected — call {@link layoutChapter} again to apply new options.
   */
  setOptions(options: Partial<BookOptions>): void {
    if (options.fontFamily != null) this.opts.fontFamily = options.fontFamily;
    if (options.fontSize != null) this.opts.fontSize = options.fontSize;
    if (options.lineSpacing != null) this.opts.lineSpacing = options.lineSpacing;
    if (options.mode != null) this.opts.mode = options.mode;
    if (options.enableHanging != null) this.opts.enableHanging = options.enableHanging;
    if (options.headingStyles !== undefined) this.opts.headingStyles = options.headingStyles;
    if (options.headingScale != null) this.opts.headingScale = options.headingScale;
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
   * Lays out a chapter and returns a {@link ChapterLayout} for pagination and rendering.
   *
   * The chapter object is compatible with `EpubChapter` from `@libraz/mejiro/epub`.
   * Font loading and character measurement are handled automatically.
   *
   * @param chapter - Chapter with paragraphs to lay out.
   * @returns A layout object for retrieving pages and managing image exclusions.
   * @throws If {@link setPageSize} has not been called.
   */
  async layoutChapter(chapter: { paragraphs: BookParagraph[] }): Promise<ChapterLayout> {
    if (!this.size) throw new Error('Page size not set. Call setPageSize() first.');

    const { fontFamily, fontSize, lineSpacing, mode, enableHanging } = this.opts;
    const { lineWidth } = this.size;

    // Initial layout via MejiroBrowser (handles font loading + ruby)
    const result = await this.browser.layoutChapter({
      paragraphs: chapter.paragraphs.map((p) => ({
        text: p.text,
        rubyAnnotations: p.rubyAnnotations?.length ? p.rubyAnnotations : undefined,
        fontSize: p.headingLevel
          ? Math.round(fontSize * resolveScale(p.headingLevel, this.opts))
          : undefined,
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
      rubyAnnotations: (p.rubyAnnotations ?? []) as RubyInputAnnotation[],
      headingLevel: p.headingLevel,
    }));

    // Cache paragraph data for re-layout on resize/exclusion
    const baseFontSpec = toFontSpec(fontFamily, fontSize);
    const cached: CachedParagraph[] = chapter.paragraphs.map((p, i) => {
      const scale = resolveScale(p.headingLevel, this.opts);
      const pFontSize = p.headingLevel ? Math.round(fontSize * scale) : fontSize;
      const spec = pFontSize === fontSize ? baseFontSpec : toFontSpec(fontFamily, pFontSize);
      const codepoints = toCodepoints(p.text);
      const advances = this.measurer.measureAll(spec, codepoints);
      return {
        text: codepoints,
        advances,
        chars: result.paragraphs[i].chars,
        rubyAnnotations: (p.rubyAnnotations ?? []) as RubyInputAnnotation[],
        headingLevel: p.headingLevel,
      };
    });

    const config: LayoutConfig = {
      fontSize,
      lineSpacing,
      headingStyles: this.opts.headingStyles,
      headingScale: this.opts.headingScale,
      mode,
      enableHanging,
    };

    return new ChapterLayout(cached, renderEntries, config, { ...this.size });
  }

  /** Clears the character width measurement cache. */
  clearCache(fontKey?: string): void {
    this.browser.clearCache(fontKey);
  }
}
