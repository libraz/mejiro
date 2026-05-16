import type { ReactNode } from 'react';
import { useI18n } from './i18n.js';
import type { VolumeInfo } from './useLibrary.js';

/** Props for {@link MejiroShelf}. */
export interface MejiroShelfProps<T = unknown> {
  /** Volumes to display. */
  volumes: readonly VolumeInfo<T>[];
  /** ID of the currently active volume (highlighted in the grid). */
  currentId?: string;
  /** Called when the user picks a volume. */
  onSelect?: (volume: VolumeInfo<T>) => void;
  /** Heading shown above the grid. @defaultValue 'Library' */
  title?: string;
}

/**
 * Visual bookshelf picker. Renders each volume as a card with cover, label,
 * and author. Pair with {@link useLibrary} to drive selection.
 */
export function MejiroShelf<T = unknown>({
  volumes,
  currentId,
  onSelect,
  title,
}: MejiroShelfProps<T>): ReactNode {
  const messages = useI18n();
  const resolvedTitle = title ?? messages.shelfTitle;
  return (
    <section className="mejiro-shelf" aria-label={resolvedTitle}>
      <header className="mejiro-shelf-header">
        <span className="mejiro-shelf-title">{resolvedTitle}</span>
      </header>
      <ul className="mejiro-shelf-grid">
        {volumes.map((v) => (
          <li key={v.id} className="mejiro-shelf-item">
            <button
              type="button"
              className={`mejiro-shelf-card${v.id === currentId ? ' is-active' : ''}`}
              onClick={() => onSelect?.(v)}
            >
              {v.cover ? (
                <span
                  className="mejiro-shelf-cover"
                  style={{ backgroundImage: `url(${JSON.stringify(v.cover)})` }}
                  aria-hidden="true"
                />
              ) : (
                <span className="mejiro-shelf-cover mejiro-shelf-cover--blank" aria-hidden="true" />
              )}
              <span className="mejiro-shelf-meta">
                <span className="mejiro-shelf-label">{v.label}</span>
                {v.author && <span className="mejiro-shelf-author">{v.author}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
