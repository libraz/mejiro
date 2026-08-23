import type { AnchorRect } from '@libraz/mejiro/book';
import type { CSSProperties, ReactNode } from 'react';

/** Props for {@link MejiroSelectionLayer}. */
export interface MejiroSelectionLayerProps {
  /**
   * Spread-local rectangles to highlight. Compute these via
   * {@link ChapterLayout.selectionRects} and pass the full array; the layer
   * picks the entries matching {@link MejiroSelectionLayerProps.side}.
   *
   * A rectangle may carry its own `color`, which becomes that rectangle's
   * fill. Entries without one take the fill from the shipped stylesheet
   * (`.mejiro-selection-rect`, themeable via `--mejiro-selection-bg`).
   */
  rects: readonly (AnchorRect & { color?: string })[];
  /** Which page-side this layer is rendered into. */
  side: 'right' | 'left';
  /** Optional class added to the outer wrapper. */
  className?: string;
  /** Optional inline style merged onto the outer wrapper. */
  style?: CSSProperties;
  /** Optional class for each rectangle (defaults to `mejiro-selection-rect`). */
  rectClassName?: string;
  /** Optional inline style for each rectangle. Takes precedence over `color`. */
  rectStyle?: CSSProperties;
}

/**
 * Renders a selection-highlight overlay inside a page-content container.
 *
 * Use as a child of `.mejiro-reader-page-clip` (or any element that shares the
 * page's content coordinate frame). The layer is pointer-transparent so it
 * does not interfere with selection drag on the page below.
 */
export function MejiroSelectionLayer({
  rects,
  side,
  className,
  style,
  rectClassName,
  rectStyle,
}: MejiroSelectionLayerProps): ReactNode {
  const wrapperClass = className ? `mejiro-selection-layer ${className}` : 'mejiro-selection-layer';
  const rectClass = rectClassName ?? 'mejiro-selection-rect';
  return (
    <div
      className={wrapperClass}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        ...style,
      }}
    >
      {rects.map((r, i) => {
        if (r.side !== side) return null;
        const posStyle: CSSProperties =
          side === 'right' ? { left: r.x, top: r.y } : { right: -(r.x + r.width), top: r.y };
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: selection rects have no stable identity
            key={i}
            className={rectClass}
            style={{
              position: 'absolute',
              width: r.width,
              height: r.height,
              ...posStyle,
              ...(r.color != null ? { backgroundColor: r.color } : null),
              ...rectStyle,
            }}
          />
        );
      })}
    </div>
  );
}
