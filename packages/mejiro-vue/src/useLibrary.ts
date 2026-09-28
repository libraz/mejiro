import { type ComputedRef, computed, isRef, type MaybeRefOrGetter, ref, watch } from 'vue';

/** A single volume in a multi-book library. */
export interface VolumeInfo<T = unknown> {
  /** Stable identifier (e.g. ISBN, slug, internal ID). */
  id: string;
  /** Human-readable title shown in pickers. */
  label: string;
  /** Optional author / byline. */
  author?: string;
  /** Optional cover image URL. */
  cover?: string;
  /** Free-form metadata attached by the host. */
  meta?: T;
}

/** Options for {@link useLibrary}. */
export interface UseLibraryOptions<T = unknown> {
  /** The volumes available to the reader (may be a ref or getter). */
  volumes: MaybeRefOrGetter<readonly VolumeInfo<T>[]>;
  /** ID of the volume to start on. Defaults to the first entry. */
  initialVolumeId?: string;
  /** Called whenever the active volume changes. */
  onChange?: (volume: VolumeInfo<T>) => void;
}

/** Return value of {@link useLibrary}. */
export interface UseLibraryReturn<T = unknown> {
  /** Computed list of volumes (reactive). */
  list: ComputedRef<readonly VolumeInfo<T>[]>;
  /** Currently active volume, or `null` for an empty library. */
  current: ComputedRef<VolumeInfo<T> | null>;
  /** Index of the current volume, or `-1` for an empty library. */
  currentIndex: ComputedRef<number>;
  /** Advance to the next volume in the list (no-op at the end). */
  next(): void;
  /** Go back to the previous volume in the list (no-op at the start). */
  prev(): void;
  /** Jump to a volume by ID. No-op when the ID is not in the list. */
  goTo(id: string): void;
}

function readVolumes<T>(
  volumes: MaybeRefOrGetter<readonly VolumeInfo<T>[]>,
): readonly VolumeInfo<T>[] {
  if (typeof volumes === 'function') return (volumes as () => readonly VolumeInfo<T>[])();
  if (isRef(volumes)) return volumes.value;
  return volumes;
}

/**
 * Picks the active volume id: `preferredId` when the list holds it, else
 * `currentId` while it is still listed, else the first entry.
 */
function resolveCurrentId(
  volumes: readonly VolumeInfo<unknown>[],
  currentId: string | null,
  preferredId: string | undefined,
): string | null {
  if (volumes.length === 0) return null;
  if (preferredId != null && volumes.some((v) => v.id === preferredId)) return preferredId;
  if (currentId != null && volumes.some((v) => v.id === currentId)) return currentId;
  return volumes[0]?.id ?? null;
}

/**
 * Headless composable for managing a multi-volume reading session.
 * Pair with {@link MejiroReader} (driving its `epub` / `epubUrl` prop) or
 * {@link MejiroShelf} (visual picker).
 */
export function useLibrary<T = unknown>(options: UseLibraryOptions<T>): UseLibraryReturn<T> {
  const list = computed<readonly VolumeInfo<T>[]>(() => readVolumes(options.volumes));
  const currentId = ref<string | null>(resolveCurrentId(list.value, null, options.initialVolumeId));
  // initialVolumeId keeps winning, even for a list that fills in later, until
  // the user navigates.
  let navigated = false;

  // The spread copy tracks the array's contents, so an in-place mutation of a
  // reactive array re-resolves the current volume as a reassignment does.
  watch(
    () => [...readVolumes(options.volumes)],
    (next) => {
      const resolved = resolveCurrentId(
        next,
        currentId.value,
        navigated ? undefined : options.initialVolumeId,
      );
      if (resolved === currentId.value) return;
      currentId.value = resolved;
      const volume = next.find((v) => v.id === resolved);
      if (volume) options.onChange?.(volume);
    },
    { flush: 'sync' },
  );

  const currentIndex = computed(() => {
    const arr = list.value;
    if (arr.length === 0) return -1;
    if (currentId.value == null) return 0;
    const found = arr.findIndex((v) => v.id === currentId.value);
    return found >= 0 ? found : 0;
  });

  const current = computed<VolumeInfo<T> | null>(() => {
    const i = currentIndex.value;
    const arr = list.value;
    return i >= 0 && i < arr.length ? arr[i] : null;
  });

  function activate(i: number): void {
    const v = list.value[i];
    if (!v) return;
    navigated = true;
    currentId.value = v.id;
    options.onChange?.(v);
  }

  function next(): void {
    if (currentIndex.value < 0) return;
    const ni = Math.min(list.value.length - 1, currentIndex.value + 1);
    if (ni !== currentIndex.value) activate(ni);
  }
  function prev(): void {
    if (currentIndex.value < 0) return;
    const ni = Math.max(0, currentIndex.value - 1);
    if (ni !== currentIndex.value) activate(ni);
  }
  function goTo(id: string): void {
    const ni = list.value.findIndex((v) => v.id === id);
    if (ni < 0 || ni === currentIndex.value) return;
    activate(ni);
  }

  return {
    list,
    current,
    currentIndex,
    next,
    prev,
    goTo,
  };
}
