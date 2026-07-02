import {
  type Annotation,
  createAnnotationId,
  type MejiroStorage,
  parseAnnotations,
  serializeAnnotations,
  sortAnnotations,
} from '@libraz/mejiro';
import { onUnmounted, type Ref, ref, watch } from 'vue';

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
  /** Patch an annotation by id. */
  update(id: string, patch: Partial<Omit<Annotation, 'id'>>): void;
  /** Remove all annotations. */
  clear(): void;
}

function resolveDefaultStorage(): AnnotationsStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const w = (globalThis as { localStorage?: AnnotationsStorage }).localStorage;
  return w ?? null;
}

function unwrapKey(key: Ref<string> | string): string {
  return typeof key === 'string' ? key : key.value;
}

/**
 * Persistence helper for reader annotations. Vue equivalent of the React hook
 * of the same name.
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotationsReturn {
  const { throttleMs = 250 } = options;
  const storage = options.storage ?? resolveDefaultStorage();

  const annotations = ref<readonly Annotation[]>(
    storage ? sortAnnotations(parseAnnotations(storage.getItem(unwrapKey(options.key)))) : [],
  );

  if (typeof options.key === 'object' && options.key && 'value' in options.key) {
    watch(options.key, (next) => {
      annotations.value = storage ? sortAnnotations(parseAnnotations(storage.getItem(next))) : [];
    });
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  function commit(next: readonly Annotation[]): void {
    if (storage) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          storage.setItem(unwrapKey(options.key), serializeAnnotations(next));
        } catch {
          // ignore
        }
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
      return { ...annotation, ...patch, id };
    });
    if (changed) {
      const sorted = sortAnnotations(next);
      annotations.value = sorted;
      commit(sorted);
    }
  }

  function clear(): void {
    annotations.value = [];
    if (storage) {
      if (timer) clearTimeout(timer);
      try {
        storage.removeItem(unwrapKey(options.key));
      } catch {
        // ignore
      }
    }
    options.onChange?.([]);
  }

  return { annotations, add, remove, update, clear };
}
