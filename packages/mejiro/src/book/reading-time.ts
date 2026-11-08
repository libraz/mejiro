import { formatMessage, jaMessages, type MejiroMessages } from '../i18n.js';
import { isHeadingParagraph } from '../render/measures.js';
import type { ChapterSource } from '../types.js';

export { isHeadingParagraph };

/** Options for {@link estimateReadingTime}. */
export interface ReadingTimeOptions {
  /**
   * Reading rate in characters per minute. Override for slow / fast readers
   * or for languages with different unit sizes; zero or a negative rate
   * estimates zero.
   * @defaultValue 600, a commonly cited average for Japanese text
   */
  charsPerMinute?: number;
  /**
   * Include heading paragraphs in the character count. A paragraph counts as a
   * heading when {@link isHeadingParagraph} says so, i.e. it carries a
   * `headingLevel` or is classified as `kind: 'heading'`. Headings are usually
   * short and skim-read; excluding them yields a more conservative estimate.
   * @defaultValue false
   */
  includeHeadings?: boolean;
}

/** Options for {@link formatReadingTime}. */
export interface FormatReadingTimeOptions {
  /**
   * Catalog whose `readingTime*` templates spell the units.
   * @defaultValue {@link jaMessages}
   */
  messages?: MejiroMessages;
}

function countChars(chapter: ChapterSource, includeHeadings: boolean): number {
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
  chapter: ChapterSource,
  options: ReadingTimeOptions = {},
): number {
  const charsPerMinute = options.charsPerMinute ?? 600;
  if (charsPerMinute <= 0) return 0;
  const chars = countChars(chapter, options.includeHeadings ?? false);
  return Math.round((chars / charsPerMinute) * 60_000);
}

/**
 * Format a millisecond duration as compact text, rounded to whole seconds.
 *
 * Picks one of the catalog's templates: `readingTimeHoursMinutes` from one
 * hour up, `readingTimeMinutesSeconds` or (on a whole minute)
 * `readingTimeMinutes` from one minute up, and `readingTimeSeconds` below it.
 */
export function formatReadingTime(ms: number, options: FormatReadingTimeOptions = {}): string {
  const messages = options.messages ?? jaMessages;
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return formatMessage(messages.readingTimeHoursMinutes, { hours, minutes });
  if (minutes > 0) {
    return seconds > 0
      ? formatMessage(messages.readingTimeMinutesSeconds, { minutes, seconds })
      : formatMessage(messages.readingTimeMinutes, { minutes });
  }
  return formatMessage(messages.readingTimeSeconds, { seconds });
}
