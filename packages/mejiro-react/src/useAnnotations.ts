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

  // Re-hydrate when the key changes (different book).
  useEffect(() => {
    if (!storage) {
      setAnnotations([]);
      return;
    }
    try {
      setAnnotations(sortAnnotations(parseAnnotations(storage.getItem(key))));
    } catch {
      setAnnotations([]);
    }
  }, [storage, key]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;

  const commit = useCallback(
    (next: readonly Annotation[]) => {
      if (storage) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          try {
            storage.setItem(key, serializeAnnotations(next));
          } catch {
            // Quota or disabled storage — in-memory copy stays.
          }
        }, throttleMs);
      }
      onChangeRef.current?.(next);
    },
    [storage, key, throttleMs],
  );

  const add = useCallback<UseAnnotationsReturn['add']>(
    (input) => {
      const annotation: Annotation = {
        ...input,
        id: input.id ?? createAnnotationId(),
        createdAt: input.createdAt ?? Date.now(),
      };
      setAnnotations((current) => {
        const next = sortAnnotations([...current, annotation]);
        commit(next);
        return next;
      });
      return annotation;
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      setAnnotations((current) => {
        const next = current.filter((annotation) => annotation.id !== id);
        if (next.length !== current.length) commit(next);
        return next;
      });
    },
    [commit],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<Annotation, 'id'>>) => {
      setAnnotations((current) => {
        let changed = false;
        const next = current.map((annotation) => {
          if (annotation.id !== id) return annotation;
          changed = true;
          return { ...annotation, ...patch, id };
        });
        if (!changed) return current;
        const sorted = sortAnnotations(next);
        commit(sorted);
        return sorted;
      });
    },
    [commit],
  );

  const clear = useCallback(() => {
    setAnnotations([]);
    if (storage) {
      if (timerRef.current) clearTimeout(timerRef.current);
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
    onChangeRef.current?.([]);
  }, [storage, key]);

  return { annotations, add, remove, update, clear };
}
