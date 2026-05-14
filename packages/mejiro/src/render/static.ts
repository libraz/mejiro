import type { BookParagraph, ParagraphKind } from '../book/types.js';
import type { InlineAnnotation } from '../browser/types.js';

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
    parts.push(`mejiro-paragraph--${kind}`);
  }
  return parts.join(' ');
}

function renderInline(text: string, annotations: readonly InlineAnnotation[]): string {
  if (annotations.length === 0) return escapeHtml(text);
  // Sort by startIndex so we can walk the codepoint stream in order.
  const sorted = [...annotations].sort((a, b) => a.startIndex - b.startIndex);
  const chars = [...text];
  let cursor = 0;
  const out: string[] = [];
  for (const ann of sorted) {
    if (ann.startIndex < cursor) continue; // overlap — skip to keep behaviour deterministic
    if (ann.startIndex > cursor) {
      out.push(escapeHtml(chars.slice(cursor, ann.startIndex).join('')));
    }
    const baseText = chars.slice(ann.startIndex, ann.endIndex).join('');
    out.push(renderAnnotation(ann, baseText));
    cursor = ann.endIndex;
  }
  if (cursor < chars.length) {
    out.push(escapeHtml(chars.slice(cursor).join('')));
  }
  return out.join('');
}

function renderAnnotation(ann: InlineAnnotation, baseText: string): string {
  switch (ann.kind) {
    case 'ruby':
      return `<ruby>${escapeHtml(baseText)}<rt>${escapeHtml(ann.rubyText)}</rt></ruby>`;
    case 'emphasis': {
      const style = ann.style ?? 'sesame';
      return `<span class="mejiro-emphasis mejiro-emphasis--${escapeAttr(style)}">${escapeHtml(
        baseText,
      )}</span>`;
    }
    case 'tcy':
      return `<span class="mejiro-tcy">${escapeHtml(baseText)}</span>`;
    case 'em':
      return `<em>${escapeHtml(baseText)}</em>`;
    case 'strong':
      return `<strong>${escapeHtml(baseText)}</strong>`;
    case 'link': {
      const title = ann.title ? ` title="${escapeAttr(ann.title)}"` : '';
      return `<a href="${escapeAttr(ann.href)}"${title}>${escapeHtml(baseText)}</a>`;
    }
    case 'footnote':
      return `<a class="mejiro-footnote-ref" href="#${escapeAttr(ann.noteId)}">${escapeHtml(baseText)}</a>`;
  }
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
