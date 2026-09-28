import {
  type InlineRenderNode,
  type RenderSegment,
  segmentToInlineNode,
} from '@libraz/mejiro/render';
import { Fragment, h, type VNode } from 'vue';

/**
 * Renders one {@link RenderSegment} as Vue vnodes, via the framework-neutral
 * inline tree from `segmentToInlineNode`. `key` becomes the vnode key.
 */
export function renderSegment(segment: RenderSegment, key: string): VNode | string {
  return renderInlineNode(segmentToInlineNode(segment), key);
}

function renderInlineNode(node: InlineRenderNode, key: string): VNode | string {
  if (node.type === 'text') return h(Fragment, { key }, [node.text]);
  return h(
    node.tag,
    {
      key,
      class: node.className,
      href: node.href,
      title: node.title,
    },
    node.children.map((child, index) => renderInlineNode(child, `${key}-${index}`)),
  );
}
