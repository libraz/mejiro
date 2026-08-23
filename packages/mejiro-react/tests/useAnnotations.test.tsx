// @vitest-environment happy-dom
/** @jsxImportSource react */

import { parseAnnotations, serializeAnnotations } from '@libraz/mejiro';
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
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

/** Serialized payload holding a single annotation with the given id. */
function storedAnnotation(id: string): string {
  return JSON.stringify({
    version: 1,
    annotations: [
      {
        id,
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      },
    ],
  });
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

  it('drops only the malformed entries and keeps the valid ones', () => {
    const storage = memoryStorage();
    const valid = (id: string, chapter: number) => ({
      id,
      chapter,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    storage.setItem(
      'k',
      JSON.stringify({
        version: 1,
        annotations: [
          valid('good-1', 0),
          {},
          null,
          7,
          { ...valid('bad-range', 1), end: { paragraph: 0, charIndex: 'x' } },
          valid('good-2', 2),
        ],
      }),
    );

    const { result } = renderHook(() => useAnnotations({ key: 'k', storage }));

    expect(result.current.annotations.map((annotation) => annotation.id)).toEqual([
      'good-1',
      'good-2',
    ]);
  });

  it('exposes an empty list when every stored entry is malformed', () => {
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

describe('useAnnotations (React) — server round-trip', () => {
  it('round-trips through a server mirror fed by onChange', () => {
    let server: string | null = null;
    const first = renderHook(() =>
      useAnnotations({
        key: 'k',
        storage: memoryStorage(),
        onChange: (next) => {
          server = serializeAnnotations(next);
        },
      }),
    );

    let added: { id: string } | undefined;
    act(() => {
      added = first.result.current.add({
        chapter: 2,
        start: { paragraph: 1, charIndex: 0 },
        end: { paragraph: 1, charIndex: 8 },
        color: 'yellow',
      });
    });
    first.unmount();

    expect(parseAnnotations(server)).toEqual([added]);

    const revisit = renderHook(() =>
      useAnnotations({
        key: 'k',
        storage: {
          getItem: () => server,
          setItem: () => {},
          removeItem: () => {},
        },
      }),
    );
    expect(revisit.result.current.annotations).toEqual([added]);
  });
});

describe('useAnnotations (React) — StrictMode', () => {
  it('fires onChange once per add() under StrictMode', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, onChange }), {
      wrapper: StrictMode,
    });

    act(() => {
      result.current.add({
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 3 },
      });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(result.current.annotations).toHaveLength(1);
  });

  it('fires onChange once per remove() / update() / clear() under StrictMode', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, onChange }), {
      wrapper: StrictMode,
    });

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

    onChange.mockClear();
    act(() => {
      result.current.remove(id);
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    onChange.mockClear();
    act(() => {
      result.current.clear();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('composes consecutive add() calls made in the same tick', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage }), {
      wrapper: StrictMode,
    });

    act(() => {
      result.current.add({
        id: 'a1',
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
      result.current.add({
        id: 'a2',
        chapter: 1,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });

    expect(result.current.annotations.map((annotation) => annotation.id)).toEqual(['a1', 'a2']);
  });
});

describe('useAnnotations (React) — pending writes', () => {
  it('flushes a pending mutation when the hook unmounts inside the throttle window', () => {
    const storage = memoryStorage();
    const { result, unmount } = renderHook(() =>
      useAnnotations({ key: 'k', storage, throttleMs: 100 }),
    );

    act(() => {
      result.current.add({
        id: 'a1',
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });
    expect(storage.data.get('k')).toBeUndefined();

    unmount();

    expect(
      JSON.parse(storage.data.get('k') ?? '{}').annotations.map((a: { id: string }) => a.id),
    ).toEqual(['a1']);
  });

  it('writes to storage once the throttle window elapses', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, throttleMs: 250 }));

    act(() => {
      result.current.add({
        id: 'a1',
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(storage.data.get('k')).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(parseAnnotations(storage.data.get('k') ?? null).map((a) => a.id)).toEqual(['a1']);
  });

  it('collapses several mutations inside one throttle window into a single write', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, throttleMs: 100 }));

    act(() => {
      result.current.add({
        id: 'a1',
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
      result.current.add({
        id: 'a2',
        chapter: 1,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(parseAnnotations(storage.data.get('k') ?? null).map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('does not resurrect cleared annotations when the hook unmounts', () => {
    const storage = memoryStorage();
    const { result, unmount } = renderHook(() =>
      useAnnotations({ key: 'k', storage, throttleMs: 100 }),
    );

    act(() => {
      result.current.add({
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
      result.current.clear();
    });
    unmount();

    expect(storage.data.get('k')).toBeUndefined();
  });

  it('lands a pending mutation in the key it was made under when the key changes', () => {
    const storage = memoryStorage();
    storage.setItem('b', storedAnnotation('b1'));
    const { result, rerender } = renderHook(
      ({ key }) => useAnnotations({ key, storage, throttleMs: 100 }),
      { initialProps: { key: 'a' } },
    );

    act(() => {
      result.current.add({
        id: 'a1',
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });
    rerender({ key: 'b' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    const ids = (raw: string | undefined): string[] =>
      raw ? JSON.parse(raw).annotations.map((a: { id: string }) => a.id) : [];
    expect(ids(storage.data.get('a'))).toEqual(['a1']);
    expect(ids(storage.data.get('b'))).toEqual(['b1']);
  });
});

describe('useAnnotations (React) — throwing storage', () => {
  /** Storage whose named operations throw, as a disabled or full one does. */
  function throwingStorage(
    failing: ReadonlyArray<'getItem' | 'setItem' | 'removeItem'>,
    seed?: string,
  ): AnnotationsStorage {
    const fail = (op: string) => {
      throw new Error(`storage ${op} unavailable`);
    };
    return {
      getItem: () => (failing.includes('getItem') ? fail('getItem') : (seed ?? null)),
      setItem: () => {
        if (failing.includes('setItem')) fail('setItem');
      },
      removeItem: () => {
        if (failing.includes('removeItem')) fail('removeItem');
      },
    };
  }

  it('mounts with an empty list when getItem throws', () => {
    let result: { current: { annotations: readonly unknown[] } } | undefined;
    expect(() => {
      result = renderHook(() =>
        useAnnotations({ key: 'k', storage: throwingStorage(['getItem']) }),
      ).result;
    }).not.toThrow();

    expect(result?.current.annotations).toEqual([]);
  });

  it('degrades to an empty list when getItem throws on a key change', () => {
    const storage: AnnotationsStorage = {
      getItem: (k) => {
        if (k === 'b') throw new Error('storage disabled');
        return storedAnnotation('a1');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const { result, rerender } = renderHook(({ key }) => useAnnotations({ key, storage }), {
      initialProps: { key: 'a' },
    });

    expect(result.current.annotations.map((a) => a.id)).toEqual(['a1']);
    rerender({ key: 'b' });
    expect(result.current.annotations).toEqual([]);
  });

  it('keeps the in-memory copy when the throttled setItem throws', () => {
    const { result } = renderHook(() =>
      useAnnotations({ key: 'k', storage: throwingStorage(['setItem']), throttleMs: 100 }),
    );

    act(() => {
      result.current.add({
        id: 'a1',
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }).not.toThrow();

    expect(result.current.annotations.map((a) => a.id)).toEqual(['a1']);
  });

  it('keeps the in-memory copy when a flush on unmount hits a throwing setItem', () => {
    const { result, unmount } = renderHook(() =>
      useAnnotations({ key: 'k', storage: throwingStorage(['setItem']), throttleMs: 100 }),
    );

    act(() => {
      result.current.add({
        id: 'a1',
        chapter: 0,
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 1 },
      });
    });

    expect(() => unmount()).not.toThrow();
  });

  it('clears the in-memory list even when removeItem throws', () => {
    const { result } = renderHook(() =>
      useAnnotations({
        key: 'k',
        storage: throwingStorage(['removeItem'], storedAnnotation('a1')),
      }),
    );

    expect(result.current.annotations.map((a) => a.id)).toEqual(['a1']);
    expect(() => {
      act(() => {
        result.current.clear();
      });
    }).not.toThrow();

    expect(result.current.annotations).toEqual([]);
  });
});

describe('useAnnotations (React) — storage identity', () => {
  it('settles after mount when storage is a new object literal on every render', () => {
    const data = new Map<string, string>();
    data.set('k', storedAnnotation('a1'));
    let renders = 0;

    const { result } = renderHook(() => {
      renders++;
      return useAnnotations({
        key: 'k',
        storage: {
          getItem: (k) => data.get(k) ?? null,
          setItem: (k, v) => {
            data.set(k, v);
          },
          removeItem: (k) => {
            data.delete(k);
          },
        },
      });
    });

    expect(renders).toBeLessThanOrEqual(2);
    expect(result.current.annotations.map((annotation) => annotation.id)).toEqual(['a1']);
  });

  it('re-hydrates on key changes only, not on a new storage reference', () => {
    const data = new Map<string, string>();
    data.set('a', storedAnnotation('a1'));
    data.set('b', storedAnnotation('b1'));
    const getItem = vi.fn((k: string) => data.get(k) ?? null);
    let renders = 0;

    const { result, rerender } = renderHook(
      ({ key }) => {
        renders++;
        return useAnnotations({
          key,
          storage: {
            getItem,
            setItem: (k, v) => {
              data.set(k, v);
            },
            removeItem: (k) => {
              data.delete(k);
            },
          },
        });
      },
      { initialProps: { key: 'a' } },
    );

    expect(result.current.annotations.map((annotation) => annotation.id)).toEqual(['a1']);
    const rendersAfterMount = renders;
    const readsAfterMount = getItem.mock.calls.length;

    rerender({ key: 'a' });

    expect(getItem).toHaveBeenCalledTimes(readsAfterMount);
    expect(renders).toBe(rendersAfterMount + 1);
    expect(result.current.annotations.map((annotation) => annotation.id)).toEqual(['a1']);

    rerender({ key: 'b' });

    expect(getItem.mock.calls.length).toBeGreaterThan(readsAfterMount);
    expect(result.current.annotations.map((annotation) => annotation.id)).toEqual(['b1']);
  });
});
