import type { ReadingAnchor } from '@libraz/mejiro/book';
import { onScopeDispose, type Ref, ref, watch } from 'vue';

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
   * SSR consumers can omit this and the composable will fall back to in-memory.
   */
  storage?: ReadingPositionStorage;
  /** Throttle ms between writes. @defaultValue 250 */
  throttleMs?: number;
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
      position.value = parsePosition(storage.getItem(currentKey));
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
    if (!storage) return;
    if (timer) clearTimeout(timer);
    const keyAtSave = keyRef.value;
    timer = setTimeout(() => {
      try {
        storage.setItem(keyAtSave, serializePosition(next));
      } catch {
        // Quota, disabled storage, or denied access — keep the in-memory copy.
      }
    }, throttleMs);
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
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });

  return { position, save, clear };
}
