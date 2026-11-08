import {
  type MejiroError,
  type MejiroStorage,
  parseReadingPosition,
  type ReadingAnchor,
  serializeReadingPosition,
} from '@libraz/mejiro';
import {
  type MaybeRefOrGetter,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import { nonFatalReporter } from './errors.js';
import {
  createPendingWrite,
  flushOnPageHide,
  readStorage,
  removeStorage,
  resolveDefaultStorage,
  writeStorage,
} from './persistence.js';

/** Options for {@link useReadingPosition}. */
export interface UseReadingPositionOptions {
  /**
   * Storage key — usually scoped per-book (e.g. `mejiro:position:${bookId}`).
   * A ref or getter re-hydrates the position when the key changes; a plain
   * string is read once.
   */
  key: MaybeRefOrGetter<string>;
  /**
   * Storage backend. Defaults to `window.localStorage` when available.
   * SSR consumers can omit this and the composable will fall back to in-memory.
   */
  storage?: MejiroStorage;
  /**
   * Debounce delay (ms): the latest value is written this long after the last
   * change. A pending write is flushed on page hide, key change and scope
   * dispose. @defaultValue 250
   */
  debounceMs?: number;
  /**
   * Called immediately after `save()` (with the new anchor) or `clear()`
   * (with `null`). Use to mirror the position to a server alongside the
   * local `storage`. Not invoked on initial hydration or `key` changes.
   */
  onPositionChange?: (next: ReadingAnchor | null) => void;
  /**
   * Called when the storage throws (`storage-read-failed` /
   * `storage-write-failed`) or holds data that cannot be read back
   * (`storage-corrupt`). The position stays usable in memory; unreadable data
   * is left in place until the next `save()` overwrites it. Without it the
   * failure goes to `console.warn`.
   */
  onError?: (error: MejiroError) => void;
}

/** Return value of {@link useReadingPosition}. */
export interface UseReadingPositionReturn {
  /** Most recently persisted position, or `null` if none. Change it through `save` / `clear`. */
  position: Readonly<Ref<ReadingAnchor | null>>;
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
 * Every stored layout {@link parseReadingPosition} reads is accepted; a stored
 * position that only names a chapter resumes at the start of that chapter.
 */
export function useReadingPosition(options: UseReadingPositionOptions): UseReadingPositionReturn {
  const { debounceMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();
  const report = nonFatalReporter(options.onError);
  let key = toValue(options.key);

  const position = shallowRef<ReadingAnchor | null>(
    readStorage(storage, key, parseReadingPosition, null, report),
  );
  const pending = createPendingWrite();

  watch(
    () => toValue(options.key),
    (next) => {
      // A write scheduled under the previous key must land there, not in the new book's slot.
      pending.flush();
      key = next;
      position.value = readStorage(storage, next, parseReadingPosition, null, report);
    },
  );

  function save(next: ReadingAnchor): void {
    position.value = next;
    if (storage) {
      const keyAtSave = key;
      pending.schedule(() => {
        writeStorage(storage, keyAtSave, serializeReadingPosition(next), report);
      }, debounceMs);
    }
    options.onPositionChange?.(next);
  }

  function clear(): void {
    position.value = null;
    pending.cancel();
    removeStorage(storage, key, report);
    options.onPositionChange?.(null);
  }

  // Closing the tab or disposing the scope mid-debounce must not lose the last save().
  const detachPageHide = flushOnPageHide(pending.flush);
  onScopeDispose(() => {
    detachPageHide();
    pending.flush();
  });

  return { position: shallowReadonly(position), save, clear };
}
