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
   * Include heading paragraphs in the character count. Headings are
   * usually short and skim-read; excluding them yields a more conservative
   * estimate. @defaultValue false
   */
  includeHeadings?: boolean;
}

interface ChapterLike {
  paragraphs: readonly BookParagraph[];
}

function countChars(chapter: ChapterLike, includeHeadings: boolean): number {
  let total = 0;
  for (const p of chapter.paragraphs) {
    if (!includeHeadings && p.headingLevel != null) continue;
    total += [...p.text].length;
  }
  return total;
}

/**
 * Estimate the reading time of a chapter in milliseconds.
 *
 * Counts codepoints (via the string iterator), so surrogate pairs do not
 * inflate the total, and applies the configured characters-per-minute rate.
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

/** Format a millisecond duration as `H:MM` or `M分S秒`. */
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
