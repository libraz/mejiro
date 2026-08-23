// @vitest-environment happy-dom

import { parseAnnotations, serializeAnnotations } from '@libraz/mejiro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, nextTick, ref } from 'vue';
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

function withSetup<T>(setup: () => T): { result: T; app: App; unmount: () => void } {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = setup();
        return () => null;
      },
    }),
  );
  app.mount(document.createElement('div'));
  return { result, app, unmount: () => app.unmount() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAnnotations (Vue) — onChange', () => {
  it('fires on add() with the new sorted list', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() => useAnnotations({ key: 'k', storage, onChange }));
    const added = result.add({
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 3 },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    expect(onChange.mock.calls[0][0][0].id).toBe(added.id);
    unmount();
  });

  it('fires on remove() / update() / clear()', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() => useAnnotations({ key: 'k', storage, onChange }));
    const { id } = result.add({
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    onChange.mockClear();

    result.update(id, { color: 'yellow' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].color).toBe('yellow');

    onChange.mockClear();
    result.remove(id);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(0);

    result.add({
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    onChange.mockClear();
    result.clear();
    expect(onChange).toHaveBeenCalledWith([]);
    unmount();
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
    const { unmount } = withSetup(() => useAnnotations({ key: 'k', storage, onChange }));
    expect(onChange).not.toHaveBeenCalled();
    unmount();
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

    const { result, unmount } = withSetup(() => useAnnotations({ key: 'k', storage }));

    expect(result.annotations.value.map((a) => a.id)).toEqual(['good-1', 'good-2']);
    unmount();
  });

  it('mounts with an empty list when every stored entry is malformed', () => {
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 1, annotations: [{}] }));

    const { result, unmount } = withSetup(() => useAnnotations({ key: 'k', storage }));

    expect(result.annotations.value).toEqual([]);
    unmount();
  });

  it('does not fire on no-op remove() / update()', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() => useAnnotations({ key: 'k', storage, onChange }));
    result.remove('does-not-exist');
    result.update('does-not-exist', { color: 'red' });
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });
});

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

function storedIds(storage: { data: Map<string, string> }, key: string): string[] {
  const raw = storage.data.get(key);
  if (!raw) return [];
  return (JSON.parse(raw) as { annotations: { id: string }[] }).annotations.map((a) => a.id);
}

describe('useAnnotations (Vue) — server round-trip', () => {
  it('round-trips through a server mirror fed by onChange', () => {
    let server: string | null = null;
    const first = withSetup(() =>
      useAnnotations({
        key: 'k',
        storage: memoryStorage(),
        onChange: (next) => {
          server = serializeAnnotations(next);
        },
      }),
    );

    const added = first.result.add({
      chapter: 2,
      start: { paragraph: 1, charIndex: 0 },
      end: { paragraph: 1, charIndex: 8 },
      color: 'yellow',
    });
    first.unmount();

    expect(parseAnnotations(server)).toEqual([added]);

    const revisit = withSetup(() =>
      useAnnotations({
        key: 'k',
        storage: {
          getItem: () => server,
          setItem: () => {},
          removeItem: () => {},
        },
      }),
    );
    expect(revisit.result.annotations.value).toEqual([added]);
    revisit.unmount();
  });
});

