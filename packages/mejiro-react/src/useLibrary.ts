import { useCallback, useEffect, useMemo, useState } from 'react';

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
  /** The volumes available to the reader. */
  volumes: readonly VolumeInfo<T>[];
  /** ID of the volume to start on. Defaults to the first entry. */
  initialVolumeId?: string;
  /** Called whenever the active volume changes. */
  onChange?: (volume: VolumeInfo<T>) => void;
}

/** Return value of {@link useLibrary}. */
export interface UseLibraryReturn<T = unknown> {
  /** The list of volumes (same reference as the options input). */
  list: readonly VolumeInfo<T>[];
  /** Currently active volume, or `null` for an empty library. */
  current: VolumeInfo<T> | null;
  /** Index of the current volume, or `-1` for an empty library. */
  currentIndex: number;
  /** Advance to the next volume in the list (no-op at the end). */
  next(): void;
  /** Go back to the previous volume in the list (no-op at the start). */
  prev(): void;
  /** Jump to a volume by ID. No-op when the ID is not in the list. */
  goTo(id: string): void;
}

/**
 * Headless hook for managing a multi-volume reading session. Pair it with
 * {@link MejiroReader} (driving its `epub` / `epubUrl` prop) or
 * {@link MejiroShelf} (visual picker).
 */
export function useLibrary<T = unknown>(options: UseLibraryOptions<T>): UseLibraryReturn<T> {
  const { volumes, initialVolumeId, onChange } = options;
  const initialIndex =
    initialVolumeId != null
      ? Math.max(
          0,
          volumes.findIndex((v) => v.id === initialVolumeId),
        )
      : 0;
  const [currentId, setCurrentId] = useState<string | null>(
    volumes.length > 0 ? (volumes[initialIndex]?.id ?? volumes[0]?.id ?? null) : null,
  );

  useEffect(() => {
    if (volumes.length === 0) {
      if (currentId !== null) setCurrentId(null);
      return;
    }
    if (currentId != null && volumes.some((v) => v.id === currentId)) return;
    const fallback = volumes[0] ?? null;
    setCurrentId(fallback?.id ?? null);
    if (fallback) onChange?.(fallback);
  }, [currentId, volumes, onChange]);

  const index = useMemo(() => {
    if (volumes.length === 0) return -1;
    if (currentId == null) return 0;
    const found = volumes.findIndex((v) => v.id === currentId);
    return found >= 0 ? found : 0;
  }, [currentId, volumes]);

  const current = useMemo<VolumeInfo<T> | null>(
    () => (index >= 0 && index < volumes.length ? volumes[index] : null),
    [index, volumes],
  );

  const fire = useCallback(
    (i: number) => {
      const v = volumes[i];
      if (v) onChange?.(v);
    },
    [volumes, onChange],
  );

  const next = useCallback(() => {
    if (index < 0) return;
    const ni = Math.min(volumes.length - 1, index + 1);
    if (ni !== index) {
      setCurrentId(volumes[ni]?.id ?? null);
      fire(ni);
    }
  }, [index, volumes, fire]);

  const prev = useCallback(() => {
    if (index < 0) return;
    const ni = Math.max(0, index - 1);
    if (ni !== index) {
      setCurrentId(volumes[ni]?.id ?? null);
      fire(ni);
    }
  }, [index, volumes, fire]);

  const goTo = useCallback(
    (id: string) => {
      const ni = volumes.findIndex((v) => v.id === id);
      if (ni < 0) return;
      if (ni !== index) {
        setCurrentId(id);
        fire(ni);
      }
    },
    [index, volumes, fire],
  );

  return { list: volumes, current, currentIndex: index, next, prev, goTo };
}
