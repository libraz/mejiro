import type { RenderLine, RenderPage, RenderSegment } from '@libraz/mejiro/render';
import { type CSSProperties, Fragment, type ReactNode } from 'react';

/** Props for the MejiroPage component. */
export interface MejiroPageProps {
  /** Render page data from `buildRenderPage()`. */
  page: RenderPage;
  /** Additional CSS class name for the root element. */
  className?: string;
  /** Additional inline styles for the root element. */
  style?: CSSProperties;
}

function renderSegment(segment: RenderSegment, key: string): ReactNode {
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
        let paraClass = 'mejiro-paragraph';
        if (paragraph.headingLevel != null) {
          paraClass += ` mejiro-paragraph--h${paragraph.headingLevel}`;
        } else if (paragraph.isHeading) {
          paraClass += ' mejiro-paragraph--heading';
        }

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
