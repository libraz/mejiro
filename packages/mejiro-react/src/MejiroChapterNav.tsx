import type { EpubBook } from '@libraz/mejiro/epub';
import type { ReactNode } from 'react';
import { format, useI18n } from './i18n.js';

export type MejiroChapterNavVariant = 'select' | 'panel';

/** Props for {@link MejiroChapterNav}. */
export interface MejiroChapterNavProps {
  /** EPUB to list chapters from. */
  epub: EpubBook;
  /** Current chapter index. */
  chapter: number;
  /** Called when a new chapter is picked. */
  onChange: (chapter: number) => void;
  /** Visual treatment for the chapter list. @defaultValue 'select' */
  variant?: MejiroChapterNavVariant;
}

function textPreview(text: string, max = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

/**
 * Chapter selector for an {@link EpubBook}.
 *
 * @deprecated Prefer {@link MejiroToc} for new code. `MejiroToc` adds
 * search and current-anchor highlighting and renders the same data with a
 * more accessible markup. `MejiroChapterNav` remains supported for the
 * `<select>` variant and existing `MejiroReader` integration.
 */
export function MejiroChapterNav({
  epub,
  chapter,
  onChange,
  variant = 'select',
}: MejiroChapterNavProps): ReactNode {
  const messages = useI18n();
  if (variant === 'panel') {
    return (
      <nav className="mejiro-reader-chapter-panel" aria-label={messages.tocTitle}>
        <div className="mejiro-reader-chapter-panel-head">
          <span className="mejiro-reader-chapter-panel-kicker">{messages.tocTitle}</span>
          <strong>{epub.title}</strong>
          {epub.author && <span>{epub.author}</span>}
        </div>
        <ol className="mejiro-reader-chapter-list">
          {epub.chapters.map((ch, i) => {
            const title = ch.title ?? format(messages.chapterN, { n: i + 1 });
            const preview = ch.paragraphs.find((p) => !p.headingLevel && p.text.trim())?.text;
            const chapterKey = `${title}-${ch.paragraphs
              .map((p) => p.text)
              .join('|')
              .slice(0, 120)}`;
            const headings = ch.paragraphs
              .filter((p) => p.headingLevel && p.text.trim() && p.text.trim() !== title)
              .slice(0, 3);
            return (
              <li key={chapterKey} className="mejiro-reader-chapter-list-item">
                <button
                  type="button"
                  className={`mejiro-reader-chapter-card${i === chapter ? ' is-active' : ''}`}
                  aria-current={i === chapter ? 'true' : undefined}
                  onClick={() => onChange(i)}
                >
                  <span className="mejiro-reader-chapter-number">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="mejiro-reader-chapter-main">
                    <span className="mejiro-reader-chapter-title">{title}</span>
                    {preview && (
                      <span className="mejiro-reader-chapter-preview">{textPreview(preview)}</span>
                    )}
                    {headings.length > 0 && (
                      <span className="mejiro-reader-chapter-subheads">
                        {headings.map((heading) => (
                          <span key={heading.text}>{textPreview(heading.text, 30)}</span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }

  return (
    <div className="mejiro-reader-chapter-nav">
      <select value={chapter} onChange={(e) => onChange(Number(e.target.value))}>
        {epub.chapters.map((ch, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: chapter titles are not guaranteed unique
          <option key={i} value={i}>
            {ch.title ?? format(messages.chapterN, { n: i + 1 })}
          </option>
        ))}
      </select>
    </div>
  );
}
