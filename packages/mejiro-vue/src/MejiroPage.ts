import type { RenderLine, RenderPage, RenderSegment } from '@libraz/mejiro/render';
import { type PropType, type VNode, defineComponent, h } from 'vue';

function renderSegment(segment: RenderSegment, key: number): VNode | string {
  if (segment.type === 'text') {
    return segment.text;
  }
  return h('ruby', { key }, [segment.base, h('rt', null, segment.rubyText)]);
}

function renderLine(line: RenderLine, lineIndex: number): (VNode | string)[] {
  const nodes: (VNode | string)[] = [];
  if (lineIndex > 0) {
    nodes.push(h('br', { key: `br-${lineIndex}` }));
  }
  for (let i = 0; i < line.segments.length; i++) {
    nodes.push(renderSegment(line.segments[i], i));
  }
  return nodes;
}

/**
 * Vue component that renders a mejiro page with vertical text layout.
 *
 * Converts a `RenderPage` data structure into DOM elements using
 * `mejiro-` prefixed CSS classes for layout.
 */
export const MejiroPage = defineComponent({
  name: 'MejiroPage',
  props: {
    /** Render page data from `buildRenderPage()`. */
    page: {
      type: Object as PropType<RenderPage>,
      required: true,
    },
  },
  setup(props) {
    return () => {
      const children = props.page.paragraphs.map((paragraph, pi) => {
        const paraClass = paragraph.isHeading
          ? 'mejiro-paragraph mejiro-paragraph--heading'
          : 'mejiro-paragraph';

        const lineNodes = paragraph.lines.flatMap((line, li) => renderLine(line, li));

        return h('div', { key: pi, class: paraClass }, lineNodes);
      });

      return h('div', { class: 'mejiro-page' }, children);
    };
  },
});
