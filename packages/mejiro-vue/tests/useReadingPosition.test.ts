// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, nextTick, ref } from 'vue';
import type { ReadingPositionStorage } from '../src/useReadingPosition.js';
import { useReadingPosition } from '../src/useReadingPosition.js';

function memoryStorage(): ReadingPositionStorage & { data: Map<string, string> } {
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

describe('useReadingPosition (Vue)', () => {
  it('returns null when no position is stored', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() => useReadingPosition({ key: 'k', storage }));
    expect(result.position.value).toBeNull();
    unmount();
  });

  it('hydrates a v2 anchor from storage on mount', () => {
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 2, paragraph: 7, charIndex: 12 }));
    const { result, unmount } = withSetup(() => useReadingPosition({ key: 'k', storage }));
    expect(result.position.value).toEqual({ chapter: 2, paragraph: 7, charIndex: 12 });
    unmount();
  });

  it('save() updates position immediately and writes a v2 payload after throttle', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, throttleMs: 100 }),
    );
    result.save({ chapter: 1, paragraph: 3, charIndex: 5 });
    expect(result.position.value).toEqual({ chapter: 1, paragraph: 3, charIndex: 5 });
    expect(storage.data.get('k')).toBeUndefined();
    vi.advanceTimersByTime(100);
    expect(JSON.parse(storage.data.get('k') ?? '{}')).toEqual({
      version: 2,
      chapter: 1,
      paragraph: 3,
      charIndex: 5,
    });
    unmount();
  });

  it('clear() removes both state and storage', () => {
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 4, paragraph: 0, charIndex: 0 }));
    const { result, unmount } = withSetup(() => useReadingPosition({ key: 'k', storage }));
    result.clear();
    expect(result.position.value).toBeNull();
    expect(storage.data.get('k')).toBeUndefined();
    unmount();
  });

  it('ignores malformed storage payloads', () => {
    const storage = memoryStorage();
    storage.setItem('k', 'not-json');
    const { result, unmount } = withSetup(() => useReadingPosition({ key: 'k', storage }));
    expect(result.position.value).toBeNull();
    unmount();
  });

  it('re-hydrates when the key changes', async () => {
    const storage = memoryStorage();
    storage.setItem('a', JSON.stringify({ version: 2, chapter: 1, paragraph: 1, charIndex: 0 }));
    storage.setItem('b', JSON.stringify({ version: 2, chapter: 2, paragraph: 2, charIndex: 0 }));
    const key = ref('a');
    const { result, unmount } = withSetup(() =>
      useReadingPosition({
        get key() {
          return key.value;
        },
        storage,
      }),
    );
    expect(result.position.value).toEqual({ chapter: 1, paragraph: 1, charIndex: 0 });
    key.value = 'b';
    await nextTick();
    expect(result.position.value).toEqual({ chapter: 2, paragraph: 2, charIndex: 0 });
    unmount();
  });

  it('writes throttled saves to the key that was active when save() was called', async () => {
    const storage = memoryStorage();
    const key = ref('a');
    const { result, unmount } = withSetup(() =>
      useReadingPosition({
        get key() {
          return key.value;
        },
        storage,
        throttleMs: 100,
      }),
    );

    result.save({ chapter: 1, paragraph: 1, charIndex: 1 });
    key.value = 'b';
    await nextTick();
    vi.advanceTimersByTime(100);

    expect(JSON.parse(storage.data.get('a') ?? '{}')).toEqual({
      version: 2,
      chapter: 1,
      paragraph: 1,
      charIndex: 1,
    });
    expect(storage.data.get('b')).toBeUndefined();
    unmount();
  });

  it('migrates legacy {chapter, spreadIdx} payloads to chapter start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ chapter: 5, spreadIdx: 12 }));
    const { result, unmount } = withSetup(() => useReadingPosition({ key: 'k', storage }));
    expect(result.position.value).toEqual({ chapter: 5, paragraph: 0, charIndex: 0 });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    unmount();
  });

  it('onChange fires synchronously on save() with the new anchor', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, onChange }),
    );
    result.save({ chapter: 2, paragraph: 1, charIndex: 9 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ chapter: 2, paragraph: 1, charIndex: 9 });
    unmount();
  });

  it('onChange fires with null on clear()', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 1, paragraph: 0, charIndex: 0 }));
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, onChange }),
    );
    result.clear();
    expect(onChange).toHaveBeenCalledWith(null);
    unmount();
  });

  it('onChange is not invoked during initial hydration', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 1, paragraph: 0, charIndex: 0 }));
    const { unmount } = withSetup(() => useReadingPosition({ key: 'k', storage, onChange }));
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });
});
