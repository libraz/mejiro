import type { RenderLine, RenderPage, RenderSegment } from '@libraz/mejiro/render';
import { defineComponent, Fragment, h, type PropType, type VNode } from 'vue';

function renderSegment(segment: RenderSegment, key: string): VNode | string {
  switch (segment.type) {
    case 'text':
      return h(Fragment, { key }, [segment.text]);
    case 'ruby':
      return h('ruby', { key }, [segment.base, h('rt', null, segment.rubyText)]);
    case 'emphasis':
      return h(
        'span',
        { key, class: `mejiro-emphasis mejiro-emphasis--${segment.style}` },
        segment.text,
      );
    case 'tcy':
      return h('span', { key, class: 'mejiro-tcy' }, segment.text);
    case 'em':
      return h('em', { key }, segment.text);
    case 'strong':
      return h('strong', { key }, segment.text);
    case 'link':
      return h('a', { key, href: segment.href, title: segment.title }, segment.text);
    case 'footnote-ref':
      return h(
        'a',
        { key, class: 'mejiro-footnote-ref', href: `#${segment.noteId}` },
        segment.text,
      );
  }
}

function renderLine(line: RenderLine, lineIndex: number): (VNode | string)[] {
  const nodes: (VNode | string)[] = [];
  if (lineIndex > 0) {
    nodes.push(h('br', { key: `br-${lineIndex}` }));
  }
  for (let i = 0; i < line.segments.length; i++) {
    nodes.push(renderSegment(line.segments[i], `${lineIndex}-${i}`));
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
        let paraClass = 'mejiro-paragraph';
        if (paragraph.headingLevel != null) {
          paraClass += ` mejiro-paragraph--h${paragraph.headingLevel}`;
        } else if (paragraph.isHeading) {
          paraClass += ' mejiro-paragraph--heading';
        }

        const lineNodes = paragraph.lines.flatMap((line, li) => renderLine(line, li));

        return h('div', { key: pi, class: paraClass }, lineNodes);
      });

      return h('div', { class: 'mejiro-page' }, children);
    };
  },
});

export type MejiroPageProps = InstanceType<typeof MejiroPage>['$props'];
