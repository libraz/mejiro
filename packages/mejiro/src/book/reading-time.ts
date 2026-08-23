import type { BookParagraph } from './types.js';

/** Options for {@link estimateReadingTime}. */
export interface ReadingTimeOptions {
  /**
   * Characters-per-minute reading rate. Defaults to 600 — a commonly cited
   * average for Japanese text. Override for slow / fast readers or for
   * languages with different unit sizes.
   */
  cpm?: number;
  /**
   * Include heading paragraphs in the character count. A paragraph counts as a
   * heading when {@link isHeadingParagraph} says so, i.e. it carries a
   * `headingLevel` or is classified as `kind: 'heading'`. Headings are usually
   * short and skim-read; excluding them yields a more conservative estimate.
   * @defaultValue false
   */
  includeHeadings?: boolean;
}

/**
 * Minimal chapter shape {@link estimateReadingTime} needs.
 *
 * Structural on purpose: an `EpubChapter`, a `ChapterLayout` source chapter or
 * a bare object literal all satisfy it, so the estimate can be taken before a
 * chapter has been laid out.
 */
export interface ChapterLike {
  /** Paragraphs whose characters are counted, headings included or not per options. */
  paragraphs: readonly BookParagraph[];
}

/**
 * @internal Canonical "is this paragraph a heading?" predicate for the book
 * module. A paragraph is a heading when it carries a `headingLevel` or is
 * structurally classified as `kind: 'heading'`; every consumer that partitions
 * paragraphs into headings and body text must use this predicate so the two
 * markers never disagree.
 */
export function isHeadingParagraph(p: Pick<BookParagraph, 'headingLevel' | 'kind'>): boolean {
  return p.headingLevel != null || p.kind === 'heading';
}

function countChars(chapter: ChapterLike, includeHeadings: boolean): number {
  let total = 0;
  for (const p of chapter.paragraphs) {
    if (!includeHeadings && isHeadingParagraph(p)) continue;
    total += [...p.text].length;
  }
  return total;
}

/**
 * Estimate the reading time of a chapter in milliseconds.
 *
 * Counts codepoints (via the string iterator), so surrogate pairs do not
 * inflate the total, and applies the configured characters-per-minute rate.
 * Heading paragraphs ({@link isHeadingParagraph}) are excluded unless
 * {@link ReadingTimeOptions.includeHeadings} is set.
 */
export function estimateReadingTime(
  chapter: ChapterLike,
  options: ReadingTimeOptions = {},
): number {
  const cpm = options.cpm ?? 600;
  if (cpm <= 0) return 0;
  const chars = countChars(chapter, options.includeHeadings ?? false);
  return Math.round((chars / cpm) * 60_000);
}

/** Format a millisecond duration as compact Japanese or English text. */
export function formatReadingTime(ms: number, locale: 'ja' | 'en' = 'ja'): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (locale === 'en') {
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
  if (hours > 0) return `${hours}時間${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds > 0 ? `${seconds}秒` : ''}`;
  return `${seconds}秒`;
}
