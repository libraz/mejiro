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
  /** Called with the new active volume whenever it changes. */
  onVolumeChange?: (volume: VolumeInfo<T>) => void;
}

/** Return value of {@link useLibrary}. */
export interface UseLibraryReturn<T = unknown> {
  /** The list of volumes (same reference as the options input). */
  list: readonly VolumeInfo<T>[];
  /** Currently active volume, or `null` for an empty library. */
  volume: VolumeInfo<T> | null;
  /** Index of the active volume in the list, or `-1` for an empty library. */
  volumeIndex: number;
  /** Advance to the next volume in the list (no-op at the end). */
  next(): void;
  /** Go back to the previous volume in the list (no-op at the start). */
  prev(): void;
  /** Make the volume with the given ID active. No-op when the ID is not in the list. */
  selectVolume(id: string): void;
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
 * Headless hook for managing a multi-volume reading session. Pair it with
 * {@link MejiroReader} (driving its `epub` / `epubUrl` prop) or
 * {@link MejiroShelf} (visual picker).
 */
export function useLibrary<T = unknown>(options: UseLibraryOptions<T>): UseLibraryReturn<T> {
  const { volumes, initialVolumeId, onVolumeChange } = options;
  const [currentId, setCurrentId] = useState<string | null>(() =>
    resolveCurrentId(volumes, null, initialVolumeId),
  );
  // initialVolumeId keeps winning, even for a list that fills in later, until
  // the user navigates.
  const [navigated, setNavigated] = useState(false);
  const resolvedId = resolveCurrentId(volumes, currentId, navigated ? undefined : initialVolumeId);

  useEffect(() => {
    if (resolvedId === currentId) return;
    setCurrentId(resolvedId);
    const volume = volumes.find((v) => v.id === resolvedId);
    if (volume) onVolumeChange?.(volume);
  }, [currentId, resolvedId, volumes, onVolumeChange]);

  const index = useMemo(
    () => (resolvedId == null ? -1 : volumes.findIndex((v) => v.id === resolvedId)),
    [resolvedId, volumes],
  );

  const volume = useMemo<VolumeInfo<T> | null>(
    () => (index >= 0 && index < volumes.length ? volumes[index] : null),
    [index, volumes],
  );

  const activate = useCallback(
    (i: number) => {
      const v = volumes[i];
      if (!v) return;
      setNavigated(true);
      setCurrentId(v.id);
      onVolumeChange?.(v);
    },
    [volumes, onVolumeChange],
  );

  const next = useCallback(() => {
    if (index < 0) return;
    const ni = Math.min(volumes.length - 1, index + 1);
    if (ni !== index) activate(ni);
  }, [index, activate, volumes.length]);

  const prev = useCallback(() => {
    if (index < 0) return;
    const ni = Math.max(0, index - 1);
    if (ni !== index) activate(ni);
  }, [index, activate]);

  const selectVolume = useCallback(
    (id: string) => {
      const ni = volumes.findIndex((v) => v.id === id);
      if (ni < 0) return;
      if (ni !== index) activate(ni);
    },
    [index, volumes, activate],
  );

  return { list: volumes, volume, volumeIndex: index, next, prev, selectVolume };
}
