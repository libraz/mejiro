/**
 * @file Framework-agnostic persistence plumbing shared by the storage-backed
 * hooks (`useReadingPosition`, `useAnnotations`, `useManuscriptDraft`). The
 * React and Vue packages carry identical copies so both follow one rule.
 * Internal: not re-exported from the package entry.
 */
import { type ManuscriptChapter, MejiroError, type MejiroStorage } from '@libraz/mejiro';

/** Receives a storage failure as a `storage-*` {@link MejiroError}. */
export type StorageErrorHandler = (error: MejiroError) => void;

/**
 * Hands `error` to `onError`, or to `console.warn` when the host passed no
 * handler, so a failed read or write is never silent.
 */
export function reportStorageError(
  onError: StorageErrorHandler | undefined,
  error: MejiroError,
): void {
  if (onError) onError(error);
  // biome-ignore lint/suspicious/noConsole: the documented default of the persistence hooks' onError
  else console.warn(error);
}

/**
 * Returns `globalThis.localStorage`, or `null` when it is absent or its getter
 * throws (sandboxed iframes, storage denied by browser settings).
 */
export function resolveDefaultStorage(): MejiroStorage | null {
  try {
    return (globalThis as { localStorage?: MejiroStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads and parses `key`. Returns `fallback` when there is no backend, when it
 * throws (reported as `storage-read-failed`), or when a stored value parses to
 * `null` (reported as `storage-corrupt`).
 */
export function readStorage<T>(
  storage: MejiroStorage | null,
  key: string,
  parse: (raw: string | null) => T | null,
  fallback: T,
  report: StorageErrorHandler,
): T {
  if (!storage) return fallback;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (cause) {
    report(
      new MejiroError('storage-read-failed', `Failed to read "${key}" from storage`, { cause }),
    );
    return fallback;
  }
  const parsed = parse(raw);
  if (parsed !== null) return parsed;
  if (raw) report(new MejiroError('storage-corrupt', `Stored "${key}" could not be read back`));
  return fallback;
}

/** A value read for `key`, with the failure the read reported, if any. */
export interface HydratedValue<T> {
  /** Storage key the value was read for. */
  key: string;
  /** The parsed value, or the fallback. */
  value: T;
  /** The read failure, reported once the read is committed. */
  error: MejiroError | null;
}

/**
 * {@link readStorage} for render-time hydration: the failure is returned with
 * the value instead of being reported, so it can be reported once from an
 * effect after the render commits.
 */
export function hydrateStorage<T>(
  storage: MejiroStorage | null,
  key: string,
  parse: (raw: string | null) => T | null,
  fallback: T,
): HydratedValue<T> {
  let error: MejiroError | null = null;
  const value = readStorage(storage, key, parse, fallback, (failure) => {
    error = failure;
  });
  return { key, value, error };
}

/** Wraps a failed `setItem` / `removeItem` of `key` as `storage-write-failed`. */
export function storageWriteError(key: string, cause: unknown): MejiroError {
  return new MejiroError('storage-write-failed', `Failed to write "${key}" to storage`, { cause });
}

/**
 * Removes `key`. A throwing backend is reported as `storage-write-failed`; the
 * in-memory state is already cleared.
 */
export function removeStorage(
  storage: MejiroStorage | null,
  key: string,
  report: StorageErrorHandler,
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (cause) {
    report(storageWriteError(key, cause));
  }
}

/**
 * Returns a generated chapter id no chapter in `existing` carries, however
 * many chapters were added or removed within the same millisecond.
 */
export function uniqueChapterId(existing: readonly { id?: string }[]): string {
  const taken = new Set(existing.map((chapter) => chapter.id));
  const stamp = Date.now();
  let n = existing.length;
  while (taken.has(`chapter-${stamp}-${n}`)) n++;
  return `chapter-${stamp}-${n}`;
}

/** Returns `base` with only the `patch` keys whose value is not `undefined` applied. */
export function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) next[key] = value as T[keyof T];
  }
  return next;
}

/** Single-slot debounced write queue; a newer write replaces the pending one. */
export interface PendingWrite {
  /** Replaces the pending write and runs it after `delayMs`. */
  schedule(write: () => void, delayMs: number): void;
  /**
   * Runs the pending write now, if any. A throwing write keeps the in-memory
   * state and goes to the `onWriteError` the queue was created with.
   */
  flush(): void;
  /** Drops the pending write without running it. */
  cancel(): void;
}

/** Creates a {@link PendingWrite} whose failed writes go to `onWriteError`. */
export function createPendingWrite(onWriteError: (cause: unknown) => void): PendingWrite {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  function cancel(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }
  function flush(): void {
    const write = pending;
    cancel();
    if (!write) return;
    try {
      write();
    } catch (cause) {
      onWriteError(cause);
    }
  }
  return {
    schedule(write, delayMs) {
      cancel();
      pending = write;
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel,
  };
}

/**
 * Runs `flush` when the page is being unloaded or hidden for navigation
 * (`beforeunload` and `pagehide`), so a pending write survives tab close.
 * Returns the detach function; a no-op outside the browser.
 */
export function flushOnPageHide(flush: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (): void => flush();
  window.addEventListener('beforeunload', handler);
  window.addEventListener('pagehide', handler);
  return () => {
    window.removeEventListener('beforeunload', handler);
    window.removeEventListener('pagehide', handler);
  };
}

/** Copies chapters into plain objects so an autosave payload is structured-cloneable. */
export function snapshotChapters(chapters: readonly ManuscriptChapter[]): ManuscriptChapter[] {
  return chapters.map(({ id, title, body }) =>
    id === undefined ? { title, body } : { id, title, body },
  );
}

/** Decides whether a draft differs from the last one it was shown. */
export interface DraftChangeTracker {
  /** Records `chapters` / `deps` and reports whether they differ from the previous record. */
  changed(chapters: readonly ManuscriptChapter[], deps: readonly unknown[]): boolean;
}

/** Whether two dependency lists hold the same values, compared with `Object.is`. */
export function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/** Creates a {@link DraftChangeTracker} seeded with the draft present at mount. */
export function createDraftChangeTracker(
  chapters: readonly ManuscriptChapter[],
  deps: readonly unknown[],
): DraftChangeTracker {
  let lastChapters = snapshotChapters(chapters);
  let lastDeps = [...deps];
  return {
    changed(nextChapters, nextDeps) {
      const same =
        sameDeps(nextDeps, lastDeps) &&
        nextChapters.length === lastChapters.length &&
        nextChapters.every((chapter, i) => {
          const prev = lastChapters[i];
          return (
            chapter.id === prev.id && chapter.title === prev.title && chapter.body === prev.body
          );
        });
      if (same) return false;
      lastChapters = snapshotChapters(nextChapters);
      lastDeps = [...nextDeps];
      return true;
    },
  };
}
