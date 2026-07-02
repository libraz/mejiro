import type { BookParagraph, ParagraphKind } from '../book/types.js';
import type { InlineAnnotation } from '../browser/types.js';
import { sanitizeUrl } from '../url.js';
import { buildInlineNodes, type InlineNode } from './inline-tree.js';

/** Options for {@link renderEpubStatic}. */
export interface RenderEpubStaticOptions {
  /** Wrapper element tag. @defaultValue 'div' */
  tag?: 'div' | 'article' | 'section';
  /** Additional class names appended to the outer element. */
  className?: string;
  /** Optional `aria-label` for the outer element. */
  ariaLabel?: string;
}

interface StaticChapter {
  paragraphs: readonly BookParagraph[];
}

/**
 * Render a chapter as a static, framework-agnostic HTML string suitable for
 * SSR / RSC output. No font measurement, no pagination — the browser's
 * native `writing-mode: vertical-rl` flow drives the layout, with the
 * bundled `mejiro.css` providing per-heading sizing.
 *
 * Useful as a hydration placeholder for {@link MejiroReader} so search engines
 * and slow connections see real text immediately. Once the client-side
 * reader hydrates, the static markup is replaced with the paginated layout.
 *
 * @example
 * ```ts
 * const html = renderEpubStatic(book.chapters[0]);
 * // → "<div class=\"mejiro-page\">…</div>"
 * ```
 */
export function renderEpubStatic(
  chapter: StaticChapter,
  options: RenderEpubStaticOptions = {},
): string {
  const tag = options.tag ?? 'div';
  const cls = ['mejiro-page', options.className].filter(Boolean).join(' ');
  const attrs = [`class="${escapeAttr(cls)}"`];
  if (options.ariaLabel) attrs.push(`aria-label="${escapeAttr(options.ariaLabel)}"`);
  const inner = chapter.paragraphs.map(renderParagraph).join('');
  return `<${tag} ${attrs.join(' ')}>${inner}</${tag}>`;
}

function renderParagraph(p: BookParagraph): string {
  const cls = paragraphClass(p.kind, p.headingLevel);
  const content = renderInline(p.text, p.inlineAnnotations ?? []);
  return `<div class="${escapeAttr(cls)}">${content}</div>`;
}

function paragraphClass(kind: ParagraphKind | undefined, headingLevel?: number): string {
  const parts = ['mejiro-paragraph'];
  if (headingLevel != null) {
    parts.push(`mejiro-paragraph--h${headingLevel}`);
  } else if (kind === 'heading') {
    parts.push('mejiro-paragraph--heading');
  } else if (kind && kind !== 'body') {
    parts.push(`mejiro-paragraph--${paragraphKindClass(kind)}`);
  }
  return parts.join(' ');
}

function paragraphKindClass(kind: Exclude<ParagraphKind, 'body' | 'heading'>): string {
  return kind.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function renderInline(text: string, annotations: readonly InlineAnnotation[]): string {
  const chars = [...text];
  return buildInlineNodes(chars, annotations).map(renderInlineNode).join('');
}

function renderInlineNode(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.text);
    case 'ruby':
      return `<ruby>${renderChildren(node)}<rt>${escapeHtml(node.rubyText)}</rt></ruby>`;
    case 'emphasis': {
      return `<span class="mejiro-emphasis mejiro-emphasis--${escapeAttr(
        node.style,
      )}">${renderChildren(node)}</span>`;
    }
    case 'tcy':
      return `<span class="mejiro-tcy">${renderChildren(node)}</span>`;
    case 'em':
      return `<em>${renderChildren(node)}</em>`;
    case 'strong':
      return `<strong>${renderChildren(node)}</strong>`;
    case 'link': {
      const href = sanitizeUrl(node.href);
      if (!href) return escapeHtml(node.text);
      const title = node.title ? ` title="${escapeAttr(node.title)}"` : '';
      return `<a href="${escapeAttr(href)}"${title}>${renderChildren(node)}</a>`;
    }
    case 'footnote-ref':
      return `<a class="mejiro-footnote-ref" href="#${escapeAttr(node.noteId)}">${renderChildren(
        node,
      )}</a>`;
  }
}

function renderChildren(node: Exclude<InlineNode, { type: 'text' }>): string {
  if (node.children.length > 0) return node.children.map(renderInlineNode).join('');
  return escapeText(node.type === 'ruby' ? node.base : node.text);
}

function escapeText(s: string): string {
  return escapeHtml(s).replaceAll('\n', '<br />');
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
