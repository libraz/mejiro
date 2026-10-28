import type { EpubBook, EpubChapter } from '@libraz/mejiro/epub';

const identities = new WeakMap<object, object>();

/**
 * Tags a derived book (an editor preview copy) with the identity of the book
 * it was copied from, so a reader treats a new copy as an edit rather than a
 * book swap.
 */
export function markBookIdentity<T extends EpubBook>(derived: T, identity: object): T {
  identities.set(derived, identity);
  return derived;
}

/** The identity a book swap is judged by: the tagged source, else the book itself. */
export function bookIdentity<T>(book: T): T | object {
  return (book && identities.get(book as object)) || book;
}

/** Layout-relevant content of a chapter, as a comparable string. */
function chapterContentKey(chapter: EpubChapter): string {
  return JSON.stringify([chapter.title, chapter.paragraphs]);
}

/** The book handed to layout, and what it was derived from. */
export interface LayoutEpubMemo {
  /** Book identity the memo belongs to. */
  book: unknown;
  /** Chapter index the memo belongs to. */
  chapter: number;
  /** Chapter object the key was computed from. */
  source: EpubChapter | undefined;
  /** Content key of that chapter. */
  key: string | null;
  /** The book to lay out. */
  epub: EpubBook | null;
}

/**
 * Keeps the book handed to layout stable while only content outside the shown
 * chapter changes: a re-layout keys off the shown chapter's content, a swap off
 * the book identity.
 */
export function resolveLayoutEpub(
  prev: LayoutEpubMemo | null,
  epub: EpubBook | null,
  book: unknown,
  chapter: number,
): LayoutEpubMemo {
  const source = epub?.chapters[chapter];
  if (prev && prev.book === book && prev.chapter === chapter && prev.source === source) return prev;
  const key = source ? chapterContentKey(source) : null;
  if (prev?.epub && prev.book === book && prev.chapter === chapter && prev.key === key) {
    return { ...prev, source };
  }
  return { book, chapter, source, key, epub };
}
