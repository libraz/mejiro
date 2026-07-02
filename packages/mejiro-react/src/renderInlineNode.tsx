import {
  type InlineRenderNode,
  type RenderSegment,
  segmentToInlineNode,
} from '@libraz/mejiro/render';
import { createElement, Fragment, type ReactNode } from 'react';

export function renderSegment(segment: RenderSegment, key: string): ReactNode {
  return renderInlineNode(segmentToInlineNode(segment), key);
}

function renderInlineNode(node: InlineRenderNode, key: string): ReactNode {
  if (node.type === 'text') return <Fragment key={key}>{node.text}</Fragment>;
  return createElement(
    node.tag,
    {
      key,
      className: node.className,
      href: node.href,
      title: node.title,
    },
    node.children.map((child, index) => renderInlineNode(child, `${key}-${index}`)),
  );
}
