import type { RenderLine, RenderPage, RenderSegment } from '@libraz/mejiro/render';
import type { CSSProperties, ReactNode } from 'react';

/** Props for the MejiroPage component. */
export interface MejiroPageProps {
  /** Render page data from `buildRenderPage()`. */
  page: RenderPage;
  /** Additional CSS class name for the root element. */
  className?: string;
  /** Additional inline styles for the root element. */
  style?: CSSProperties;
}

function renderSegment(segment: RenderSegment, key: number): ReactNode {
  if (segment.type === 'text') {
    return segment.text;
  }
  return (
    <ruby key={key}>
      {segment.base}
      <rt>{segment.rubyText}</rt>
    </ruby>
  );
}

function renderLine(line: RenderLine, lineIndex: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  if (lineIndex > 0) {
    nodes.push(<br key={`br-${lineIndex}`} />);
  }
  for (let i = 0; i < line.segments.length; i++) {
    nodes.push(renderSegment(line.segments[i], i));
  }
  return nodes;
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
        const paraClass = paragraph.isHeading
          ? 'mejiro-paragraph mejiro-paragraph--heading'
          : 'mejiro-paragraph';

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no stable ID
          <div key={pi} className={paraClass}>
            {paragraph.lines.flatMap((line, li) => renderLine(line, li))}
          </div>
        );
      })}
    </div>
  );
}
