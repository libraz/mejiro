import type { ReadingAnchor } from '@libraz/mejiro/book';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Persisted reading position. Anchor-shaped — pair with
 * {@link MejiroReaderHandle.goToAnchor} to restore the user's exact location
 * even after a reflow that invalidates spread indices.
 */
export type ReadingPositionValue = ReadingAnchor;

/** Minimal storage interface required by {@link useReadingPosition}. */
export interface ReadingPositionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Options for {@link useReadingPosition}. */
export interface UseReadingPositionOptions {
  /** Storage key — usually scoped per-book (e.g. `mejiro:position:${bookId}`). */
  key: string;
  /**
   * Storage backend. Defaults to `window.localStorage` when available.
   * SSR consumers can omit this and the hook will fall back to in-memory.
   */
  storage?: ReadingPositionStorage;
  /** Throttle ms between writes. @defaultValue 250 */
  throttleMs?: number;
}

/** Return value of {@link useReadingPosition}. */
export interface UseReadingPositionReturn {
  /** Most recently persisted position, or `null` if none. */
  position: ReadingPositionValue | null;
  /** Persist a new position (throttled). */
  save(next: ReadingPositionValue): void;
  /** Remove the persisted position. */
  clear(): void;
}

const STORAGE_VERSION = 2;

interface PersistedV2 {
  version: 2;
  chapter: number;
  paragraph: number;
  charIndex: number;
}

interface LegacyV1 {
  chapter: number;
  spreadIdx: number;
}

function resolveDefaultStorage(): ReadingPositionStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const w = (globalThis as { localStorage?: ReadingPositionStorage }).localStorage;
  return w ?? null;
}

function parsePosition(raw: string | null): ReadingPositionValue | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<PersistedV2 & LegacyV1>;
  if (typeof p.chapter !== 'number') return null;
  if (p.version === STORAGE_VERSION) {
    if (typeof p.paragraph !== 'number' || typeof p.charIndex !== 'number') return null;
    return { chapter: p.chapter, paragraph: p.paragraph, charIndex: p.charIndex };
  }
  // Legacy v1 — {chapter, spreadIdx}. Migrate by keeping `chapter` and dropping
  // the spread index (it is unreliable after reflow). The caller should treat
  // the position as the start of the chapter.
  if (typeof p.spreadIdx === 'number') {
    // biome-ignore lint/suspicious/noConsole: intentional one-time migration notice
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      // biome-ignore lint/suspicious/noConsole: intentional one-time migration notice
      console.warn(
        '[mejiro] useReadingPosition: migrating legacy {chapter, spreadIdx} format. ' +
          'spreadIdx has been dropped because it does not survive reflow; the position ' +
          'now resumes at the start of the chapter. Persist new positions via save() to upgrade.',
      );
    }
    return { chapter: p.chapter, paragraph: 0, charIndex: 0 };
  }
  return null;
}

function serializePosition(value: ReadingPositionValue): string {
  const payload: PersistedV2 = {
    version: STORAGE_VERSION,
    chapter: value.chapter,
    paragraph: value.paragraph,
    charIndex: value.charIndex,
  };
  return JSON.stringify(payload);
}

/**
 * Persistence helper for reader state. Returns the saved anchor and a
 * throttled saver. Pair with {@link MejiroReaderHandle.goToAnchor} and
 * {@link MejiroReaderHandle.subscribe} for exact reflow-safe restore.
 *
 * ```tsx
 * const { position, save } = useReadingPosition({ key: `mejiro:${bookId}` });
 * const reader = useRef<MejiroReaderHandle>(null);
 *
 * useEffect(() => {
 *   if (position) reader.current?.goToAnchor(position);
 * }, [position]);
 *
 * useEffect(() => {
 *   const off = reader.current?.subscribe('spreadChanged', () => {
 *     const anchor = reader.current?.getAnchor();
 *     if (anchor) save(anchor);
 *   });
 *   return off;
 * }, [save]);
 * ```
 *
 * Legacy `{ chapter, spreadIdx }` JSON from v0.4 is migrated automatically:
 * the chapter is preserved, `spreadIdx` is dropped (it does not survive
 * reflow), and the position is treated as the start of the chapter.
 */
export function useReadingPosition(options: UseReadingPositionOptions): UseReadingPositionReturn {
  const { key, throttleMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();

  const [position, setPosition] = useState<ReadingPositionValue | null>(() => {
    if (!storage) return null;
    try {
      return parsePosition(storage.getItem(key));
    } catch {
      return null;
    }
  });

  // Re-hydrate when the key changes (different book).
  useEffect(() => {
    if (!storage) {
      setPosition(null);
      return;
    }
    try {
      setPosition(parsePosition(storage.getItem(key)));
    } catch {
      setPosition(null);
    }
  }, [storage, key]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const save = useCallback(
    (next: ReadingPositionValue) => {
      setPosition(next);
      if (!storage) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          storage.setItem(key, serializePosition(next));
        } catch {
          // Quota, disabled storage, or denied access — keep the in-memory copy.
        }
      }, throttleMs);
    },
    [storage, key, throttleMs],
  );

  const clear = useCallback(() => {
    setPosition(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (storage) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }, [storage, key]);

  return { position, save, clear };
}
