/**
 * Chapter XHTML markup shared by the EPUB editor and project exporters.
 *
 * Text escaping, XML 1.0 illegal-character stripping, newline-to-`<br />` and
 * inline annotation serialization live only here, so the same paragraph text
 * yields the same markup from `EditableEpub.export()` and `EpubProject.export()`.
 */
import type { InlineAnnotation } from '../browser/types.js';
import { buildInlineNodes, type InlineNode, inlineNodeContent } from '../render/inline-tree.js';
import { sanitizeUrl } from '../url.js';

/** XHTML namespace of every chapter document. */
export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Id of the hidden element carrying a chapter's own title. Reserved: no other
 * element in a chapter document and no package id may use it.
 */
export const CHAPTER_TITLE_ID = 'chapter-title';

/**
 * Characters XML 1.0 forbids in document content: the C0 controls other than
 * tab / line feed / carriage return, lone surrogates, and the two BMP
 * non-characters. They cannot be expressed as character references either, so
 * the only way to keep a well-formed document is to drop them.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the characters XML forbids is the point
const XML_ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/**
 * Drops the characters XML 1.0 forbids, for text written through a DOM API
 * rather than as markup.
 *
 * @param text - Raw text.
 * @returns `text` without XML-illegal characters.
 */
export function sanitizeXmlText(text: string): string {
  return text.replace(XML_ILLEGAL_CHARS, '');
}

/**
 * Escapes text content for XML, dropping XML-illegal characters.
 *
 * @param text - Raw text.
 * @returns Markup-safe text.
 */
export function escapeText(text: string): string {
  return sanitizeXmlText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapes a double-quoted attribute value for XML, dropping XML-illegal
 * characters.
 *
 * @param text - Raw attribute value.
 * @returns Markup-safe attribute value.
 */
export function escapeAttribute(text: string): string {
  // Attribute-value normalization would otherwise turn these into plain spaces.
  return escapeText(text)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/**
 * Serializes paragraph text and its inline annotations as XHTML inline markup.
 * Each newline becomes `<br />`, which the extractor reads back as a newline.
 *
 * @param text - Paragraph base text.
 * @param annotations - Inline annotations addressed in code points of `text`.
 * @returns Inline markup for the paragraph element's content.
 */
export function inlineContentMarkup(
  text: string,
  annotations: readonly InlineAnnotation[],
): string {
  return renderInlineNodes(buildInlineNodes([...text], annotations));
}

/**
 * Serializes sibling inline nodes, writing each jukugo word as one `<ruby>`
 * with interleaved `<rt>` so a re-parse recovers the same split points.
 */
function renderInlineNodes(nodes: readonly InlineNode[]): string {
  let out = '';
  let previousRuby = false;
  for (const node of nodes) {
    const rendered = renderInlineNode(node);
    const joins = node.type === 'ruby' && node.continuesJukugo === true && previousRuby;
    out = joins
      ? `${out.slice(0, -'</ruby>'.length)}${rendered.slice('<ruby>'.length)}`
      : out + rendered;
    previousRuby = node.type === 'ruby';
  }
  return out;
}

function renderInlineNode(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.text).replace(/\n/gu, '<br />');
    case 'ruby':
      return `<ruby>${renderInlineChildren(node)}<rt>${escapeText(node.rubyText)}</rt></ruby>`;
    case 'emphasis':
      return `<em class="mejiro-emphasis" data-style="${escapeAttribute(
        node.style,
      )}">${renderInlineChildren(node)}</em>`;
    case 'tcy':
      return `<span class="mejiro-tcy">${renderInlineChildren(node)}</span>`;
    case 'em':
      return `<em>${renderInlineChildren(node)}</em>`;
    case 'strong':
      return `<strong>${renderInlineChildren(node)}</strong>`;
    case 'link': {
      const href = sanitizeUrl(node.href);
      // An unsafe scheme drops the anchor, never the content.
      if (!href) return renderInlineChildren(node);
      return `<a href="${escapeAttribute(href)}"${
        node.title ? ` title="${escapeAttribute(node.title)}"` : ''
      }>${renderInlineChildren(node)}</a>`;
    }
    case 'footnote-ref':
      return `<a class="mejiro-footnote-ref" href="#${escapeAttribute(
        node.noteId,
      )}">${renderInlineChildren(node)}</a>`;
  }
}

function renderInlineChildren(node: Exclude<InlineNode, { type: 'text' }>): string {
  return renderInlineNodes(inlineNodeContent(node));
}

/**
 * Serializes an image as a `<figure>` with an optional `<figcaption>`.
 *
 * @param image - Percent-encoded `src`, alt text, caption and placement hint.
 * @returns `<figure>` markup.
 */
export function figureMarkup(image: {
  src: string;
  alt: string;
  caption?: string;
  placement?: string;
}): string {
  const placement = image.placement ? ` data-placement="${escapeAttribute(image.placement)}"` : '';
  const caption = image.caption ? `<figcaption>${escapeText(image.caption)}</figcaption>` : '';
  return `<figure${placement}><img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(
    image.alt,
  )}" />${caption}</figure>`;
}

/**
 * Serializes the hidden element that carries a chapter's own title.
 *
 * @param title - Chapter title.
 * @returns `<span id="chapter-title" hidden="">` markup.
 */
export function chapterTitleCarrierMarkup(title: string): string {
  return `<span id="${CHAPTER_TITLE_ID}" hidden="">${escapeText(title)}</span>`;
}
