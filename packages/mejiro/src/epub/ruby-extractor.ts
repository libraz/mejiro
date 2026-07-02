import type { InlineAnnotation } from '../browser/types.js';
import { sanitizeUrl } from '../url.js';
import type { AnnotatedParagraph } from './types.js';
import { stripStylesheetLinks } from './xml-utils.js';

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
  'section',
  'article',
  'main',
  'td',
  'th',
  'pre',
  'table',
  'tr',
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

  for (const { element, directOnly } of elements) {
    const result = trimParagraph(extractFromElement(element, directOnly));
    if (result.text.length > 0) {
      const tag = element.localName?.toLowerCase() ?? '';
      const headingMatch = /^h([1-6])$/.exec(tag);
      if (headingMatch) {
        result.headingLevel = Number(headingMatch[1]);
      }
      paragraphs.push(result);
    }
  }

  return paragraphs;
}

interface ParagraphElement {
  element: Element;
  directOnly: boolean;
}

interface RubyBaseSegment {
  base: string;
  rt: string;
  baseNodes?: Node[];
}

function collectParagraphElements(root: Element): ParagraphElement[] {
  const elements: ParagraphElement[] = [];

  function visit(el: Element): void {
    const childElements = Array.from(el.children);
    const blockChildren = childElements.filter((child) =>
      BLOCK_ELEMENTS.has(child.localName.toLowerCase()),
    );

    if (
      BLOCK_ELEMENTS.has(el.localName.toLowerCase()) &&
      (blockChildren.length === 0 || hasDirectInlineContent(el))
    ) {
      elements.push({ element: el, directOnly: blockChildren.length > 0 });
      if (blockChildren.length === 0) return;
    }

    for (const child of childElements) {
      visit(child);
    }
  }

  visit(root);
  return elements.length > 0 ? elements : [{ element: root, directOnly: false }];
}

function hasDirectInlineContent(el: Element): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && /\S/u.test(child.textContent ?? '')) return true;
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const childEl = child as Element;
    const tag = childEl.localName.toLowerCase();
    if (!BLOCK_ELEMENTS.has(tag) && tag !== 'script' && tag !== 'style') return true;
  }
  return false;
}

/**
 * Extracts base text and ruby annotations from a single element.
 */
