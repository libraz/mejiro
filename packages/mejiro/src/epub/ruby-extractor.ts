import type { RubyInputAnnotation } from '../browser/types.js';
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
  const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
  const body = doc.body ?? doc.documentElement;

  const paragraphs: AnnotatedParagraph[] = [];
  const blocks = body.querySelectorAll(Array.from(BLOCK_ELEMENTS).join(','));

  // If no block elements found, treat the entire body as one paragraph
  const elements = blocks.length > 0 ? Array.from(blocks) : [body];

  for (const el of elements) {
    const result = extractFromElement(el);
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

/**
 * Extracts base text and ruby annotations from a single element.
 */
function extractFromElement(element: Element): AnnotatedParagraph {
  let text = '';
  const rubyAnnotations: RubyInputAnnotation[] = [];

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

    // Recurse into child nodes
    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
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

      rubyAnnotations.push({
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

        rubyAnnotations.push({
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
        rubyAnnotations.push({
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

  return { text: text.trim(), rubyAnnotations };
}

/** Counts characters in a string (respecting surrogate pairs). */
function charCount(str: string): number {
  return [...str].length;
}
