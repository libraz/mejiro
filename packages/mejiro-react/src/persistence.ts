/**
 * @file Framework-agnostic persistence plumbing shared by the storage-backed
 * hooks (`useReadingPosition`, `useAnnotations`, `useManuscriptDraft`). The
 * React and Vue packages carry identical copies so both follow one rule.
 * Internal: not re-exported from the package entry.
 */
import type { MejiroStorage } from '@libraz/mejiro';
import type { ManuscriptEditorChapter } from './MejiroManuscriptEditor.js';

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

/** Reads and parses `key`, returning `fallback` when there is no backend or it throws. */
export function readStorage<T>(
  storage: MejiroStorage | null,
  key: string,
  parse: (raw: string | null) => T,
  fallback: T,
): T {
  if (!storage) return fallback;
  try {
    return parse(storage.getItem(key));
  } catch {
    return fallback;
  }
}

/** Removes `key`, ignoring a throwing backend. */
export function removeStorage(storage: MejiroStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Disabled or denied storage — the in-memory state is already cleared.
  }
}

/**
 * Returns a generated chapter id no chapter in `existing` carries, however
 * many chapters were added or removed within the same millisecond.
 */
export function uniqueChapterId(existing: readonly { id: string }[]): string {
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
  /** Runs the pending write now, if any. A throwing write keeps the in-memory state. */
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
    if (!write) return;
    try {
      write();
    } catch {
      // Quota, disabled storage, or denied access — keep the in-memory copy.
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
export function snapshotChapters(
  chapters: readonly ManuscriptEditorChapter[],
): ManuscriptEditorChapter[] {
  return chapters.map(({ id, title, body }) => ({ id, title, body }));
}

/** Decides whether a draft differs from the last one it was shown. */
export interface DraftChangeTracker {
  /** Records `chapters` / `key` and reports whether they differ from the previous record. */
  changed(chapters: readonly ManuscriptEditorChapter[], key: string): boolean;
}

/** Creates a {@link DraftChangeTracker} seeded with the draft present at mount. */
export function createDraftChangeTracker(
  chapters: readonly ManuscriptEditorChapter[],
  key: string,
): DraftChangeTracker {
  let lastChapters = snapshotChapters(chapters);
  let lastKey = key;
  return {
    changed(nextChapters, nextKey) {
      const same =
        nextKey === lastKey &&
        nextChapters.length === lastChapters.length &&
        nextChapters.every((chapter, i) => {
          const prev = lastChapters[i];
          return (
            chapter.id === prev.id && chapter.title === prev.title && chapter.body === prev.body
          );
        });
      if (same) return false;
      lastChapters = snapshotChapters(nextChapters);
      lastKey = nextKey;
      return true;
    },
  };
}
