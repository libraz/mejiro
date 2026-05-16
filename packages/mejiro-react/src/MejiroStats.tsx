import { estimateReadingTime, formatReadingTime } from '@libraz/mejiro/book';
import type { EpubChapter } from '@libraz/mejiro/epub';
import type { ReactNode } from 'react';

/** Props for {@link MejiroStats}. */
export interface MejiroStatsProps {
  /** Chapter currently displayed. */
  chapter: EpubChapter | null;
  /** Total page count for the current layout. */
  totalPages: number;
  /** Most recent layout time in ms. */
  elapsedMs: number;
  /** Optional label for the current font (e.g. "Noto Serif JP 16px"). */
  fontLabel?: string;
  /** Show estimated reading time in the stats line. @defaultValue false */
  showReadingTime?: boolean;
  /** Characters-per-minute used for the reading-time estimate. @defaultValue 600 */
  cpm?: number;
  /** Locale used to format the reading-time label. @defaultValue 'ja' */
  readingTimeLocale?: 'ja' | 'en';
}

/** Compact reading stats line. */
export function MejiroStats({
  chapter,
  totalPages,
  elapsedMs,
  fontLabel,
  showReadingTime = false,
  cpm = 600,
  readingTimeLocale = 'ja',
}: MejiroStatsProps): ReactNode {
  if (!chapter) return <span className="mejiro-reader-stats" />;
  const totalChars = chapter.paragraphs.reduce((s, p) => s + p.text.length, 0);
  const totalRuby = chapter.paragraphs.reduce(
    (s, p) => s + p.inlineAnnotations.filter((a) => a.kind === 'ruby').length,
    0,
  );
  const readingTimeLabel = showReadingTime
    ? formatReadingTime(estimateReadingTime(chapter, { cpm }), readingTimeLocale)
    : null;
  const parts = [
    `${totalChars}ch`,
    `${totalPages}pp`,
    totalRuby > 0 ? `${totalRuby}ruby` : null,
    readingTimeLabel,
    fontLabel || null,
    `${elapsedMs.toFixed(0)}ms`,
  ];
  return <span className="mejiro-reader-stats">{parts.filter(Boolean).join(' / ')}</span>;
}
