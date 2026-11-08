import {
  type MejiroError,
  type MejiroStorage,
  parseReadingPosition,
  type ReadingAnchor,
  serializeReadingPosition,
} from '@libraz/mejiro';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPendingWrite,
  flushOnPageHide,
  type HydratedValue,
  hydrateStorage,
  removeStorage,
  reportStorageError,
  resolveDefaultStorage,
  storageWriteError,
} from './persistence.js';

/** Options for {@link useReadingPosition}. */
export interface UseReadingPositionOptions {
  /** Storage key — usually scoped per-book (e.g. `mejiro:position:${bookId}`). */
  key: string;
  /**
   * Storage backend. Defaults to `window.localStorage` when available.
   * SSR consumers can omit this and the hook will fall back to in-memory.
   */
  storage?: MejiroStorage;
  /**
   * Debounce delay (ms): the latest value is written this long after the last
   * change. A pending write is flushed on page hide, key change and unmount.
   * @defaultValue 250
   */
  debounceMs?: number;
  /**
   * Called immediately after `save()` (with the new anchor) or `clear()`
   * (with `null`). Use to mirror the position to a server alongside the
   * local `storage`. Not invoked on initial hydration or `key` changes.
   */
  onPositionChange?: (next: ReadingAnchor | null) => void;
  /**
   * Receives a storage failure: `storage-read-failed` or `storage-corrupt` when
   * hydrating (the position starts as `null`, and the stored value is left
   * alone until the next `save()`), `storage-write-failed` when a write or
   * removal throws (the in-memory position is kept). Without it the error goes
   * to `console.warn`.
   */
  onError?: (error: MejiroError) => void;
}

/** Return value of {@link useReadingPosition}. */
export interface UseReadingPositionReturn {
  /** Most recently persisted position, or `null` if none. */
  position: ReadingAnchor | null;
  /** Persist a new position (debounced by `debounceMs`). */
  save(next: ReadingAnchor): void;
  /** Remove the persisted position. */
  clear(): void;
}

/**
 * Persistence helper for reader state. Returns the saved anchor and a
 * debounced saver. Pair with {@link MejiroReaderHandle.goToAnchor} and
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
 * Every stored layout {@link parseReadingPosition} reads is accepted; one
 * that names only a chapter and a spread resumes at the start of the chapter,
 * because a spread index does not survive reflow.
 */
export function useReadingPosition(options: UseReadingPositionOptions): UseReadingPositionReturn {
  const { key, debounceMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();

  const storageRef = useRef(storage);
  storageRef.current = storage;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const report = useCallback(
    (error: MejiroError) => reportStorageError(onErrorRef.current, error),
    [],
  );

  // The value is kept with the key it was read for, so a key change is
  // re-hydrated in the same render instead of one commit late.
  const [hydrated, setHydrated] = useState<HydratedValue<ReadingAnchor | null>>(() =>
    hydrateStorage(storage, key, parseReadingPosition, null),
  );
  let position = hydrated.value;
  if (hydrated.key !== key) {
    const next = hydrateStorage(storage, key, parseReadingPosition, null);
    position = next.value;
    setHydrated(next);
  }

  // A failed read is reported once, after the render that made it commits.
  const reportedRef = useRef<HydratedValue<ReadingAnchor | null> | null>(null);
  useEffect(() => {
    if (!hydrated.error || reportedRef.current === hydrated) return;
    reportedRef.current = hydrated;
    report(hydrated.error);
  }, [hydrated, report]);

  // Key of the write in flight, so a failure names the slot it targeted.
  const writeKeyRef = useRef(key);
  const pendingRef = useRef<ReturnType<typeof createPendingWrite> | null>(null);
  if (!pendingRef.current) {
    pendingRef.current = createPendingWrite((cause) =>
      report(storageWriteError(writeKeyRef.current, cause)),
    );
  }
  const pending = pendingRef.current;

  // Closing the tab mid-debounce must not lose the last save().
  useEffect(() => flushOnPageHide(pending.flush), [pending]);

  // Unmounting or switching book mid-debounce must not lose the last save(), so
  // the pending write — which targets the key it was scheduled under — is
  // flushed on cleanup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger — each key change runs the previous cleanup.
  useEffect(() => pending.flush, [key, pending]);

  const onChangeRef = useRef(options.onPositionChange);
  onChangeRef.current = options.onPositionChange;

  const save = useCallback(
    (next: ReadingAnchor) => {
      setHydrated({ key, value: next, error: null });
      const currentStorage = storageRef.current;
      if (currentStorage) {
        pending.schedule(() => {
          writeKeyRef.current = key;
          currentStorage.setItem(key, serializeReadingPosition(next));
        }, debounceMs);
      }
      onChangeRef.current?.(next);
    },
    [key, debounceMs, pending],
  );

  const clear = useCallback(() => {
    setHydrated({ key, value: null, error: null });
    pending.cancel();
    removeStorage(storageRef.current, key, report);
    onChangeRef.current?.(null);
  }, [key, pending, report]);

  return { position, save, clear };
}