function extractFromElement(element: Element, directOnly = false): AnnotatedParagraph {
  let text = '';
  let textCharCount = 0;
  const inlineAnnotations: InlineAnnotation[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      appendCssText(node.textContent ?? '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tagName = el.localName.toLowerCase();

    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return;

    // Skip <rp> elements entirely
    if (tagName === 'rp') return;

    // Skip <rt> elements — they are handled within <ruby> processing
    if (tagName === 'rt') return;

    if (tagName === 'ruby') {
      processRuby(el);
      return;
    }

    if (tagName === 'br') {
      appendText('\n');
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
      const href = sanitizeUrl(el.getAttribute('href') ?? '');
      if (!href) {
        for (const child of Array.from(el.childNodes)) {
          walk(child);
        }
        return;
      }
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
    const startIndex = textCharCount;
    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
    const endIndex = textCharCount;
    if (endIndex > startIndex) inlineAnnotations.push(create(startIndex, endIndex));
  }

  function processRuby(rubyEl: Element): void {
    const rbNodes = directChildrenByName(rubyEl, 'rb');
    const rtNodes = directChildrenByName(rubyEl, 'rt');
    if (rbNodes.length > 0 && rtNodes.length > 0) {
      emitRubySegments(
        rbNodes.map((rb, index) => ({
          base: rubyBaseText(rb),
          rt: rtNodes[index]?.textContent ?? '',
          baseNodes: [rb],
        })),
      );
      return;
    }

    const segments: RubyBaseSegment[] = [];
    let currentBase = '';
    let currentBaseNodes: Node[] = [];

    for (const child of Array.from(rubyEl.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        currentBase += child.textContent ?? '';
        currentBaseNodes.push(child);
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const childEl = child as Element;
      const tag = childEl.localName.toLowerCase();

      if (tag === 'rp' || tag === 'rtc') continue;

      if (tag === 'rb') {
        currentBase += rubyBaseText(childEl);
        currentBaseNodes.push(childEl);
        continue;
      }

      if (tag === 'rt') {
        const rtText = childEl.textContent ?? '';
        if (currentBase.length > 0) {
          segments.push({ base: currentBase, rt: rtText, baseNodes: currentBaseNodes });
          currentBase = '';
          currentBaseNodes = [];
        }
        continue;
      }

      currentBase += rubyBaseText(childEl);
      currentBaseNodes.push(childEl);
    }

    if (currentBase.length > 0) {
      segments.push({ base: currentBase, rt: '', baseNodes: currentBaseNodes });
    }

    emitRubySegments(segments);
  }

  function emitRubySegments(segments: RubyBaseSegment[]): void {
    const usable = segments.filter((seg) => seg.base.length > 0);
    if (usable.length === 0) return;

    if (usable.length === 1) {
      const seg = usable[0];
      const startIndex = textCharCount;
      appendRubyBase(seg);
      const endIndex = textCharCount;
      const baseLen = endIndex - startIndex;

      if (seg.rt.length > 0) {
        inlineAnnotations.push({
          kind: 'ruby',
          startIndex,
          endIndex,
          rubyText: seg.rt,
          type: baseLen === 1 ? 'mono' : 'group',
        });
      }
    } else {
      const overallStart = textCharCount;
      const splitPoints: number[] = [];
      let accBaseLen = 0;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStart = textCharCount;
        appendRubyBase(seg);

        // Individual annotations for each segment
        const segEnd = textCharCount;
        const segLen = segEnd - segStart;

        if (seg.rt.length > 0) {
          inlineAnnotations.push({
            kind: 'ruby',
            startIndex: segStart,
            endIndex: segEnd,
            rubyText: seg.rt,
            type: segLen === 1 ? 'mono' : 'group',
          });
        }

        accBaseLen += segLen;
        if (i < segments.length - 1) {
          splitPoints.push(accBaseLen);
        }
      }

      const overallEnd = textCharCount;
      if (overallEnd - overallStart > 1) {
        const rubySegments = segments.filter((s) => s.rt.length > 0);
        const combinedRubyText = rubySegments.map((s) => s.rt).join('');
        if (combinedRubyText.length > 0 && rubySegments.length === segments.length) {
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
  }

  function appendRubyBase(seg: RubyBaseSegment): void {
    if (!seg.baseNodes?.length) {
      appendText(seg.base);
      return;
    }
    for (const node of seg.baseNodes) {
      walkRubyBase(node);
    }
  }

  function walkRubyBase(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(normalizeCssText(node.textContent ?? ''));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tagName = el.localName.toLowerCase();

    if (tagName === 'rt' || tagName === 'rp' || tagName === 'rtc') return;

    if (tagName === 'br') {
      appendText('\n');
      return;
    }

    if (tagName === 'em' && el.classList.contains('mejiro-emphasis')) {
      recordRubyBaseInline(el, (startIndex, endIndex) => ({
        kind: 'emphasis',
        startIndex,
        endIndex,
        style: emphasisStyle(el.getAttribute('data-style')),
      }));
      return;
    }

    if (tagName === 'span' && el.classList.contains('mejiro-tcy')) {
      recordRubyBaseInline(el, (startIndex, endIndex) => ({ kind: 'tcy', startIndex, endIndex }));
      return;
    }

    if (tagName === 'em') {
      recordRubyBaseInline(el, (startIndex, endIndex) => ({ kind: 'em', startIndex, endIndex }));
      return;
    }

    if (tagName === 'strong') {
      recordRubyBaseInline(el, (startIndex, endIndex) => ({
        kind: 'strong',
        startIndex,
        endIndex,
      }));
      return;
    }

    if (tagName === 'a') {
      const href = sanitizeUrl(el.getAttribute('href') ?? '');
      if (!href) {
        for (const child of Array.from(el.childNodes)) {
          walkRubyBase(child);
        }
        return;
      }
      if (el.classList.contains('mejiro-footnote-ref') && href.startsWith('#')) {
        recordRubyBaseInline(el, (startIndex, endIndex) => ({
          kind: 'footnote',
          startIndex,
          endIndex,
          noteId: href.slice(1),
        }));
      } else {
        recordRubyBaseInline(el, (startIndex, endIndex) => ({
          kind: 'link',
          startIndex,
          endIndex,
          href,
          ...(el.getAttribute('title') ? { title: el.getAttribute('title') ?? undefined } : {}),
        }));
      }
      return;
    }

    for (const child of Array.from(el.childNodes)) {
      walkRubyBase(child);
    }
  }

  function recordRubyBaseInline(
    el: Element,
    create: (startIndex: number, endIndex: number) => InlineAnnotation,
  ): void {
    const startIndex = textCharCount;
    for (const child of Array.from(el.childNodes)) {
      walkRubyBase(child);
    }
    const endIndex = textCharCount;
    if (endIndex > startIndex) inlineAnnotations.push(create(startIndex, endIndex));
  }

  function appendCssText(raw: string): void {
    const normalized = raw.replace(/[\t\n\f\r ]+/gu, ' ');
    if (normalized.length === 0) return;
    const previous = lastChar(text);
    const next = firstChar(normalized);
    if (normalized === ' ' && (previous === undefined || previous === '\n')) return;
    if (previous && next === ' ' && isCjk(previous) && isCjk(firstNonSpace(normalized))) {
      appendText(normalized.trimStart());
      return;
    }
    if (previous === ' ' && next && isCjk(next) && isCjk(previousNonSpace(text))) {
      text = text.slice(0, -1);
      textCharCount -= 1;
    }
    appendText(normalized);
  }

  function appendText(value: string): void {
    text += value;
    textCharCount += charCount(value);
  }

  for (const child of Array.from(element.childNodes)) {
    if (
      directOnly &&
      child.nodeType === Node.ELEMENT_NODE &&
      BLOCK_ELEMENTS.has((child as Element).localName.toLowerCase())
    ) {
      continue;
    }
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

function directChildrenByName(el: Element, localName: string): Element[] {
  return Array.from(el.children).filter((child) => child.localName.toLowerCase() === localName);
}

function rubyBaseText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return normalizeCssText(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (tag === 'rt' || tag === 'rp' || tag === 'rtc') return '';
  if (tag === 'br') return '\n';
  return Array.from(el.childNodes).map(rubyBaseText).join('');
}

function normalizeCssText(raw: string): string {
  return raw.replace(/[\t\n\f\r ]+/gu, ' ');
}

function firstChar(value: string): string | undefined {
  return [...value][0];
}

function lastChar(value: string): string | undefined {
  const chars = [...value];
  return chars[chars.length - 1];
}

function firstNonSpace(value: string): string | undefined {
  return [...value].find((ch) => ch !== ' ');
}

function previousNonSpace(value: string): string | undefined {
  return [...value].reverse().find((ch) => ch !== ' ');
}

function isCjk(value: string | undefined): boolean {
  return value != null && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function trimParagraph(paragraph: AnnotatedParagraph): AnnotatedParagraph {
  const chars = [...paragraph.text];
  let start = 0;
  let end = chars.length;

  while (start < end && isTrimSpace(chars[start])) start++;
  while (end > start && isTrimSpace(chars[end - 1])) end--;

  const inlineAnnotations: InlineAnnotation[] = paragraph.inlineAnnotations
    .map((ann) => ({
      ...ann,
      startIndex: Math.max(ann.startIndex, start) - start,
      endIndex: Math.min(ann.endIndex, end) - start,
    }))
    .filter((ann) => ann.endIndex > ann.startIndex);

  return {
    ...paragraph,
    text: removeCjkInterwordSpaces(chars.slice(start, end).join('')),
    inlineAnnotations,
  };
}

function isTrimSpace(ch: string): boolean {
  return ch !== '　' && /\s/u.test(ch);
}

function removeCjkInterwordSpaces(value: string): string {
  return value.replace(
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]) ([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
    '$1$2',
  );
}
