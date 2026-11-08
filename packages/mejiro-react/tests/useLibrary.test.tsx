// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLibrary } from '../src/useLibrary.js';

const volumes = [
  { id: 'a', label: 'Volume A' },
  { id: 'b', label: 'Volume B' },
  { id: 'c', label: 'Volume C' },
];

describe('useLibrary (React)', () => {
  it('starts on the first volume by default', () => {
    const { result } = renderHook(() => useLibrary({ volumes }));
    expect(result.current.volumeIndex).toBe(0);
    expect(result.current.volume?.id).toBe('a');
  });

  it('honors initialVolumeId', () => {
    const { result } = renderHook(() => useLibrary({ volumes, initialVolumeId: 'c' }));
    expect(result.current.volumeIndex).toBe(2);
  });

  it('next / prev / selectVolume update the active volume and fire onVolumeChange', () => {
    const onVolumeChange = vi.fn();
    const { result } = renderHook(() => useLibrary({ volumes, onVolumeChange }));
    act(() => result.current.next());
    expect(result.current.volume?.id).toBe('b');
    expect(onVolumeChange).toHaveBeenLastCalledWith(volumes[1]);
    act(() => result.current.selectVolume('c'));
    expect(result.current.volume?.id).toBe('c');
    act(() => result.current.prev());
    expect(result.current.volume?.id).toBe('b');
    expect(onVolumeChange).toHaveBeenCalledTimes(3);
  });

  it('returns a null volume for an empty library', () => {
    const { result } = renderHook(() => useLibrary({ volumes: [] }));
    expect(result.current.volume).toBeNull();
    expect(result.current.volumeIndex).toBe(-1);
  });

  it('keeps selection by id when volumes are replaced and resets on empty lists', () => {
    const { result, rerender } = renderHook(({ list }) => useLibrary({ volumes: list }), {
      initialProps: { list: volumes },
    });

    act(() => result.current.selectVolume('b'));
    expect(result.current.volumeIndex).toBe(1);

    const reordered = [volumes[2], volumes[1], volumes[0]];
    rerender({ list: reordered });
    expect(result.current.volume?.id).toBe('b');
    expect(result.current.volumeIndex).toBe(1);

    rerender({ list: [] });
    expect(result.current.volume).toBeNull();
    expect(result.current.volumeIndex).toBe(-1);
  });

  it('falls back immediately when the selected volume disappears', () => {
    const onVolumeChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ list }) => useLibrary({ volumes: list, onVolumeChange }),
      {
        initialProps: { list: volumes },
      },
    );

    act(() => result.current.selectVolume('c'));
    rerender({ list: [volumes[0], volumes[1]] });

    expect(result.current.volume?.id).toBe('a');
    expect(result.current.volumeIndex).toBe(0);
    expect(onVolumeChange).toHaveBeenLastCalledWith(volumes[0]);
  });

  it('opens initialVolumeId once a list arriving after mount contains it', () => {
    const onVolumeChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ list }) => useLibrary({ volumes: list, initialVolumeId: 'c', onVolumeChange }),
      { initialProps: { list: [] as typeof volumes } },
    );
    expect(result.current.volume).toBeNull();

    rerender({ list: volumes });

    expect(result.current.volume?.id).toBe('c');
    expect(result.current.volumeIndex).toBe(2);
    expect(onVolumeChange).toHaveBeenCalledTimes(1);
    expect(onVolumeChange).toHaveBeenLastCalledWith(volumes[2]);
  });

  it('switches to initialVolumeId when a later list adds it, until the user navigates', () => {
    const { result, rerender } = renderHook(
      ({ list }) => useLibrary({ volumes: list, initialVolumeId: 'c' }),
      { initialProps: { list: [volumes[0], volumes[1]] } },
    );
    expect(result.current.volume?.id).toBe('a');

    rerender({ list: volumes });
    expect(result.current.volume?.id).toBe('c');

    act(() => result.current.selectVolume('a'));
    rerender({ list: [...volumes] });
    expect(result.current.volume?.id).toBe('a');
  });
});
