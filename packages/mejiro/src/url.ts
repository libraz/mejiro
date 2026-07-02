const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Returns a URL that is safe to place in an `href` attribute, or `null` when
 * the URL uses an executable or otherwise unsupported scheme.
 */
export function sanitizeUrl(raw: string): string | null {
  const href = raw.trim();
  if (!href || hasControlChar(href)) return null;
  if (href.startsWith('#')) return href.length > 1 ? href : null;

  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(href);
  if (schemeMatch) {
    return SAFE_SCHEMES.has(schemeMatch[1].toLowerCase()) ? href : null;
  }

  return href;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
