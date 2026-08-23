import {
  type MejiroStorage,
  parseReadingPosition,
  type ReadingPositionValue,
  serializeReadingPosition,
} from '@libraz/mejiro';
import { onScopeDispose, type Ref, ref, watch } from 'vue';

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

function resolveDefaultStorage(): ReadingPositionStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const w = (globalThis as { localStorage?: ReadingPositionStorage }).localStorage;
  return w ?? null;
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

  const position = ref<ReadingPositionValue | null>(null);

  function hydrate(currentKey: string): void {
    if (!storage) {
      position.value = null;
      return;
    }
    try {
      position.value = parseReadingPosition(storage.getItem(currentKey));
    } catch {
      position.value = null;
    }
  }
  hydrate(keyRef.value);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingWrite: (() => void) | null = null;

  /** Runs the pending throttled write immediately, if any. */
  function flushPending(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const write = pendingWrite;
    pendingWrite = null;
    if (!write) return;
    try {
      write();
    } catch {
      // Quota, disabled storage, or denied access — keep the in-memory copy.
    }
  }

  /** Drops the pending throttled write without running it. */
  function cancelPending(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingWrite = null;
  }

  watch(
    () => unwrapKey(options.key),
    (k) => {
      // A write scheduled under the previous key must land there, not in the new book's slot.
      flushPending();
      keyRef.value = k;
      hydrate(k);
    },
  );

  function save(next: ReadingPositionValue): void {
    position.value = next;
    if (storage) {
      const keyAtSave = keyRef.value;
      cancelPending();
      pendingWrite = () => {
        storage.setItem(keyAtSave, serializeReadingPosition(next));
      };
      timer = setTimeout(flushPending, throttleMs);
    }
    options.onChange?.(next);
  }

  function clear(): void {
    position.value = null;
    cancelPending();
    if (storage) {
      try {
        storage.removeItem(keyRef.value);
      } catch {
        // ignore
      }
    }
    options.onChange?.(null);
  }

  // Unmounting mid-throttle must not lose the position the user just reached.
  onScopeDispose(flushPending);

  return { position, save, clear };
}
