/**
 * ZIP-path and manifest helpers shared by the EPUB editor and project exporters,
 * so both authoring paths resolve paths, ids and media types the same way.
 */

/**
 * Returns `target` as a path relative to the directory `fromDir`.
 *
 * @param fromDir - ZIP directory the result is resolved against.
 * @param target - ZIP path of the referenced file.
 */
export function relativeZipPath(fromDir: string, target: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const to = target.split('/').filter(Boolean);
  while (from.length > 0 && to.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return `${'../'.repeat(from.length)}${to.join('/')}`;
}

/**
 * Percent-encodes a ZIP path for use as a manifest href or `src`, so that
 * decoding it against the same base (as `resolveZipPath` does) yields the path
 * again. Only characters that are not valid in a URL path, or that would
 * change its meaning, are escaped.
 *
 * @param path - Unencoded ZIP path, absolute or relative.
 */
export function zipPathToHref(path: string): string {
  return path.replace(/[%:#?"<>[\\\]^`{|}\s\p{Cc}]/gu, (ch) => encodeURIComponent(ch));
}

/**
 * Returns `base`, or `base-N` with the smallest free `N >= 2` when `base` is
 * already among `existing`.
 *
 * @param base - Preferred manifest id.
 * @param existing - Ids already in use; empty entries are ignored.
 */
export function uniqueManifestId(base: string, existing: readonly (string | undefined)[]): string {
  const used = new Set(existing.filter((id): id is string => Boolean(id)));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

/**
 * Infers a manifest media type from a file path's extension, falling back to
 * `application/octet-stream`.
 *
 * @param path - File name or ZIP path.
 */
export function mediaTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}
