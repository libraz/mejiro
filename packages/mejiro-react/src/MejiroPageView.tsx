import type { PageResult } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import { paragraphClassName } from '@libraz/mejiro/render';
import type { CSSProperties, ReactNode } from 'react';
import { MejiroPage } from './MejiroPage.js';
import { renderSegment } from './renderInlineNode.js';

/** Props for the MejiroPageView component. */
export interface MejiroPageViewProps {
  /** Page result from {@link ChapterLayout.getSpread} or {@link ChapterLayout.getPage}. */
  result: PageResult;
  /** CSS font family for slot-based rendering (used when images are present). */
  fontFamily?: FontFamily;
  /** Line spacing multiplier for slot-based rendering (used when images are present). */
  lineSpacing?: number;
  /**
   * Force slot-based rendering even when `result.hasImages` is false.
   * Set to `true` when the layout has images on any spread, so that
   * all pages use consistent slot-based rendering.
   */
  slotMode?: boolean;
  /** Additional CSS class name for the root element. */
  className?: string;
  /** Additional inline styles for the root element. */
  style?: CSSProperties;
}

/**
 * Renders a page from a {@link PageResult}.
 *
 * Automatically selects the rendering strategy:
 * - **Normal mode** (no images): Uses CSS `writing-mode: vertical-rl` via `<MejiroPage>`.
 * - **Slot mode** (images present): Uses absolute-positioned columns with per-line sizing.
 *
 * @example
 * ```tsx
 * const spread = layout.getSpread(0);
 * <MejiroPageView result={spread.right} fontFamily="serif" lineSpacing={1.8} />
 * ```
 */
export function MejiroPageView({
  result,
  fontFamily,
  lineSpacing,
  slotMode,
  className,
  style,
}: MejiroPageViewProps): ReactNode {
  if (result.hasImages || slotMode) {
    const rootClass = className ? `mejiro-page-slots ${className}` : 'mejiro-page-slots';
    const fontFamilyCss = fontFamily != null ? normalizeFontFamily(fontFamily) : undefined;
    return (
      <div
        className={rootClass}
        style={{ position: 'relative', fontFamily: fontFamilyCss, ...style }}
      >
        {result.lines.map((line, i) => {
          const slot = result.slots[i];
          if (!slot || slot.height <= 0) return null;
          // Geometry is the layout's; weight, style and white-space come from
          // the paragraph class, as in flow mode.
          const colStyle: CSSProperties = {
            position: 'absolute',
            writingMode: 'vertical-rl',
            overflow: 'hidden',
            margin: 0,
            right: slot.xPos,
            top: slot.yStart,
            height: slot.height,
            fontSize: line.fontSize,
            lineHeight: lineSpacing,
          };
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: lines have no stable ID
              key={i}
              className={paragraphClassName(line.kind, line.headingLevel)}
              style={colStyle}
            >
              {line.segments.map((seg, si) => renderSegment(seg, `${i}-${si}`))}
            </div>
          );
        })}
      </div>
    );
  }

  return <MejiroPage page={result.page} className={className} style={style} />;
}
