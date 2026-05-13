import type { InlineAnnotation } from '../browser/types.js';
import type { AnnotatedParagraph } from './types.js';

/** Block-level element names that act as paragraph boundaries. */
const BLOCK_ELEMENTS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'li',
  'dt',
  'dd',
  'figcaption',
]);

/**
 * Extracts paragraphs with ruby annotations from an XHTML string.
 *
 * Walks the DOM tree, collecting base text and recording ruby annotations
 * with character-level indices. `<rt>` content is captured as ruby text
 * but excluded from the base text. `<rp>` elements are ignored.
 *
 * @param xhtml - XHTML content string.
 * @returns Array of annotated paragraphs.
 */
export function extractRubyContent(xhtml: string): AnnotatedParagraph[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(stripStylesheetLinks(xhtml), 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    // application/xhtml+xml parsing inserts a <parsererror> on malformed
    // input instead of throwing; promote it so the caller can react.
    throw new Error('Failed to parse XHTML document');
  }
  const body = doc.body ?? doc.documentElement;

  const paragraphs: AnnotatedParagraph[] = [];
  const elements = collectParagraphElements(body);

  for (const el of elements) {
    const result = trimParagraph(extractFromElement(el));
    if (result.text.length > 0) {
      const tag = el.localName?.toLowerCase() ?? '';
      const headingMatch = /^h([1-6])$/.exec(tag);
      if (headingMatch) {
        result.headingLevel = Number(headingMatch[1]);
      }
      paragraphs.push(result);
    }
  }

  return paragraphs;
}

