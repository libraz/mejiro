// Stylesheet links are located in one forward pass over markup starts.
// Comments, CDATA sections and processing instructions are skipped whole, and
// a tag ends at the first `>` outside a quoted attribute value, so every range
// is one complete start tag and the total work stays linear in the input
// length even for markup that is malformed or never closes a tag.
const MARKUP_START = '<';
const LINK_TAG_START = /<link(?=[\s/>])/iy;
const TAG_END_OR_QUOTE = /["'>]/g;
const STYLESHEET_REL_PATTERN = /(?:^|\s)rel\s*=\s*["']?stylesheet["'\s/>]/iu;
const CLOSING_LINK_PATTERN = /\s*<\/link\s*>/iuy;
const SKIPPED_SECTIONS: ReadonlyArray<readonly [open: string, close: string]> = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
  ['<?', '?>'],
];

interface StylesheetLinkRange {
  start: number;
  end: number;
}

/**
 * Index just past the `>` closing the tag whose attributes start at `from`,
 * ignoring `>` inside quoted values, or `-1` when the tag never closes.
 */
function tagEnd(xhtml: string, from: number): number {
  TAG_END_OR_QUOTE.lastIndex = from;
  for (;;) {
    const match = TAG_END_OR_QUOTE.exec(xhtml);
    if (!match) return -1;
    if (match[0] === '>') return match.index + 1;
    const close = xhtml.indexOf(match[0], match.index + 1);
    if (close === -1) return -1;
    TAG_END_OR_QUOTE.lastIndex = close + 1;
  }
}

/** Locates every stylesheet link tag, including an explicit closing tag. */
function findStylesheetLinks(xhtml: string): StylesheetLinkRange[] {
  const ranges: StylesheetLinkRange[] = [];
  let cursor = 0;
  for (;;) {
    const start = xhtml.indexOf(MARKUP_START, cursor);
    if (start === -1) break;
    const skipped = SKIPPED_SECTIONS.find(([open]) => xhtml.startsWith(open, start));
    if (skipped) {
      const close = xhtml.indexOf(skipped[1], start + skipped[0].length);
      // An unclosed section runs to the end of the input.
      if (close === -1) break;
      cursor = close + skipped[1].length;
      continue;
    }
    LINK_TAG_START.lastIndex = start;
    if (!LINK_TAG_START.test(xhtml)) {
      cursor = start + 1;
      continue;
    }
    const attributesStart = LINK_TAG_START.lastIndex;
    let end = tagEnd(xhtml, attributesStart);
    // An unterminated tag cannot be closed by any later one either.
    if (end === -1) break;
    if (STYLESHEET_REL_PATTERN.test(xhtml.slice(attributesStart, end))) {
      // A separate closing tag right after the link belongs to it.
      CLOSING_LINK_PATTERN.lastIndex = end;
      if (CLOSING_LINK_PATTERN.test(xhtml)) end = CLOSING_LINK_PATTERN.lastIndex;
      ranges.push({ start, end });
    }
    cursor = end;
  }
  return ranges;
}

/**
 * Removes XHTML stylesheet links before XML parsing in DOMParser environments.
 *
 * Completes in time linear in `xhtml.length` for any input, including malformed
 * and unterminated markup.
 */
export function stripStylesheetLinks(xhtml: string): string {
  const ranges = findStylesheetLinks(xhtml);
  if (ranges.length === 0) return xhtml;
  let result = '';
  let cursor = 0;
  for (const { start, end } of ranges) {
    result += xhtml.slice(cursor, start);
    cursor = end;
  }
  return result + xhtml.slice(cursor);
}

/**
 * Returns stylesheet link tags from XHTML so callers can restore them later.
 *
 * Completes in time linear in `xhtml.length` for any input, including malformed
 * and unterminated markup.
 */
export function extractStylesheetLinks(xhtml: string): string[] {
  return findStylesheetLinks(xhtml).map(({ start, end }) => xhtml.slice(start, end));
}
