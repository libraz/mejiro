import type { InlineAnnotation } from '../browser/types.js';
import type { IndexMapping } from '../normalize.js';
import { normalizeAnnotatedText, remapInlineAnnotations } from '../normalize.js';
import { sanitizeUrl } from '../url.js';
import type { AnnotatedParagraph } from './types.js';
import { stripStylesheetLinks } from './xml-utils.js';

/**
 * Block-level element names that act as paragraph boundaries.
 *
 * The published documentation lists exactly these names, in this order.
 */
export const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
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
 * Paragraph text is returned in NFC, and every annotation index is a code
 * point offset into that NFC text.
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

  for (const { element, nodes } of collectParagraphSources(body)) {
    const result = trimParagraph(normalizeParagraph(extractFromNodes(nodes)));
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

/** One paragraph's worth of source nodes and the block element owning them. */
interface ParagraphSource {
  /** Block element the run belongs to; drives the heading level. */
  element: Element;
  /** Consecutive child nodes forming a single paragraph, in source order. */
  nodes: Node[];
}

interface RubyBaseSegment {
  base: string;
  rt: string;
  baseNodes?: Node[];
}

/**
 * Splits the document into paragraph-sized runs of nodes.
 *
 * A block element without block children contributes one paragraph. When block
 * children are present, each inline run around them becomes a paragraph of its
 * own, so the emitted order follows the source order.
 */
function collectParagraphSources(root: Element): ParagraphSource[] {
  const sources: ParagraphSource[] = [];

  function visit(el: Element): void {
    const isBlock = BLOCK_ELEMENTS.has(el.localName.toLowerCase());
    const childNodes = Array.from(el.childNodes);

    if (!childNodes.some(isBlockElementNode)) {
      if (isBlock) {
        sources.push({ element: el, nodes: childNodes });
        return;
      }
      for (const child of Array.from(el.children)) {
        visit(child);
      }
      return;
    }

    let run: Node[] = [];
    const flush = (): void => {
      if (isBlock && run.length > 0) sources.push({ element: el, nodes: run });
      run = [];
    };

    for (const child of childNodes) {
      if (isBlockElementNode(child)) {
        flush();
        visit(child as Element);
        continue;
      }
      run.push(child);
    }
    flush();
  }

  visit(root);
  return sources.length > 0 ? sources : [{ element: root, nodes: Array.from(root.childNodes) }];
}

/** Reports whether a node is an element that acts as a paragraph boundary. */
function isBlockElementNode(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    BLOCK_ELEMENTS.has((node as Element).localName.toLowerCase())
  );
}

/**
 * Extracts base text and ruby annotations from one run of sibling nodes.
 */
