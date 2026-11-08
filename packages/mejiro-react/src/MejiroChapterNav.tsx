import type { EpubBook } from '@libraz/mejiro/epub';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode, type Ref } from 'react';
import { formatMessage, useI18n } from './i18n.js';

/**
 * Layout of {@link MejiroChapterNav}: `'select'` is a compact dropdown,
 * `'panel'` a chapter list with titles, headings and a text preview.
 */
export type MejiroChapterNavVariant = 'select' | 'panel';

/** Props for {@link MejiroChapterNav}; other `div` attributes go to the root element. */
export interface MejiroChapterNavProps extends ComponentPropsWithoutRef<'div'> {
  /** EPUB to list chapters from. */
  epub: EpubBook;
  /** Zero-based index of the chapter shown as current. */
  chapterIndex: number;
  /** Called with the zero-based index of the chapter the user picks. */
  onChapterIndexChange: (chapterIndex: number) => void;
  /** Visual treatment for the chapter list. @defaultValue 'select' */
  variant?: MejiroChapterNavVariant;
}

function textPreview(text: string, max = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

/**
 * Chapter picker for an {@link EpubBook}: a compact `<select>`, or a panel
 * listing each chapter with its sub-headings and a text preview. For a
 * searchable table of contents that follows the reading anchor, use
 * {@link MejiroToc}.
 */
export const MejiroChapterNav = forwardRef<HTMLElement, MejiroChapterNavProps>(
  function MejiroChapterNav(
    { epub, chapterIndex, onChapterIndexChange, variant = 'select', className, ...rest },
    ref,
  ): ReactNode {
    const messages = useI18n();
    if (variant === 'panel') {
      return (
        <nav
          aria-label={messages.tocTitle}
          {...rest}
          ref={ref}
          className={
            className ? `mejiro-reader-chapter-panel ${className}` : 'mejiro-reader-chapter-panel'
          }
        >
          <div className="mejiro-reader-chapter-panel-head">
            <span className="mejiro-reader-chapter-panel-kicker">{messages.tocTitle}</span>
            <strong>{epub.title}</strong>
            {epub.author && <span>{epub.author}</span>}
          </div>
          <ol className="mejiro-reader-chapter-list">
            {epub.chapters.map((ch, i) => {
              const title = ch.title ?? formatMessage(messages.chapterN, { n: i + 1 });
              const preview = ch.paragraphs.find((p) => !p.headingLevel && p.text.trim())?.text;
              // Keyed by paragraph index: heading text can repeat within a chapter.
              const headings = ch.paragraphs
                .flatMap((p, paragraph) =>
                  p.headingLevel && p.text.trim() && p.text.trim() !== title
                    ? [{ paragraph, text: p.text }]
                    : [],
                )
                .slice(0, 3);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: chapter titles and text are not guaranteed unique
                <li key={i} className="mejiro-reader-chapter-list-item">
                  <button
                    type="button"
                    className={`mejiro-reader-chapter-card${i === chapterIndex ? ' is-active' : ''}`}
                    aria-current={i === chapterIndex ? 'true' : undefined}
                    onClick={() => onChapterIndexChange(i)}
                  >
                    <span className="mejiro-reader-chapter-number">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="mejiro-reader-chapter-main">
                      <span className="mejiro-reader-chapter-title">{title}</span>
                      {preview && (
                        <span className="mejiro-reader-chapter-preview">
                          {textPreview(preview)}
                        </span>
                      )}
                      {headings.length > 0 && (
                        <span className="mejiro-reader-chapter-subheads">
                          {headings.map((heading) => (
                            <span key={heading.paragraph}>{textPreview(heading.text, 30)}</span>
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
      <div
        {...rest}
        ref={ref as Ref<HTMLDivElement>}
        className={
          className ? `mejiro-reader-chapter-nav ${className}` : 'mejiro-reader-chapter-nav'
        }
      >
        <select value={chapterIndex} onChange={(e) => onChapterIndexChange(Number(e.target.value))}>
          {epub.chapters.map((ch, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: chapter titles are not guaranteed unique
            <option key={i} value={i}>
              {ch.title ?? formatMessage(messages.chapterN, { n: i + 1 })}
            </option>
          ))}
        </select>
      </div>
    );
  },
);
