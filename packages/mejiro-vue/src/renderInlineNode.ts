import {
  type InlineRenderNode,
  type RenderSegment,
  segmentToInlineNode,
} from '@libraz/mejiro/render';
import { Fragment, h, type VNode } from 'vue';

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
