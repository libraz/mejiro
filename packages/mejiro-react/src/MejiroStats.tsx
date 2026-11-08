import type { MejiroLocale } from '@libraz/mejiro';
import { estimateReadingTime, formatReadingTime } from '@libraz/mejiro/book';
import type { EpubChapter } from '@libraz/mejiro/epub';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';
import { useI18n } from './i18n.js';

/** Props for {@link MejiroStats}; other `span` attributes go to the root element. */
export interface MejiroStatsProps extends ComponentPropsWithoutRef<'span'> {
  /** Chapter currently displayed. */
  chapter: EpubChapter | null;
  /** Number of pages in the current layout. */
  pageCount: number;
  /** Most recent layout time in ms. */
  elapsedMs: number;
  /** Optional label for the current font (e.g. "Noto Serif JP 16px"). */
  fontLabel?: string;
  /** Show estimated reading time in the stats line. @defaultValue false */
  showReadingTime?: boolean;
  /** Characters per minute used for the reading-time estimate. @defaultValue 600 */
  charsPerMinute?: number;
  /**
   * Locale whose catalog spells the reading-time units. Defaults to the
   * catalog of the nearest `MejiroI18nProvider`.
   */
  locale?: MejiroLocale;
}

/** Compact reading stats line. */
export const MejiroStats = forwardRef<HTMLSpanElement, MejiroStatsProps>(function MejiroStats(
  {
    chapter,
    pageCount,
    elapsedMs,
    fontLabel,
    showReadingTime = false,
    charsPerMinute = 600,
    locale,
    className,
    ...rest
  },
  ref,
): ReactNode {
  const messages = useI18n(locale != null ? { locale } : {});
  const rootClass = className ? `mejiro-reader-stats ${className}` : 'mejiro-reader-stats';
  if (!chapter) return <span {...rest} ref={ref} className={rootClass} />;
  // Same population as the reading-time estimate shown beside it: codepoints
  // (so surrogate pairs count once) with headings left out.
  const charCount = chapter.paragraphs.reduce(
    (s, p) => (p.headingLevel != null ? s : s + [...p.text].length),
    0,
  );
  const rubyCount = chapter.paragraphs.reduce(
    (s, p) => s + p.inlineAnnotations.filter((a) => a.type === 'ruby').length,
    0,
  );
  const readingTimeLabel = showReadingTime
    ? formatReadingTime(estimateReadingTime(chapter, { charsPerMinute }), { messages })
    : null;
  const parts = [
    `${charCount}ch`,
    `${pageCount}pp`,
    rubyCount > 0 ? `${rubyCount}ruby` : null,
    readingTimeLabel,
    fontLabel || null,
    `${elapsedMs.toFixed(0)}ms`,
  ];
  return (
    <span {...rest} ref={ref} className={rootClass}>
      {parts.filter(Boolean).join(' / ')}
    </span>
  );
});
