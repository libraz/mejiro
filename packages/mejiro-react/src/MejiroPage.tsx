import { paragraphClassName, type RenderLine, type RenderPage } from '@libraz/mejiro/render';
import type { CSSProperties, ReactNode } from 'react';
import { renderSegment } from './renderInlineNode.js';

/** Props for the MejiroPage component. */
export interface MejiroPageProps {
  /** Render page data from `buildRenderPage()`. */
  page: RenderPage;
  /** Additional CSS class name for the root element. */
  className?: string;
  /** Additional inline styles for the root element. */
  style?: CSSProperties;
}

function renderLine(line: RenderLine, lineIndex: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  if (lineIndex > 0) {
    nodes.push(<br key={`br-${lineIndex}`} />);
  }
  for (let i = 0; i < line.segments.length; i++) {
    nodes.push(renderSegment(line.segments[i], `${lineIndex}-${i}`));
  }
  return nodes;
}

/** Sets the heading scale the layout measured, so the stylesheet draws that size. */
function paragraphScaleStyle(scale: number | undefined): CSSProperties | undefined {
  return scale == null ? undefined : ({ '--mejiro-paragraph-scale': scale } as CSSProperties);
}

/**
 * Renders a mejiro page with vertical text layout.
 *
 * Converts a `RenderPage` data structure into DOM elements using
 * `mejiro-` prefixed CSS classes for layout.
 */
export function MejiroPage({ page, className, style }: MejiroPageProps): ReactNode {
  const rootClass = className ? `mejiro-page ${className}` : 'mejiro-page';

  return (
    <div className={rootClass} style={style}>
      {page.paragraphs.map((paragraph, pi) => {
        const paraClass = paragraphClassName(paragraph.kind, paragraph.headingLevel);

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no stable ID
          <div key={pi} className={paraClass} style={paragraphScaleStyle(paragraph.scale)}>
            {paragraph.lines.flatMap((line, li) => renderLine(line, li))}
          </div>
        );
      })}
    </div>
  );
}
