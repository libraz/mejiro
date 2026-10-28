/**
 * Which pages of a spread print their page number: `'both'` (right = odd,
 * left = even), only `'right'`, only `'left'`, or `'none'`.
 */
export type PageNumberDisplay = 'both' | 'right' | 'left' | 'none';

/**
 * Returns the number the running head of the page at zero-based `pageIdx`
 * prints, or `null` when `pageNumbers` hides it.
 *
 * Even indices are right-hand pages and odd indices left-hand pages, so
 * paginated and scroll readers show a number on exactly the same pages.
 *
 * @param pageNumbers - Which side(s) print their number.
 * @param pageIdx - Zero-based page index within the chapter.
 * @returns The one-based page number, or `null` when hidden.
 */
export function pageNumberFor(pageNumbers: PageNumberDisplay, pageIdx: number): number | null {
  const side = pageIdx % 2 === 0 ? 'right' : 'left';
  return pageNumbers === 'both' || pageNumbers === side ? pageIdx + 1 : null;
}