function stripStylesheetLinks(xhtml: string): string {
  return xhtml.replace(
    /<link\b(?=[^>]*\brel=["']?stylesheet["']?)[^>]*(?:\/>|>(?:\s*<\/link\s*>)?)/giu,
    '',
  );
}

function collectParagraphElements(root: Element): Element[] {
  const elements: Element[] = [];

  function visit(el: Element): void {
    const childElements = Array.from(el.children);
    const blockChildren = childElements.filter((child) =>
      BLOCK_ELEMENTS.has(child.localName.toLowerCase()),
    );

    if (BLOCK_ELEMENTS.has(el.localName.toLowerCase()) && blockChildren.length === 0) {
      elements.push(el);
      return;
    }

    for (const child of childElements) {
      visit(child);
    }
  }

  visit(root);
  return elements.length > 0 ? elements : [root];
}

/**
 * Extracts base text and ruby annotations from a single element.
 */
function extractFromElement(element: Element): AnnotatedParagraph {
  let text = '';
  const inlineAnnotations: InlineAnnotation[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tagName = el.localName.toLowerCase();

    // Skip <rp> elements entirely
    if (tagName === 'rp') return;

    // Skip <rt> elements — they are handled within <ruby> processing
    if (tagName === 'rt') return;

    if (tagName === 'ruby') {
      processRuby(el);
      return;
    }

    if (tagName === 'br') {
      text += '\n';
      return;
    }

    if (tagName === 'em' && el.classList.contains('mejiro-emphasis')) {
      recordInline(el, (startIndex, endIndex) => ({
        kind: 'emphasis',
        startIndex,
        endIndex,
        style: emphasisStyle(el.getAttribute('data-style')),
      }));
      return;
    }

    if (tagName === 'span' && el.classList.contains('mejiro-tcy')) {
      recordInline(el, (startIndex, endIndex) => ({ kind: 'tcy', startIndex, endIndex }));
      return;
    }

    if (tagName === 'em') {
      recordInline(el, (startIndex, endIndex) => ({ kind: 'em', startIndex, endIndex }));
      return;
    }

    if (tagName === 'strong') {
      recordInline(el, (startIndex, endIndex) => ({ kind: 'strong', startIndex, endIndex }));
      return;
    }

    if (tagName === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (el.classList.contains('mejiro-footnote-ref') && href.startsWith('#')) {
        recordInline(el, (startIndex, endIndex) => ({
          kind: 'footnote',
          startIndex,
          endIndex,
          noteId: href.slice(1),
        }));
      } else {
        recordInline(el, (startIndex, endIndex) => ({
          kind: 'link',
          startIndex,
          endIndex,
          href,
          ...(el.getAttribute('title') ? { title: el.getAttribute('title') ?? undefined } : {}),
        }));
      }
      return;
    }

    // Recurse into child nodes
    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
  }

  function recordInline(
    el: Element,
    create: (startIndex: number, endIndex: number) => InlineAnnotation,
  ): void {
    const startIndex = charCount(text);
    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
    const endIndex = charCount(text);
    if (endIndex > startIndex) inlineAnnotations.push(create(startIndex, endIndex));
  }

  function processRuby(rubyEl: Element): void {
    // Collect all <rt> and base text segments
    const segments: { base: string; rt: string }[] = [];
    let currentBase = '';

    for (const child of Array.from(rubyEl.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        currentBase += child.textContent ?? '';
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const childEl = child as Element;
      const tag = childEl.localName.toLowerCase();

      if (tag === 'rp') continue;

      if (tag === 'rb') {
        currentBase += childEl.textContent ?? '';
        continue;
      }

      if (tag === 'rt') {
        const rtText = childEl.textContent ?? '';
        if (currentBase.length > 0) {
          segments.push({ base: currentBase, rt: rtText });
          currentBase = '';
        }
        continue;
      }

      // Other inline elements inside ruby — treat as base text
      currentBase += childEl.textContent ?? '';
    }

    // Handle trailing base text without <rt>
    if (currentBase.length > 0) {
      // Just add as plain text, no ruby annotation
      text += currentBase;
    }

    if (segments.length === 0) return;

    if (segments.length === 1) {
      // Single base + single rt
      const seg = segments[0];
      const startIndex = charCount(text);
      text += seg.base;
      const endIndex = charCount(text);
      const baseLen = endIndex - startIndex;

      inlineAnnotations.push({
        kind: 'ruby',
        startIndex,
        endIndex,
        rubyText: seg.rt,
        type: baseLen === 1 ? 'mono' : 'group',
      });
    } else {
      // Multiple segments → jukugo ruby
      const overallStart = charCount(text);
      const splitPoints: number[] = [];
      let accBaseLen = 0;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStart = charCount(text);
        text += seg.base;

        // Individual annotations for each segment
        const segEnd = charCount(text);
        const segLen = segEnd - segStart;

        inlineAnnotations.push({
          kind: 'ruby',
          startIndex: segStart,
          endIndex: segEnd,
          rubyText: seg.rt,
          type: segLen === 1 ? 'mono' : 'group',
        });

        accBaseLen += segLen;
        if (i < segments.length - 1) {
          splitPoints.push(accBaseLen);
        }
      }

      // Also add a jukugo-level annotation for the whole span
      // to indicate split points for the line breaking algorithm
      const overallEnd = charCount(text);
      if (overallEnd - overallStart > 1) {
        // Combine all ruby text
        const combinedRubyText = segments.map((s) => s.rt).join('');
        inlineAnnotations.push({
          kind: 'ruby',
          startIndex: overallStart,
          endIndex: overallEnd,
          rubyText: combinedRubyText,
          type: 'jukugo',
          jukugoSplitPoints: splitPoints,
        });
      }
    }
  }

  for (const child of Array.from(element.childNodes)) {
    walk(child);
  }

  return { text, inlineAnnotations };
}

function emphasisStyle(value: string | null): 'sesame' | 'dot' | 'circle' | undefined {
  if (value === 'sesame' || value === 'dot' || value === 'circle') return value;
  return undefined;
}

/** Counts characters in a string (respecting surrogate pairs). */
function charCount(str: string): number {
  return [...str].length;
}

function trimParagraph(paragraph: AnnotatedParagraph): AnnotatedParagraph {
  const chars = [...paragraph.text];
  let start = 0;
  let end = chars.length;

  while (start < end && /\s/u.test(chars[start])) start++;
  while (end > start && /\s/u.test(chars[end - 1])) end--;

  if (start === 0 && end === chars.length) return paragraph;

  const inlineAnnotations: InlineAnnotation[] = paragraph.inlineAnnotations
    .filter((ann) => ann.startIndex >= start && ann.endIndex <= end)
    .map((ann) => ({
      ...ann,
      startIndex: ann.startIndex - start,
      endIndex: ann.endIndex - start,
    }));

  return { ...paragraph, text: chars.slice(start, end).join(''), inlineAnnotations };
}
