/**
 * @file Framework-agnostic persistence plumbing shared by the storage-backed
 * hooks (`useReadingPosition`, `useAnnotations`, `useManuscriptDraft`). The
 * React and Vue packages carry identical copies so both follow one rule.
 * Internal: not re-exported from the package entry.
 */
import { type ManuscriptChapter, MejiroError, type MejiroStorage } from '@libraz/mejiro';

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
 * Reads and parses `key`, returning `fallback` when there is no backend, it
 * throws (reported as `storage-read-failed`), or a stored value cannot be
 * parsed (`parse` returns `null` for a non-empty value; reported as
 * `storage-corrupt`). The stored value is left in place either way.
 */
export function readStorage<T>(
  storage: MejiroStorage | null,
  key: string,
  parse: (raw: string | null) => T | null,
  fallback: T,
  report: (error: MejiroError) => void,
): T {
  if (!storage) return fallback;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (cause) {
    report(new MejiroError('storage-read-failed', `Could not read "${key}"`, { cause }));
    return fallback;
  }
  const parsed = parse(raw);
  if (parsed !== null) return parsed;
  if (raw) report(new MejiroError('storage-corrupt', `Stored data under "${key}" is unreadable`));
  return fallback;
}

/** Removes `key`; a throwing backend is reported as `storage-write-failed`. */
export function removeStorage(
  storage: MejiroStorage | null,
  key: string,
  report: (error: MejiroError) => void,
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (cause) {
    // The in-memory state is already cleared.
    report(new MejiroError('storage-write-failed', `Could not remove "${key}"`, { cause }));
  }
}

/** Writes `value` under `key`; a throwing backend is reported as `storage-write-failed`. */
export function writeStorage(
  storage: MejiroStorage,
  key: string,
  value: string,
  report: (error: MejiroError) => void,
): void {
  try {
    storage.setItem(key, value);
  } catch (cause) {
    // Quota, disabled storage, or denied access — the in-memory copy is kept.
    report(new MejiroError('storage-write-failed', `Could not write "${key}"`, { cause }));
  }
}

/**
 * Returns a generated chapter id no chapter in `existing` carries, however
 * many chapters were added or removed within the same millisecond.
 */
export function uniqueChapterId(existing: readonly ManuscriptChapter[]): string {
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
  /** Runs the pending write now, if any. */
  flush(): void;
  /** Drops the pending write without running it. */
  cancel(): void;
}

/** Creates a {@link PendingWrite}. */
export function createPendingWrite(): PendingWrite {
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
    write?.();
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

/** Whether two dependency lists hold the same values, compared with `Object.is`. */
function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/** Decides whether a draft differs from the last one it was shown. */
export interface DraftChangeTracker {
  /** Records `chapters` / `deps` and reports whether they differ from the previous record. */
  changed(chapters: readonly ManuscriptChapter[], deps: readonly unknown[]): boolean;
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
