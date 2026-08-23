import {
  type Annotation,
  createAnnotationId,
  type MejiroStorage,
  parseAnnotations,
  serializeAnnotations,
  sortAnnotations,
} from '@libraz/mejiro';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A user-authored annotation on a book — a half-open range of in-chapter
 * anchors plus optional metadata (color, note). Pair with the `annotations`
 * prop on {@link MejiroReader} to render highlights, or with `goToAnchor` to
 * implement bookmarks.
 */
export type { Annotation };

/** Minimal storage interface required by {@link useAnnotations}. */
export type AnnotationsStorage = MejiroStorage;

/** Options for {@link useAnnotations}. */
export interface UseAnnotationsOptions {
  /** Storage key — usually scoped per-book (e.g. `mejiro:annotations:${bookId}`). */
  key: string;
  /**
   * Storage backend. Defaults to `window.localStorage` when available.
   * SSR consumers can omit this and the hook will fall back to in-memory.
   * The latest reference is always used, so an object literal recreated on
   * every render is safe — only `key` triggers a re-hydration.
   */
  storage?: AnnotationsStorage;
  /** Throttle ms between writes. @defaultValue 250 */
  throttleMs?: number;
  /**
   * Called immediately after each mutation (`add` / `remove` / `update` /
   * `clear`) with the new annotation list. Use to mirror state to a server
   * — `storage` only covers the local persistence side. Not invoked on
   * initial hydration or when the `key` changes.
   */
  onChange?: (next: readonly Annotation[]) => void;
}

/** Return value of {@link useAnnotations}. */
export interface UseAnnotationsReturn {
  /** Currently saved annotations, sorted by chapter / paragraph / charIndex. */
  annotations: readonly Annotation[];
  /** Add a new annotation. `id` and `createdAt` are auto-filled when omitted. */
  add(
    input: Omit<Annotation, 'id' | 'createdAt'> & Partial<Pick<Annotation, 'id' | 'createdAt'>>,
  ): Annotation;
  /** Remove an annotation by id. */
  remove(id: string): void;
  /** Patch an annotation by id. Pass `undefined` on a field to leave it untouched. */
  update(id: string, patch: Partial<Omit<Annotation, 'id'>>): void;
  /** Remove all annotations. */
  clear(): void;
}

function resolveDefaultStorage(): AnnotationsStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const w = (globalThis as { localStorage?: AnnotationsStorage }).localStorage;
  return w ?? null;
}

/**
 * Persistence helper for reader annotations. Returns the saved annotation list
 * plus add / update / remove helpers. Pair with the `annotations` prop on
 * {@link MejiroReader} to render the corresponding highlight rectangles.
 *
 * ```tsx
 * const { annotations, add } = useAnnotations({ key: `mejiro:ann:${bookId}` });
 * const handle = useRef<MejiroReaderHandle>(null);
 *
 * // Save a highlight at the current visible range:
 * const range = handle.current?.getVisibleRange();
 * if (range) add({ chapter: 0, start: range.start, end: range.end, color: 'yellow' });
 *
 * <MejiroReader epub={book} annotations={annotations} ref={handle} />
 * ```
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotationsReturn {
  const { key, throttleMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();

  const [annotations, setAnnotations] = useState<readonly Annotation[]>(() => {
    if (!storage) return [];
    try {
      return sortAnnotations(parseAnnotations(storage.getItem(key)));
    } catch {
      return [];
    }
  });
  const storageRef = useRef(storage);
  storageRef.current = storage;

  // Mirrors the latest list so mutations can derive the next one outside the
  // state updater — updaters must stay pure (they run twice in StrictMode).
  const annotationsRef = useRef(annotations);

  const applyNext = useCallback((next: readonly Annotation[]) => {
    annotationsRef.current = next;
    setAnnotations(next);
  }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<(() => void) | null>(null);

  /** Runs the pending throttled write immediately, if any. */
  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const write = pendingWriteRef.current;
    pendingWriteRef.current = null;
    if (!write) return;
    try {
      write();
    } catch {
      // Quota or disabled storage — in-memory copy stays.
    }
  }, []);

  /** Drops the pending throttled write without running it. */
  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingWriteRef.current = null;
  }, []);

  // Re-hydrate when the key changes (different book). Unmounting or switching
  // book mid-throttle must not lose the last mutation, so the pending write —
  // which targets the key it was scheduled under — is flushed on cleanup.
  useEffect(() => {
    const currentStorage = storageRef.current;
    if (currentStorage) {
      try {
        applyNext(sortAnnotations(parseAnnotations(currentStorage.getItem(key))));
      } catch {
        applyNext([]);
      }
    } else {
      applyNext([]);
    }
    return flushPending;
  }, [key, applyNext, flushPending]);

  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;

  const commit = useCallback(
    (next: readonly Annotation[]) => {
      const currentStorage = storageRef.current;
      if (currentStorage) {
        cancelPending();
        pendingWriteRef.current = () => {
          currentStorage.setItem(key, serializeAnnotations(next));
        };
        timerRef.current = setTimeout(flushPending, throttleMs);
      }
      onChangeRef.current?.(next);
    },
    [key, throttleMs, cancelPending, flushPending],
  );

  const add = useCallback<UseAnnotationsReturn['add']>(
    (input) => {
      const annotation: Annotation = {
        ...input,
        id: input.id ?? createAnnotationId(),
        createdAt: input.createdAt ?? Date.now(),
      };
      const next = sortAnnotations([...annotationsRef.current, annotation]);
      applyNext(next);
      commit(next);
      return annotation;
    },
    [commit, applyNext],
  );

  const remove = useCallback(
    (id: string) => {
      const current = annotationsRef.current;
      const next = current.filter((annotation) => annotation.id !== id);
      if (next.length === current.length) return;
      applyNext(next);
      commit(next);
    },
    [commit, applyNext],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<Annotation, 'id'>>) => {
      let changed = false;
      const next = annotationsRef.current.map((annotation) => {
        if (annotation.id !== id) return annotation;
        changed = true;
        return { ...annotation, ...patch, id };
      });
      if (!changed) return;
      const sorted = sortAnnotations(next);
      applyNext(sorted);
      commit(sorted);
    },
    [commit, applyNext],
  );

  const clear = useCallback(() => {
    applyNext([]);
    const currentStorage = storageRef.current;
    if (currentStorage) {
      cancelPending();
      try {
        currentStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    onChangeRef.current?.([]);
  }, [key, cancelPending, applyNext]);

  return { annotations, add, remove, update, clear };
}
