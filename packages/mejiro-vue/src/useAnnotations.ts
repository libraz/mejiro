import {
  type Annotation,
  createAnnotationId,
  type MejiroStorage,
  parseAnnotations,
  serializeAnnotations,
  sortAnnotations,
} from '@libraz/mejiro';
import { onScopeDispose, type Ref, ref, watch } from 'vue';
import {
  createPendingWrite,
  flushOnPageHide,
  mergeDefined,
  readStorage,
  removeStorage,
  resolveDefaultStorage,
} from './persistence.js';

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
  /** Storage key — usually scoped per-book. */
  key: Ref<string> | string;
  /** Storage backend. Defaults to `window.localStorage`. */
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
  /** Currently saved annotations. */
  annotations: Ref<readonly Annotation[]>;
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

function unwrapKey(key: Ref<string> | string): string {
  return typeof key === 'string' ? key : key.value;
}

/** Parses and sorts a stored annotation list. */
function parseSorted(raw: string | null): readonly Annotation[] {
  return sortAnnotations(parseAnnotations(raw));
}

/**
 * Persistence helper for reader annotations. Vue equivalent of the React hook
 * of the same name.
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotationsReturn {
  const { throttleMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();

  const annotations = ref<readonly Annotation[]>(
    readStorage(storage, unwrapKey(options.key), parseSorted, []),
  );
  const pending = createPendingWrite();

  watch(
    () => unwrapKey(options.key),
    (next) => {
      // A write scheduled under the previous key must land there, not in the new book's slot.
      pending.flush();
      annotations.value = readStorage(storage, next, parseSorted, []);
    },
  );

  // Closing the tab or disposing the scope mid-throttle must not lose the last mutation.
  const detachPageHide = flushOnPageHide(pending.flush);
  onScopeDispose(() => {
    detachPageHide();
    pending.flush();
  });

  function commit(next: readonly Annotation[]): void {
    if (storage) {
      const keyAtCommit = unwrapKey(options.key);
      pending.schedule(() => {
        storage.setItem(keyAtCommit, serializeAnnotations(next));
      }, throttleMs);
    }
    options.onChange?.(next);
  }

  function add(
    input: Omit<Annotation, 'id' | 'createdAt'> & Partial<Pick<Annotation, 'id' | 'createdAt'>>,
  ): Annotation {
    const annotation: Annotation = {
      ...input,
      id: input.id ?? createAnnotationId(),
      createdAt: input.createdAt ?? Date.now(),
    };
    const next = sortAnnotations([...annotations.value, annotation]);
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
      const sorted = sortAnnotations(next);
      annotations.value = sorted;
      commit(sorted);
    }
  }

  function clear(): void {
    annotations.value = [];
    pending.cancel();
    removeStorage(storage, unwrapKey(options.key));
    options.onChange?.([]);
  }

  return { annotations, add, remove, update, clear };
}
