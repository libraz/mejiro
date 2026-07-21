// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationsStorage } from '../src/useAnnotations.js';
import { useAnnotations } from '../src/useAnnotations.js';

function memoryStorage(): AnnotationsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAnnotations (React) — onChange', () => {
  it('fires on add() with the new sorted list', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, onChange }));
    let added: { id: string } | undefined;
    act(() => {
      added = result.current.add({
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 3 },
      });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    expect(onChange.mock.calls[0][0][0].id).toBe(added?.id);
  });

  it('fires on remove() / update() / clear()', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, onChange }));
    let id = '';
    act(() => {
      id = result.current.add({
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      }).id;
    });
    onChange.mockClear();

    act(() => {
      result.current.update(id, { color: 'yellow' });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].color).toBe('yellow');

    onChange.mockClear();
    act(() => {
      result.current.remove(id);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(0);

    onChange.mockClear();
    act(() => {
      result.current.add({
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });
    onChange.mockClear();
    act(() => {
      result.current.clear();
    });
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('does not fire on initial hydration', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    storage.setItem(
      'k',
      JSON.stringify({
        version: 1,
        annotations: [
          {
            id: 'a',
            chapter: 0,
            start: { paragraph: 0, charIndex: 0 },
            end: { paragraph: 0, charIndex: 1 },
          },
        ],
      }),
    );
    renderHook(() => useAnnotations({ key: 'k', storage, onChange }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops malformed stored annotations instead of exposing invalid values', () => {
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 1, annotations: [{}] }));

    const { result } = renderHook(() => useAnnotations({ key: 'k', storage }));

    expect(result.current.annotations).toEqual([]);
  });

  it('does not fire on no-op remove() / update()', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, onChange }));
    act(() => {
      result.current.remove('does-not-exist');
      result.current.update('does-not-exist', { color: 'red' });
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
