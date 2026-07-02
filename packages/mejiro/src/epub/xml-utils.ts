const STYLESHEET_LINK_PATTERN =
  /<link\b(?=[^>]*\brel=["']?stylesheet["']?)[^>]*(?:\/>|>(?:\s*<\/link\s*>)?)/giu;

/** Removes XHTML stylesheet links before XML parsing in DOMParser environments. */
export function stripStylesheetLinks(xhtml: string): string {
  return xhtml.replace(STYLESHEET_LINK_PATTERN, '');
}

/** Returns stylesheet link tags from XHTML so callers can restore them later. */
export function extractStylesheetLinks(xhtml: string): string[] {
  return xhtml.match(STYLESHEET_LINK_PATTERN) ?? [];
}
