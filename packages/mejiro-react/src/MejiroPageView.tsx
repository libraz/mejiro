import type { PageResult } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import type { RenderSegment } from '@libraz/mejiro/render';
import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { MejiroPage } from './MejiroPage.js';

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

function renderSlotSegment(segment: RenderSegment, key: string): ReactNode {
  switch (segment.type) {
    case 'text':
      return <Fragment key={key}>{segment.text}</Fragment>;
    case 'ruby':
      return (
        <ruby key={key}>
          {segment.base}
          <rt>{segment.rubyText}</rt>
        </ruby>
      );
    case 'emphasis':
      return (
        <span key={key} className={`mejiro-emphasis mejiro-emphasis--${segment.style}`}>
          {segment.text}
        </span>
      );
    case 'tcy':
      return (
        <span key={key} className="mejiro-tcy">
          {segment.text}
        </span>
      );
    case 'em':
      return <em key={key}>{segment.text}</em>;
    case 'strong':
      return <strong key={key}>{segment.text}</strong>;
    case 'link':
      return (
        <a key={key} href={segment.href} title={segment.title}>
          {segment.text}
        </a>
      );
    case 'footnote-ref':
      return (
        <a key={key} className="mejiro-footnote-ref" href={`#${segment.noteId}`}>
          {segment.text}
        </a>
      );
  }
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
      <div className={rootClass} style={{ position: 'relative', ...style }}>
        {result.lines.map((line, i) => {
          const slot = result.slots[i];
          if (!slot || slot.height <= 0) return null;
          const colStyle: CSSProperties = {
            position: 'absolute',
            writingMode: 'vertical-rl',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            right: slot.xPos,
            top: slot.yStart,
            height: slot.height,
            fontSize: line.fontSize,
            fontFamily: fontFamilyCss,
            lineHeight: lineSpacing,
            fontWeight: line.headingLevel != null ? 700 : undefined,
          };
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no stable ID
            <div key={i} style={colStyle}>
              {line.segments.map((seg, si) => renderSlotSegment(seg, `${i}-${si}`))}
            </div>
          );
        })}
      </div>
    );
  }

  return <MejiroPage page={result.page} className={className} style={style} />;
}
