import type { InChapterAnchor } from '@libraz/mejiro/book';
import { onUnmounted, type Ref, ref, watch } from 'vue';

/**
 * A user-authored annotation on a book — a half-open range of in-chapter
 * anchors plus optional metadata (color, note). Pair with the `annotations`
 * prop on {@link MejiroReader} to render highlights, or with `goToAnchor` to
 * implement bookmarks.
 */
export interface Annotation {
  id: string;
  chapter: number;
  start: InChapterAnchor;
  end: InChapterAnchor;
  color?: string;
  note?: string;
  createdAt?: number;
}

/** Minimal storage interface required by {@link useAnnotations}. */
export interface AnnotationsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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

const STORAGE_VERSION = 1;

interface Persisted {
  version: number;
  annotations: Annotation[];
}

function resolveDefaultStorage(): AnnotationsStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const w = (globalThis as { localStorage?: AnnotationsStorage }).localStorage;
  return w ?? null;
}

function parse(raw: string | null): Annotation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (parsed && Array.isArray(parsed.annotations)) return parsed.annotations;
  } catch {
    // ignore
  }
  return [];
}

function serialize(annotations: readonly Annotation[]): string {
  const payload: Persisted = { version: STORAGE_VERSION, annotations: [...annotations] };
  return JSON.stringify(payload);
}

function sort(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    if (a.start.paragraph !== b.start.paragraph) return a.start.paragraph - b.start.paragraph;
    return a.start.charIndex - b.start.charIndex;
  });
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') {
    return (crypto as Crypto).randomUUID();
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
    storage ? sort(parse(storage.getItem(unwrapKey(options.key)))) : [],
  );

  if (typeof options.key === 'object' && options.key && 'value' in options.key) {
    watch(options.key, (next) => {
      annotations.value = storage ? sort(parse(storage.getItem(next))) : [];
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
          storage.setItem(unwrapKey(options.key), serialize(next));
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
      id: input.id ?? makeId(),
      createdAt: input.createdAt ?? Date.now(),
    };
    const next = sort([...annotations.value, annotation]);
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
      const sorted = sort(next);
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
