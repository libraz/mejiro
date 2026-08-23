import { sanitizeUrl } from '../url.js';
import type { RenderSegment } from './types.js';

/**
 * HTML element names {@link segmentToInlineNode} emits. Deliberately a closed
 * set, so a renderer can map it to its own element factory (or to a non-DOM
 * target) without a catch-all branch.
 */
export type InlineRenderTag = 'ruby' | 'rt' | 'span' | 'em' | 'strong' | 'a';

/**
 * Framework-agnostic description of the markup for one {@link RenderSegment}.
 *
 * Unlike {@link InlineNode}, an element node carries no flattened text: its
 * content is entirely in `children`, which is never empty for an element, so a
 * renderer walks the tree without deciding between children and a fallback
 * string. `className`, `href` and `title` are left undefined unless the segment
 * calls for them, so a renderer should skip the attribute rather than emit it
 * empty.
 */
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

/**
 * Resolves one {@link RenderSegment} — nested `children` included — into the
 * markup tree mejiro's own page components render, so a third-party renderer
 * reuses the annotation policy instead of re-deriving it.
 *
 * Ruby becomes `<ruby>` with a trailing `<rt>`; emphasis dots and
 * tate-chu-yoko become `<span>` carrying the `mejiro-emphasis` /
 * `mejiro-emphasis--<style>` and `mejiro-tcy` classes the bundled stylesheets
 * style; footnote references become an `<a>` to the local `#<noteId>` anchor.
 * A segment whose `children` is empty falls back to its own flattened text, so
 * the returned tree always covers the segment's characters exactly once.
 *
 * Link hrefs are sanitized: a segment whose URL uses a scheme other than
 * `http`, `https` or `mailto` degrades to a plain text node rather than
 * producing an `<a>`, which keeps untrusted EPUB content from emitting
 * executable URLs.
 */
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
