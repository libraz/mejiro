import {
  type Annotation,
  createAnnotationId,
  type MejiroError,
  type MejiroStorage,
  parseAnnotations,
  serializeAnnotations,
  toSortedAnnotations,
} from '@libraz/mejiro';
import {
  type MaybeRefOrGetter,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import { nonFatalReporter } from './errors.js';
import {
  createPendingWrite,
  flushOnPageHide,
  mergeDefined,
  readStorage,
  removeStorage,
  resolveDefaultStorage,
  writeStorage,
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
  /**
   * Storage key — usually scoped per-book. A ref or getter re-hydrates the list
   * when the key changes; a plain string is read once.
   */
  key: MaybeRefOrGetter<string>;
  /** Storage backend. Defaults to `window.localStorage`. */
  storage?: MejiroStorage;
  /**
   * Debounce delay (ms): the latest value is written this long after the last
   * change. A pending write is flushed on page hide, key change and scope
   * dispose. @defaultValue 250
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
   * Called when the storage throws (`storage-read-failed` /
   * `storage-write-failed`) or holds data that cannot be read back
   * (`storage-corrupt`). The list stays usable in memory; unreadable data is
   * left in place until the first mutation overwrites it. Without it the
   * failure goes to `console.warn`.
   */
  onError?: (error: MejiroError) => void;
}

/** Return value of {@link useAnnotations}. */
export interface UseAnnotationsReturn {
  /** Currently saved annotations. Change them through the methods below. */
  annotations: Readonly<Ref<readonly Annotation[]>>;
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

/** Parses and sorts a stored annotation list; `null` when it is unreadable. */
function parseSorted(raw: string | null): readonly Annotation[] | null {
  const parsed = parseAnnotations(raw);
  return parsed ? toSortedAnnotations(parsed) : null;
}

/**
 * Persistence helper for reader annotations. Vue equivalent of the React hook
 * of the same name.
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotationsReturn {
  const { debounceMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();
  const report = nonFatalReporter(options.onError);

  // The list is always replaced wholesale; a shallow ref keeps elements plain
  // (structured-cloneable) for `onAnnotationsChange` and consumers.
  const annotations = shallowRef<readonly Annotation[]>(
    readStorage(storage, toValue(options.key), parseSorted, [], report),
  );
  const pending = createPendingWrite();

  watch(
    () => toValue(options.key),
    (next) => {
      // A write scheduled under the previous key must land there, not in the new book's slot.
      pending.flush();
      annotations.value = readStorage(storage, next, parseSorted, [], report);
    },
  );

  // Closing the tab or disposing the scope mid-debounce must not lose the last mutation.
  const detachPageHide = flushOnPageHide(pending.flush);
  onScopeDispose(() => {
    detachPageHide();
    pending.flush();
  });

  function commit(next: readonly Annotation[]): void {
    if (storage) {
      const keyAtCommit = toValue(options.key);
      pending.schedule(() => {
        writeStorage(storage, keyAtCommit, serializeAnnotations(next), report);
      }, debounceMs);
    }
    options.onAnnotationsChange?.(next);
  }

  function add(
    input: Omit<Annotation, 'id' | 'createdAt'> & Partial<Pick<Annotation, 'id' | 'createdAt'>>,
  ): Annotation {
    const annotation: Annotation = {
      ...input,
      id: input.id ?? createAnnotationId(),
      createdAt: input.createdAt ?? Date.now(),
    };
    const next = toSortedAnnotations([...annotations.value, annotation]);
    annotations.value = next;
    commit(next);
    return annotation;
  }

  function remove(id: string): void {
    const next = annotations.value.filter((annotation) => annotation.id !== id);
    if (next.length !== annotations.value.length) {
      annotations.value = next;
      commit(next);
    }
  }

  function update(id: string, patch: Partial<Omit<Annotation, 'id'>>): void {
    let changed = false;
    const next = annotations.value.map((annotation) => {
      if (annotation.id !== id) return annotation;
      changed = true;
      return { ...mergeDefined(annotation, patch), id };
    });
    if (changed) {
      const sorted = toSortedAnnotations(next);
      annotations.value = sorted;
      commit(sorted);
    }
  }

  function clear(): void {
    if (annotations.value.length === 0) return;
    annotations.value = [];
    pending.cancel();
    removeStorage(storage, toValue(options.key), report);
    options.onAnnotationsChange?.([]);
  }

  return { annotations: shallowReadonly(annotations), add, remove, update, clear };
}