describe('useAnnotations (Vue) — pending writes', () => {
  it('flushes a pending mutation when the composable unmounts inside the throttle window', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useAnnotations({ key: 'k', storage, throttleMs: 100 }),
    );

    result.add({
      id: 'a1',
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    expect(storage.data.get('k')).toBeUndefined();

    unmount();

    expect(storedIds(storage, 'k')).toEqual(['a1']);
  });

  it('writes to storage once the throttle window elapses', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useAnnotations({ key: 'k', storage, throttleMs: 250 }),
    );

    result.add({
      id: 'a1',
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    vi.advanceTimersByTime(249);
    expect(storage.data.get('k')).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(storedIds(storage, 'k')).toEqual(['a1']);
    unmount();
  });

  it('collapses several mutations inside one throttle window into a single write', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const { result, unmount } = withSetup(() =>
      useAnnotations({ key: 'k', storage, throttleMs: 100 }),
    );

    result.add({
      id: 'a1',
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    result.add({
      id: 'a2',
      chapter: 1,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    vi.advanceTimersByTime(100);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(storedIds(storage, 'k')).toEqual(['a1', 'a2']);
    unmount();
  });

  it('does not resurrect cleared annotations when the composable unmounts', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useAnnotations({ key: 'k', storage, throttleMs: 100 }),
    );

    result.add({
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    result.clear();
    unmount();

    expect(storage.data.get('k')).toBeUndefined();
  });
});

describe('useAnnotations (Vue) — throwing storage', () => {
  it('mounts with an empty list when getItem throws', () => {
    const storage: AnnotationsStorage = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {},
      removeItem: () => {},
    };

    let result!: ReturnType<typeof useAnnotations>;
    expect(() => {
      ({ result } = withSetup(() => useAnnotations({ key: 'k', storage })));
    }).not.toThrow();
    expect(result.annotations.value).toEqual([]);
  });

  it('degrades to an empty list when getItem throws on a key change', async () => {
    const storage: AnnotationsStorage = {
      getItem: (k) => {
        if (k === 'b') throw new Error('storage disabled');
        return storedAnnotation('a1');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const key = ref('a');
    const { result, unmount } = withSetup(() => useAnnotations({ key, storage }));

    expect(result.annotations.value.map((a) => a.id)).toEqual(['a1']);
    key.value = 'b';
    await nextTick();
    expect(result.annotations.value).toEqual([]);
    unmount();
  });
});

describe('useAnnotations (Vue) — throwing write paths', () => {
  /** Storage whose named operations throw, as a disabled or full one does. */
  function throwingStorage(
    failing: ReadonlyArray<'setItem' | 'removeItem'>,
    seed?: string,
  ): AnnotationsStorage {
    return {
      getItem: () => seed ?? null,
      setItem: () => {
        if (failing.includes('setItem')) throw new Error('storage setItem unavailable');
      },
      removeItem: () => {
        if (failing.includes('removeItem')) throw new Error('storage removeItem unavailable');
      },
    };
  }

  it('keeps the in-memory copy when the throttled setItem throws', () => {
    const { result, unmount } = withSetup(() =>
      useAnnotations({ key: 'k', storage: throwingStorage(['setItem']), throttleMs: 100 }),
    );

    result.add({
      id: 'a1',
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();

    expect(result.annotations.value.map((a) => a.id)).toEqual(['a1']);
    unmount();
  });

  it('keeps the in-memory copy when a flush on unmount hits a throwing setItem', () => {
    const { result, unmount } = withSetup(() =>
      useAnnotations({ key: 'k', storage: throwingStorage(['setItem']), throttleMs: 100 }),
    );

    result.add({
      id: 'a1',
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });

    expect(() => unmount()).not.toThrow();
  });

  it('clears the in-memory list even when removeItem throws', () => {
    const { result, unmount } = withSetup(() =>
      useAnnotations({
        key: 'k',
        storage: throwingStorage(['removeItem'], storedAnnotation('a1')),
      }),
    );

    expect(result.annotations.value.map((a) => a.id)).toEqual(['a1']);
    expect(() => result.clear()).not.toThrow();

    expect(result.annotations.value).toEqual([]);
    unmount();
  });
});

describe('useAnnotations (Vue) — key changes', () => {
  it('keeps a throttled write in the key that was active when the mutation happened', async () => {
    const storage = memoryStorage();
    storage.setItem('b', storedAnnotation('b1'));
    const key = ref('a');
    const { result, unmount } = withSetup(() => useAnnotations({ key, storage, throttleMs: 100 }));

    result.add({
      id: 'a1',
      chapter: 0,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    key.value = 'b';
    await nextTick();
    vi.advanceTimersByTime(100);

    expect(storedIds(storage, 'a')).toEqual(['a1']);
    expect(storedIds(storage, 'b')).toEqual(['b1']);
    unmount();
  });

  it('re-hydrates from the new key and writes later mutations there', async () => {
    const storage = memoryStorage();
    storage.setItem('a', storedAnnotation('a1'));
    storage.setItem('b', storedAnnotation('b1'));
    const key = ref('a');
    const { result, unmount } = withSetup(() => useAnnotations({ key, storage, throttleMs: 100 }));

    expect(result.annotations.value.map((a) => a.id)).toEqual(['a1']);
    key.value = 'b';
    await nextTick();
    expect(result.annotations.value.map((a) => a.id)).toEqual(['b1']);

    result.add({
      id: 'b2',
      chapter: 1,
      start: { paragraph: 0, charIndex: 0 },
      end: { paragraph: 0, charIndex: 1 },
    });
    vi.advanceTimersByTime(100);

    expect(storedIds(storage, 'b')).toEqual(['b1', 'b2']);
    expect(storedIds(storage, 'a')).toEqual(['a1']);
    unmount();
  });
});
