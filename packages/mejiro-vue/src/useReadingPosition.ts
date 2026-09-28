import {
  type MejiroStorage,
  parseReadingPosition,
  type ReadingPositionValue,
  serializeReadingPosition,
} from '@libraz/mejiro';
import { onScopeDispose, type Ref, ref, watch } from 'vue';
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
  /**
   * Storage key — usually scoped per-book (e.g. `mejiro:position:${bookId}`).
   * A `Ref` (or a reactive getter property) re-hydrates the position when the
   * key changes; a plain string is read once.
   */
  key: Ref<string> | string;
  /**
   * Storage backend. Defaults to `window.localStorage` when available.
   * SSR consumers can omit this and the composable will fall back to in-memory.
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
  position: Ref<ReadingPositionValue | null>;
  /** Persist a new position (throttled). */
  save(next: ReadingPositionValue): void;
  /** Remove the persisted position. */
  clear(): void;
}

function unwrapKey(key: Ref<string> | string): string {
  return typeof key === 'string' ? key : key.value;
}

/**
 * Persistence helper for reader state. Returns the saved anchor and a
 * throttled saver. Pair with {@link MejiroReaderHandle.goToAnchor} and
 * {@link MejiroReaderHandle.subscribe} for exact reflow-safe restore.
 *
 * Legacy `{ chapter, spreadIdx }` JSON from v0.4 is migrated automatically:
 * the chapter is preserved, `spreadIdx` is dropped (it does not survive
 * reflow), and the position is treated as the start of the chapter.
 */
export function useReadingPosition(options: UseReadingPositionOptions): UseReadingPositionReturn {
  const { throttleMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();
  const keyRef = ref(unwrapKey(options.key));

  const position = ref<ReadingPositionValue | null>(
    readStorage(storage, keyRef.value, parseReadingPosition, null),
  );
  const pending = createPendingWrite();

  watch(
    () => unwrapKey(options.key),
    (k) => {
      // A write scheduled under the previous key must land there, not in the new book's slot.
      pending.flush();
      keyRef.value = k;
      position.value = readStorage(storage, k, parseReadingPosition, null);
    },
  );

  function save(next: ReadingPositionValue): void {
    position.value = next;
    if (storage) {
      const keyAtSave = keyRef.value;
      pending.schedule(() => {
        storage.setItem(keyAtSave, serializeReadingPosition(next));
      }, throttleMs);
    }
    options.onChange?.(next);
  }

  function clear(): void {
    position.value = null;
    pending.cancel();
    removeStorage(storage, keyRef.value);
    options.onChange?.(null);
  }

  // Closing the tab or disposing the scope mid-throttle must not lose the last save().
  const detachPageHide = flushOnPageHide(pending.flush);
  onScopeDispose(() => {
    detachPageHide();
    pending.flush();
  });

  return { position, save, clear };
}
