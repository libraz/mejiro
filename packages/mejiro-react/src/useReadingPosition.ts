import {
  type MejiroStorage,
  parseReadingPosition,
  type ReadingPositionValue,
  serializeReadingPosition,
} from '@libraz/mejiro';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPendingWrite,
  flushOnPageHide,
  readStorage,
  removeStorage,
  resolveDefaultStorage,
} from './persistence.js';

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

/**
 * Persistence helper for reader state. Returns the saved anchor and a
 * throttled saver. Pair with {@link MejiroReaderHandle.goToAnchor} and
 * {@link MejiroReaderHandle.subscribe} for exact reflow-safe restore.
 *
 * ```tsx
 * const { position, save } = useReadingPosition({ key: `mejiro:${bookId}` });
 * const reader = useRef<MejiroReaderHandle>(null);
 *
 * // Restore once per mount: depending on `position` would re-run after every save().
 * useEffect(() => {
 *   if (position) reader.current?.goToAnchor(position);
 * }, []);
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

  const [position, setPosition] = useState<ReadingPositionValue | null>(() =>
    readStorage(storage, key, parseReadingPosition, null),
  );
  const storageRef = useRef(storage);
  storageRef.current = storage;

  const pendingRef = useRef<ReturnType<typeof createPendingWrite> | null>(null);
  if (!pendingRef.current) pendingRef.current = createPendingWrite();
  const pending = pendingRef.current;

  // Closing the tab mid-throttle must not lose the last save().
  useEffect(() => flushOnPageHide(pending.flush), [pending]);

  // Re-hydrate when the key changes (different book). Unmounting or switching
  // book mid-throttle must not lose the last save(), so the pending write —
  // which targets the key it was scheduled under — is flushed on cleanup.
  useEffect(() => {
    setPosition(readStorage(storageRef.current, key, parseReadingPosition, null));
    return pending.flush;
  }, [key, pending]);

  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;

  const save = useCallback(
    (next: ReadingPositionValue) => {
      setPosition(next);
      const currentStorage = storageRef.current;
      if (currentStorage) {
        pending.schedule(() => {
          currentStorage.setItem(key, serializeReadingPosition(next));
        }, throttleMs);
      }
      onChangeRef.current?.(next);
    },
    [key, throttleMs, pending],
  );

  const clear = useCallback(() => {
    setPosition(null);
    pending.cancel();
    removeStorage(storageRef.current, key);
    onChangeRef.current?.(null);
  }, [key, pending]);

  return { position, save, clear };
}
