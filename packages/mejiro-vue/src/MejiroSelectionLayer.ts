import type { AnchorRect } from '@libraz/mejiro/book';
import { type CSSProperties, defineComponent, h, type PropType, type VNode } from 'vue';

/**
 * Renders a selection-highlight overlay inside a page-content container.
 *
 * Use as a child of `.mejiro-reader-page-clip` (or any element that shares
 * the page's content coordinate frame). Pointer-transparent so it does not
 * interfere with selection drag on the page below.
 */
export const MejiroSelectionLayer = defineComponent({
  name: 'MejiroSelectionLayer',
  props: {
    /**
     * Spread-local rectangles from {@link ChapterLayout.selectionRects}.
     *
     * A rectangle may carry its own `color`, which becomes that rectangle's
     * fill. Entries without one take the fill from the shipped stylesheet
     * (`.mejiro-selection-rect`, themeable via `--mejiro-selection-bg`).
     */
    rects: {
      type: Array as PropType<readonly (AnchorRect & { color?: string })[]>,
      required: true,
    },
    /** Which page-side this layer is rendered into. */
    side: { type: String as PropType<'right' | 'left'>, required: true },
    /** Optional class added to the outer wrapper. */
    layerClass: { type: String, default: undefined },
    /** Optional class for each rectangle (defaults to `mejiro-selection-rect`). */
    rectClass: { type: String, default: 'mejiro-selection-rect' },
    /** Optional inline style for each rectangle. Takes precedence over `color`. */
    rectStyle: { type: Object as PropType<CSSProperties>, default: () => ({}) },
  },
  setup(props) {
    return (): VNode => {
      const wrapperClass = props.layerClass
        ? `mejiro-selection-layer ${props.layerClass}`
        : 'mejiro-selection-layer';
      const children: VNode[] = [];
      for (const r of props.rects) {
        if (r.side !== props.side) continue;
        const posStyle: CSSProperties =
          props.side === 'right'
            ? { left: `${r.x}px`, top: `${r.y}px` }
            : { right: `${-(r.x + r.width)}px`, top: `${r.y}px` };
        children.push(
          h('div', {
            class: props.rectClass,
            style: {
              position: 'absolute',
              width: `${r.width}px`,
              height: `${r.height}px`,
              ...posStyle,
              ...(r.color != null ? { backgroundColor: r.color } : null),
              ...props.rectStyle,
            },
          }),
        );
      }
      return h(
        'div',
        {
          class: wrapperClass,
          style: {
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          },
        },
        children,
      );
    };
  },
});

export type MejiroSelectionLayerProps = InstanceType<typeof MejiroSelectionLayer>['$props'];
