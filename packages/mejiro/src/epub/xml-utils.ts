// A stylesheet link is located in one forward pass: candidate starts, the tag
// end, the `rel` test and the optional closing tag are each scanned over
// disjoint regions, so the total work stays linear in the input length even for
// markup that is malformed or never closes a tag.
const LINK_TAG_START = '<link';
const LINK_TAG_START_PATTERN = /<link\b/giu;
const STYLESHEET_REL_PATTERN = /\brel=["']?stylesheet["']?/iu;
const CLOSING_LINK_PATTERN = /\s*<\/link\s*>/iuy;

interface StylesheetLinkRange {
  start: number;
  end: number;
}

/** Locates every stylesheet link tag, including an explicit closing tag. */
function findStylesheetLinks(xhtml: string): StylesheetLinkRange[] {
  const ranges: StylesheetLinkRange[] = [];
  LINK_TAG_START_PATTERN.lastIndex = 0;
  // `\b` is zero-width, so a hit always spans exactly `LINK_TAG_START`.
  while (LINK_TAG_START_PATTERN.test(xhtml)) {
    const attributesStart = LINK_TAG_START_PATTERN.lastIndex;
    const tagEnd = xhtml.indexOf('>', attributesStart);
    // An unterminated tag cannot be closed by any later one either.
    if (tagEnd === -1) break;
    let end = tagEnd + 1;
    if (STYLESHEET_REL_PATTERN.test(xhtml.slice(attributesStart, tagEnd))) {
      // A separate closing tag right after the link belongs to it.
      CLOSING_LINK_PATTERN.lastIndex = end;
      if (CLOSING_LINK_PATTERN.test(xhtml)) end = CLOSING_LINK_PATTERN.lastIndex;
      ranges.push({ start: attributesStart - LINK_TAG_START.length, end });
    }
    // A tag without a stylesheet `rel` cannot contain a nested match either, so
    // scanning resumes after its end rather than after its first character.
    LINK_TAG_START_PATTERN.lastIndex = end;
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
