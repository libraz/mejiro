import { sanitizeUrl } from '../url.js';
import type { RenderSegment } from './types.js';

export type InlineRenderTag = 'ruby' | 'rt' | 'span' | 'em' | 'strong' | 'a';

export type InlineRenderNode =
  | { type: 'text'; text: string }
  | {
      type: 'element';
      tag: InlineRenderTag;
      className?: string;
      href?: string;
      title?: string;
      children: InlineRenderNode[];
    };

export function segmentToInlineNode(segment: RenderSegment): InlineRenderNode {
  switch (segment.type) {
    case 'text':
      return { type: 'text', text: segment.text };
    case 'ruby':
      return element('ruby', [
        ...renderChildren(segment.children, segment.base),
        element('rt', [text(segment.rubyText)]),
      ]);
    case 'emphasis':
      return element(
        'span',
        renderChildren(segment.children, segment.text),
        `mejiro-emphasis mejiro-emphasis--${segment.style}`,
      );
    case 'tcy':
      return element('span', renderChildren(segment.children, segment.text), 'mejiro-tcy');
    case 'em':
      return element('em', renderChildren(segment.children, segment.text));
    case 'strong':
      return element('strong', renderChildren(segment.children, segment.text));
    case 'link': {
      const href = sanitizeUrl(segment.href);
      return href
        ? element(
            'a',
            renderChildren(segment.children, segment.text),
            undefined,
            href,
            segment.title,
          )
        : text(segment.text);
    }
    case 'footnote-ref':
      return element(
        'a',
        renderChildren(segment.children, segment.text),
        'mejiro-footnote-ref',
        `#${segment.noteId}`,
      );
  }
}

function renderChildren(
  children: readonly RenderSegment[] | undefined,
  fallbackText: string,
): InlineRenderNode[] {
  return children?.length ? children.map(segmentToInlineNode) : [text(fallbackText)];
}

function text(value: string): InlineRenderNode {
  return { type: 'text', text: value };
}

function element(
  tag: InlineRenderTag,
  children: InlineRenderNode[],
  className?: string,
  href?: string,
  title?: string,
): InlineRenderNode {
  return { type: 'element', tag, className, href, title, children };
}
