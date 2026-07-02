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
  /** Storage key — usually scoped per-book (e.g. `mejiro:position:${bookId}`). */
  key: string;
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
  const keyRef = ref(options.key);

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
  watch(
    () => options.key,
    (k) => {
      keyRef.value = k;
      hydrate(k);
    },
  );

  let timer: ReturnType<typeof setTimeout> | null = null;

  function save(next: ReadingPositionValue): void {
    position.value = next;
    if (storage) {
      if (timer) clearTimeout(timer);
      const keyAtSave = keyRef.value;
      timer = setTimeout(() => {
        try {
          storage.setItem(keyAtSave, serializeReadingPosition(next));
        } catch {
          // Quota, disabled storage, or denied access — keep the in-memory copy.
        }
      }, throttleMs);
    }
    options.onChange?.(next);
  }

  function clear(): void {
    position.value = null;
    if (timer) clearTimeout(timer);
    if (storage) {
      try {
        storage.removeItem(keyRef.value);
      } catch {
        // ignore
      }
    }
    options.onChange?.(null);
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });

  return { position, save, clear };
}
