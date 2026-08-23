import {
  type MejiroStorage,
  parseReadingPosition,
  type ReadingPositionValue,
  serializeReadingPosition,
} from '@libraz/mejiro';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Persisted reading position. Anchor-shaped — pair with
 * {@link MejiroReaderHandle.goToAnchor} to restore the user's exact location
 * even after a reflow that invalidates spread indices.
 */
export type { ReadingPositionValue };

/** Minimal storage interface required by {@link useReadingPosition}. */
export type ReadingPositionStorage = MejiroStorage;

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
  /**
   * Called immediately after `save()` (with the new anchor) or `clear()`
   * (with `null`). Use to mirror the position to a server alongside the
   * local `storage`. Not invoked on initial hydration or `key` changes.
   */
  onChange?: (next: ReadingPositionValue | null) => void;
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

function resolveDefaultStorage(): ReadingPositionStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const w = (globalThis as { localStorage?: ReadingPositionStorage }).localStorage;
  return w ?? null;
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
      return parseReadingPosition(storage.getItem(key));
    } catch {
      return null;
    }
  });
  const storageRef = useRef(storage);
  storageRef.current = storage;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<(() => void) | null>(null);

  /** Runs the pending throttled write immediately, if any. */
  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const write = pendingWriteRef.current;
    pendingWriteRef.current = null;
    if (!write) return;
    try {
      write();
    } catch {
      // Quota, disabled storage, or denied access — keep the in-memory copy.
    }
  }, []);

  /** Drops the pending throttled write without running it. */
  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingWriteRef.current = null;
  }, []);

  // Re-hydrate when the key changes (different book). Unmounting or switching
  // book mid-throttle must not lose the last save(), so the pending write —
  // which targets the key it was scheduled under — is flushed on cleanup.
  useEffect(() => {
    const currentStorage = storageRef.current;
    if (currentStorage) {
      try {
        setPosition(parseReadingPosition(currentStorage.getItem(key)));
      } catch {
        setPosition(null);
      }
    } else {
      setPosition(null);
    }
    return flushPending;
  }, [key, flushPending]);

  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;

  const save = useCallback(
    (next: ReadingPositionValue) => {
      setPosition(next);
      const currentStorage = storageRef.current;
      if (currentStorage) {
        cancelPending();
        pendingWriteRef.current = () => {
          currentStorage.setItem(key, serializeReadingPosition(next));
        };
        timerRef.current = setTimeout(flushPending, throttleMs);
      }
      onChangeRef.current?.(next);
    },
    [key, throttleMs, cancelPending, flushPending],
  );

  const clear = useCallback(() => {
    setPosition(null);
    cancelPending();
    const currentStorage = storageRef.current;
    if (currentStorage) {
      try {
        currentStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    onChangeRef.current?.(null);
  }, [key, cancelPending]);

  return { position, save, clear };
}
