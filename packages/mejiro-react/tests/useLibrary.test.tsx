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
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.current?.id).toBe('a');
  });

  it('honors initialVolumeId', () => {
    const { result } = renderHook(() => useLibrary({ volumes, initialVolumeId: 'c' }));
    expect(result.current.currentIndex).toBe(2);
  });

  it('next / prev / goTo update the active volume and fire onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useLibrary({ volumes, onChange }));
    act(() => result.current.next());
    expect(result.current.current?.id).toBe('b');
    expect(onChange).toHaveBeenLastCalledWith(volumes[1]);
    act(() => result.current.goTo('c'));
    expect(result.current.current?.id).toBe('c');
    act(() => result.current.prev());
    expect(result.current.current?.id).toBe('b');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('returns null current for an empty library', () => {
    const { result } = renderHook(() => useLibrary({ volumes: [] }));
    expect(result.current.current).toBeNull();
    expect(result.current.currentIndex).toBe(-1);
  });

  it('keeps selection by id when volumes are replaced and resets on empty lists', () => {
    const { result, rerender } = renderHook(({ list }) => useLibrary({ volumes: list }), {
      initialProps: { list: volumes },
    });

    act(() => result.current.goTo('b'));
    expect(result.current.currentIndex).toBe(1);

    const reordered = [volumes[2], volumes[1], volumes[0]];
    rerender({ list: reordered });
    expect(result.current.current?.id).toBe('b');
    expect(result.current.currentIndex).toBe(1);

    rerender({ list: [] });
    expect(result.current.current).toBeNull();
    expect(result.current.currentIndex).toBe(-1);
  });

  it('falls back immediately when the selected volume disappears', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(({ list }) => useLibrary({ volumes: list, onChange }), {
      initialProps: { list: volumes },
    });

    act(() => result.current.goTo('c'));
    rerender({ list: [volumes[0], volumes[1]] });

    expect(result.current.current?.id).toBe('a');
    expect(result.current.currentIndex).toBe(0);
    expect(onChange).toHaveBeenLastCalledWith(volumes[0]);
  });
});
