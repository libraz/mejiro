import type { ReadingAnchor } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { type ReactNode, useMemo, useState } from 'react';
import { format, type MejiroMessages, useI18n } from './i18n.js';

/** Props for {@link MejiroToc}. */
export interface MejiroTocProps {
  /** EPUB whose chapter list is rendered. */
  epub: EpubBook;
  /** Current reading anchor; the matching chapter is highlighted. */
  currentAnchor?: ReadingAnchor | null;
  /** Show a search input that filters chapter titles. @defaultValue false */
  searchable?: boolean;
  /** Heading displayed above the list. @defaultValue 'Contents' */
  title?: string;
  /** Placeholder shown in the search input. @defaultValue 'Search chapters…' */
  searchPlaceholder?: string;
  /** Called when the user picks a chapter. */
  onSelect?: (chapter: number) => void;
}

interface ChapterEntry {
  index: number;
  title: string;
  headings: string[];
}

function buildEntries(epub: EpubBook, messages: MejiroMessages): ChapterEntry[] {
  return epub.chapters.map((ch, i) => {
    const title = ch.title ?? format(messages.chapterN, { n: i + 1 });
    const headings = ch.paragraphs
      .filter((p) => p.headingLevel && p.text.trim() && p.text.trim() !== title)
      .map((p) => p.text.trim());
    return { index: i, title, headings };
  });
}

/**
 * Searchable, current-anchor-aware table of contents. Long-form replacement
 * for {@link MejiroChapterNav}. Supersedes the older `MejiroChapterNav`
 * for new code — the panel variant remains for backwards compatibility.
 */
export function MejiroToc({
  epub,
  currentAnchor,
  searchable = false,
  title,
  searchPlaceholder,
  onSelect,
}: MejiroTocProps): ReactNode {
  const messages = useI18n();
  const resolvedTitle = title ?? messages.tocTitle;
  const resolvedSearchPlaceholder = searchPlaceholder ?? messages.tocSearchPlaceholder;
  const [query, setQuery] = useState('');
  const entries = useMemo(() => buildEntries(epub, messages), [epub, messages]);
  const filtered = useMemo(() => {
    if (!query) return entries;
    const needle = query.toLowerCase();
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        e.headings.some((h) => h.toLowerCase().includes(needle)),
    );
  }, [entries, query]);
  const activeIndex = currentAnchor?.chapter ?? -1;

  return (
    <nav className="mejiro-toc" aria-label={resolvedTitle}>
      <header className="mejiro-toc-header">
        <span className="mejiro-toc-title">{resolvedTitle}</span>
        {epub.author && <span className="mejiro-toc-subtitle">{epub.author}</span>}
      </header>
      {searchable && (
        <div className="mejiro-toc-search">
          <input
            type="search"
            value={query}
            placeholder={resolvedSearchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={resolvedSearchPlaceholder}
          />
        </div>
      )}
      <ol className="mejiro-toc-list">
        {filtered.map((entry) => (
          <li key={entry.index} className="mejiro-toc-item">
            <button
              type="button"
              className={`mejiro-toc-link${entry.index === activeIndex ? ' is-active' : ''}`}
              aria-current={entry.index === activeIndex ? 'true' : undefined}
              onClick={() => onSelect?.(entry.index)}
            >
              <span className="mejiro-toc-num">{String(entry.index + 1).padStart(2, '0')}</span>
              <span className="mejiro-toc-label">{entry.title}</span>
            </button>
            {entry.headings.length > 0 && (
              <ul className="mejiro-toc-subheads">
                {entry.headings.slice(0, 5).map((h) => (
                  <li key={h} className="mejiro-toc-subhead">
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {filtered.length === 0 && (
        <div className="mejiro-toc-empty" role="status">
          {format(messages.tocEmpty, { query })}
        </div>
      )}
    </nav>
  );
}
