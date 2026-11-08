import {
  type Annotation,
  createAnnotationId,
  type MejiroError,
  type MejiroStorage,
  parseAnnotations,
  serializeAnnotations,
  toSortedAnnotations,
} from '@libraz/mejiro';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPendingWrite,
  flushOnPageHide,
  type HydratedValue,
  hydrateStorage,
  mergeDefined,
  removeStorage,
  reportStorageError,
  resolveDefaultStorage,
  storageWriteError,
} from './persistence.js';

/**
 * A user-authored annotation on a book — a half-open range of in-chapter
 * anchors plus optional metadata (color, note). Pair with the `annotations`
 * prop on {@link MejiroReader} to render highlights, or with `goToAnchor` to
 * implement bookmarks.
 */
export type { Annotation };

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
  storage?: MejiroStorage;
  /**
   * Debounce delay (ms): the latest value is written this long after the last
   * change. A pending write is flushed on page hide, key change and unmount.
   * @defaultValue 250
   */
  debounceMs?: number;
  /**
   * Called immediately after each mutation (`add` / `remove` / `update` /
   * `clear`) with the new annotation list. Use to mirror state to a server
   * — `storage` only covers the local persistence side. Not invoked on
   * initial hydration or when the `key` changes.
   */
  onAnnotationsChange?: (next: readonly Annotation[]) => void;
  /**
   * Receives a storage failure: `storage-read-failed` or `storage-corrupt` when
   * hydrating (the list starts empty, and the stored value is left alone until
   * the next mutation), `storage-write-failed` when a write or removal throws
   * (the in-memory list is kept). Without it the error goes to `console.warn`.
   */
  onError?: (error: MejiroError) => void;
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

/** Parses and sorts a stored annotation list; `null` when it cannot be read. */
function parseSorted(raw: string | null): readonly Annotation[] | null {
  const parsed = parseAnnotations(raw);
  return parsed && toSortedAnnotations(parsed);
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
 * if (range) add({ chapterIndex: 0, start: range.start, end: range.end, color: 'yellow' });
 *
 * <MejiroReader epub={book} annotations={annotations} ref={handle} />
 * ```
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotationsReturn {
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

  // The list is kept with the key it was read for, so a key change is
  // re-hydrated in the same render instead of one commit late.
  const [hydrated, setHydrated] = useState<HydratedValue<readonly Annotation[]>>(() =>
    hydrateStorage(storage, key, parseSorted, []),
  );
  let annotations = hydrated.value;

  // Mirrors the latest list so mutations can derive the next one outside the
  // state updater — updaters must stay pure (they run twice in StrictMode).
  const annotationsRef = useRef(annotations);
  if (hydrated.key !== key) {
    const next = hydrateStorage(storage, key, parseSorted, []);
    annotations = next.value;
    annotationsRef.current = annotations;
    setHydrated(next);
  }

  // A failed read is reported once, after the render that made it commits.
  const reportedRef = useRef<HydratedValue<readonly Annotation[]> | null>(null);
  useEffect(() => {
    if (!hydrated.error || reportedRef.current === hydrated) return;
    reportedRef.current = hydrated;
    report(hydrated.error);
  }, [hydrated, report]);

  const applyNext = useCallback(
    (next: readonly Annotation[]) => {
      annotationsRef.current = next;
      setHydrated({ key, value: next, error: null });
    },
    [key],
  );

  // Key of the write in flight, so a failure names the slot it targeted.
  const writeKeyRef = useRef(key);
  const pendingRef = useRef<ReturnType<typeof createPendingWrite> | null>(null);
  if (!pendingRef.current) {
    pendingRef.current = createPendingWrite((cause) =>
      report(storageWriteError(writeKeyRef.current, cause)),
    );
  }
  const pending = pendingRef.current;

  // Closing the tab mid-debounce must not lose the last mutation.
  useEffect(() => flushOnPageHide(pending.flush), [pending]);

  // Unmounting or switching book mid-debounce must not lose the last mutation,
  // so the pending write — which targets the key it was scheduled under — is
  // flushed on cleanup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger — each key change runs the previous cleanup.
  useEffect(() => pending.flush, [key, pending]);

  const onChangeRef = useRef(options.onAnnotationsChange);
  onChangeRef.current = options.onAnnotationsChange;

  const commit = useCallback(
    (next: readonly Annotation[]) => {
      const currentStorage = storageRef.current;
      if (currentStorage) {
        pending.schedule(() => {
          writeKeyRef.current = key;
          currentStorage.setItem(key, serializeAnnotations(next));
        }, debounceMs);
      }
      onChangeRef.current?.(next);
    },
    [key, debounceMs, pending],
  );

  const add = useCallback<UseAnnotationsReturn['add']>(
    (input) => {
      const annotation: Annotation = {
        ...input,
        id: input.id ?? createAnnotationId(),
        createdAt: input.createdAt ?? Date.now(),
      };
      const next = toSortedAnnotations([...annotationsRef.current, annotation]);
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
        return { ...mergeDefined(annotation, patch), id };
      });
      if (!changed) return;
      const sorted = toSortedAnnotations(next);
      applyNext(sorted);
      commit(sorted);
    },
    [commit, applyNext],
  );

  const clear = useCallback(() => {
    if (annotationsRef.current.length === 0) return;
    applyNext([]);
    pending.cancel();
    removeStorage(storageRef.current, key, report);
    onChangeRef.current?.([]);
  }, [key, pending, applyNext, report]);

  return { annotations, add, remove, update, clear };
}