function extractFromNodes(nodes: readonly Node[]): AnnotatedParagraph {
  let text = '';
  let textCharCount = 0;
  const inlineAnnotations: InlineAnnotation[] = [];
  // Spans whose start index is already captured but whose element is still
  // being walked; a later text edit has to move them like recorded indices.
  const openSpans: { index: number }[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      appendCssText(node.textContent ?? '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tagName = el.localName.toLowerCase();

    // Non-rendered subtrees (script/style, ruby readings, hidden content)
    // contribute neither base text nor character positions.
    if (isNonRenderedElement(el)) return;

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
    const start = openSpan();
    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
    closeSpan();
    if (textCharCount > start.index) inlineAnnotations.push(create(start.index, textCharCount));
  }

  function processRuby(rubyEl: Element): void {
    const rbNodes = directChildrenByName(rubyEl, 'rb');
    const rtNodes = directChildrenByName(rubyEl, 'rt');
    // Readings may live in an <rtc> container instead of directly under <ruby>.
    const readings = rtNodes.length > 0 ? rtNodes : containerReadings(rubyEl);
    if (rbNodes.length > 0 && readings.length > 0) {
      emitRubySegments(
        rbNodes.map((rb, index) => ({
          base: rubyBaseText(rb),
          rt: readings[index]?.textContent ?? '',
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

      if (tag === 'rp') continue;

      if (tag === 'rtc') {
        // Without direct <rt> children the container holds the only reading,
        // so attach it to the base collected so far instead of dropping it.
        if (rtNodes.length === 0 && currentBase.length > 0) {
          segments.push({
            base: currentBase,
            rt: containerReadingText(childEl),
            baseNodes: currentBaseNodes,
          });
          currentBase = '';
          currentBaseNodes = [];
        }
        continue;
      }

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

    if (isNonRenderedElement(el)) return;

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
    const start = openSpan();
    for (const child of Array.from(el.childNodes)) {
      walkRubyBase(child);
    }
    closeSpan();
    if (textCharCount > start.index) inlineAnnotations.push(create(start.index, textCharCount));
  }

  /** Starts tracking a span whose start index follows later text edits. */
  function openSpan(): { index: number } {
    const span = { index: textCharCount };
    openSpans.push(span);
    return span;
  }

  function closeSpan(): void {
    openSpans.pop();
  }

  /**
   * Removes the last emitted character and pulls every index that pointed past
   * it back, so recorded annotations and open spans keep covering their text.
   */
  function dropLastChar(): void {
    text = text.slice(0, -1);
    textCharCount -= 1;
    for (const span of openSpans) {
      if (span.index > textCharCount) span.index = textCharCount;
    }
    for (const ann of inlineAnnotations) {
      if (ann.startIndex > textCharCount) ann.startIndex = textCharCount;
      if (ann.endIndex > textCharCount) ann.endIndex = textCharCount;
    }
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
      dropLastChar();
    }
    appendText(normalized);
  }

  function appendText(value: string): void {
    text += value;
    textCharCount += charCount(value);
  }

  for (const node of nodes) {
    walk(node);
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

/**
 * Readings of the first `<rtc>` container of a `<ruby>`, in source order.
 *
 * Returns the container itself when it carries plain text instead of `<rt>`
 * children, so a single reading is still reachable.
 */
function containerReadings(rubyEl: Element): Element[] {
  const container = directChildrenByName(rubyEl, 'rtc')[0];
  if (!container) return [];
  const readings = directChildrenByName(container, 'rt');
  return readings.length > 0 ? readings : [container];
}

/** Concatenated reading text of an `<rtc>` container. */
function containerReadingText(container: Element): string {
  const readings = directChildrenByName(container, 'rt');
  if (readings.length === 0) return container.textContent ?? '';
  return readings.map((rt) => rt.textContent ?? '').join('');
}

function rubyBaseText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return normalizeCssText(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (isNonRenderedElement(el)) return '';
  if (tag === 'br') return '\n';
  return Array.from(el.childNodes).map(rubyBaseText).join('');
}

/**
 * Reports whether an element's subtree is excluded from the base text.
 *
 * Covers author-hidden content, ruby readings (which are captured separately
 * by the `<ruby>` handling) and elements whose character data is source code
 * rather than prose.
 */
function isNonRenderedElement(el: Element): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  const tag = el.localName.toLowerCase();
  return tag === 'script' || tag === 'style' || tag === 'rp' || tag === 'rt' || tag === 'rtc';
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

/**
 * Converts the paragraph text to NFC and moves every annotation with it.
 *
 * Delegates to the shared {@link normalizeAnnotatedText}, which every other
 * text-plus-annotation boundary goes through as well, so the EPUB extractor and
 * the layout entry points cannot disagree about where a decomposed character
 * ends up.
 */
function normalizeParagraph(paragraph: AnnotatedParagraph): AnnotatedParagraph {
  const normalized = normalizeAnnotatedText(paragraph.text, paragraph.inlineAnnotations);
  if (normalized.text === paragraph.text) return paragraph;
  return {
    ...paragraph,
    text: normalized.text,
    inlineAnnotations: normalized.inlineAnnotations,
  };
}

/**
 * Drops paragraph-edge whitespace and CJK inter-word spaces.
 *
 * Both removals are expressed as a single character mask, so the text and
 * every annotation (including jukugo split points) move through one index
 * mapping. Annotations whose characters are removed entirely are dropped.
 */
function trimParagraph(paragraph: AnnotatedParagraph): AnnotatedParagraph {
  const chars = [...paragraph.text];
  const kept = keptCharMask(chars);

  // mapping[i] = index of char i in the resulting text (kept chars before i).
  const mapping = new Array<number>(chars.length + 1);
  let count = 0;
  for (let i = 0; i < chars.length; i++) {
    mapping[i] = count;
    if (kept[i]) count++;
  }
  mapping[chars.length] = count;

  const trimmed: IndexMapping = {
    last: chars.length,
    start: (index) => mapping[index],
    end: (index) => mapping[index],
  };
  return {
    ...paragraph,
    text: chars.filter((_, i) => kept[i]).join(''),
    inlineAnnotations: remapInlineAnnotations(paragraph.inlineAnnotations, trimmed),
  };
}

/**
 * Builds the per-character keep mask used by {@link trimParagraph}: leading and
 * trailing whitespace is dropped, as is a single space between two CJK
 * characters (source line wrapping in the XHTML). Inter-word matches are
 * consumed left to right and do not overlap.
 */
function keptCharMask(chars: readonly string[]): boolean[] {
  let start = 0;
  let end = chars.length;

  while (start < end && isTrimSpace(chars[start])) start++;
  while (end > start && isTrimSpace(chars[end - 1])) end--;

  const kept = chars.map((_, i) => i >= start && i < end);
  for (let i = start; i + 2 < end; ) {
    if (isCjk(chars[i]) && chars[i + 1] === ' ' && isCjk(chars[i + 2])) {
      kept[i + 1] = false;
      i += 3;
    } else {
      i++;
    }
  }
  return kept;
}

function isTrimSpace(ch: string): boolean {
  return ch !== '　' && /\s/u.test(ch);
}
