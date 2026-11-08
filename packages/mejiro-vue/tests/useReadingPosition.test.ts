// @vitest-environment happy-dom

import { parseReadingPosition, serializeReadingPosition } from '@libraz/mejiro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, nextTick, ref } from 'vue';
import type { MejiroStorage } from '../src/index.js';
import { useReadingPosition } from '../src/useReadingPosition.js';

function memoryStorage(): MejiroStorage & { data: Map<string, string> } {
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
    expect(result.position.value).toEqual({ chapterIndex: 2, paragraphIndex: 7, charIndex: 12 });
    unmount();
  });

  it('save() updates position immediately and writes a v3 payload after the debounce', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, debounceMs: 100 }),
    );
    result.save({ chapterIndex: 1, paragraphIndex: 3, charIndex: 5 });
    expect(result.position.value).toEqual({ chapterIndex: 1, paragraphIndex: 3, charIndex: 5 });
    expect(storage.data.get('k')).toBeUndefined();
    vi.advanceTimersByTime(100);
    expect(JSON.parse(storage.data.get('k') ?? '{}')).toEqual({
      version: 3,
      chapterIndex: 1,
      paragraphIndex: 3,
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
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, onError: () => {} }),
    );
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
    expect(result.position.value).toEqual({ chapterIndex: 1, paragraphIndex: 1, charIndex: 0 });
    key.value = 'b';
    await nextTick();
    expect(result.position.value).toEqual({ chapterIndex: 2, paragraphIndex: 2, charIndex: 0 });
    unmount();
  });

  it('writes debounced saves to the key that was active when save() was called', async () => {
    const storage = memoryStorage();
    const key = ref('a');
    const { result, unmount } = withSetup(() =>
      useReadingPosition({
        get key() {
          return key.value;
        },
        storage,
        debounceMs: 100,
      }),
    );

    result.save({ chapterIndex: 1, paragraphIndex: 1, charIndex: 1 });
    key.value = 'b';
    await nextTick();
    vi.advanceTimersByTime(100);

    expect(JSON.parse(storage.data.get('a') ?? '{}')).toEqual({
      version: 3,
      chapterIndex: 1,
      paragraphIndex: 1,
      charIndex: 1,
    });
    expect(storage.data.get('b')).toBeUndefined();
    unmount();
  });

  it('flushes a pending save() when the composable unmounts inside the debounce window', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, debounceMs: 100 }),
    );

    result.save({ chapterIndex: 3, paragraphIndex: 2, charIndex: 8 });
    expect(storage.data.get('k')).toBeUndefined();

    unmount();

    expect(JSON.parse(storage.data.get('k') ?? '{}')).toEqual({
      version: 3,
      chapterIndex: 3,
      paragraphIndex: 2,
      charIndex: 8,
    });
  });

  it('does not resurrect a cleared position when the composable unmounts', () => {
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, debounceMs: 100 }),
    );

    result.save({ chapterIndex: 3, paragraphIndex: 2, charIndex: 8 });
    result.clear();
    unmount();

    expect(storage.data.get('k')).toBeUndefined();
  });

  it('re-hydrates and saves to the new key when a Ref key changes', async () => {
    const storage = memoryStorage();
    storage.setItem('a', JSON.stringify({ version: 2, chapter: 1, paragraph: 1, charIndex: 0 }));
    storage.setItem('b', JSON.stringify({ version: 2, chapter: 2, paragraph: 2, charIndex: 0 }));
    const key = ref('a');
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key, storage, debounceMs: 100 }),
    );

    expect(result.position.value).toEqual({ chapterIndex: 1, paragraphIndex: 1, charIndex: 0 });
    key.value = 'b';
    await nextTick();
    expect(result.position.value).toEqual({ chapterIndex: 2, paragraphIndex: 2, charIndex: 0 });

    result.save({ chapterIndex: 9, paragraphIndex: 0, charIndex: 4 });
    vi.advanceTimersByTime(100);

    expect(JSON.parse(storage.data.get('b') ?? '{}')).toEqual({
      version: 3,
      chapterIndex: 9,
      paragraphIndex: 0,
      charIndex: 4,
    });
    expect(JSON.parse(storage.data.get('a') ?? '{}')).toEqual({
      version: 2,
      chapter: 1,
      paragraph: 1,
      charIndex: 0,
    });
    unmount();
  });

  it('does not let a pending write from the previous key overwrite the new key', async () => {
    const storage = memoryStorage();
    storage.setItem('b', JSON.stringify({ version: 2, chapter: 2, paragraph: 2, charIndex: 0 }));
    const key = ref('a');
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key, storage, debounceMs: 100 }),
    );

    result.save({ chapterIndex: 1, paragraphIndex: 3, charIndex: 5 });
    key.value = 'b';
    await nextTick();
    vi.advanceTimersByTime(100);

    expect(JSON.parse(storage.data.get('a') ?? '{}')).toEqual({
      version: 3,
      chapterIndex: 1,
      paragraphIndex: 3,
      charIndex: 5,
    });
    expect(JSON.parse(storage.data.get('b') ?? '{}')).toEqual({
      version: 2,
      chapter: 2,
      paragraph: 2,
      charIndex: 0,
    });
    unmount();
  });

  it('resumes a stored position that names only a chapter at the chapter start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ chapter: 5, spreadIdx: 12 }));
    const { result, unmount } = withSetup(() => useReadingPosition({ key: 'k', storage }));
    expect(result.position.value).toEqual({ chapterIndex: 5, paragraphIndex: 0, charIndex: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    unmount();
  });

  it('onPositionChange fires synchronously on save() with the new anchor', () => {
    const onPositionChange = vi.fn();
    const storage = memoryStorage();
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, onPositionChange }),
    );
    result.save({ chapterIndex: 2, paragraphIndex: 1, charIndex: 9 });
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenCalledWith({
      chapterIndex: 2,
      paragraphIndex: 1,
      charIndex: 9,
    });
    unmount();
  });

  it('onPositionChange fires with null on clear()', () => {
    const onPositionChange = vi.fn();
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 1, paragraph: 0, charIndex: 0 }));
    const { result, unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, onPositionChange }),
    );
    result.clear();
    expect(onPositionChange).toHaveBeenCalledWith(null);
    unmount();
  });

  it('onPositionChange is not invoked during initial hydration', () => {
    const onPositionChange = vi.fn();
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 1, paragraph: 0, charIndex: 0 }));
    const { unmount } = withSetup(() =>
      useReadingPosition({ key: 'k', storage, onPositionChange }),
    );
    expect(onPositionChange).not.toHaveBeenCalled();
    unmount();
  });

  it('round-trips through a server mirror fed by onPositionChange', () => {
    let server: string | null = null;
    const first = withSetup(() =>
      useReadingPosition({
        key: 'k',
        storage: memoryStorage(),
        onPositionChange: (next) => {
          server = next === null ? null : serializeReadingPosition(next);
        },
      }),
    );

    first.result.save({ chapterIndex: 4, paragraphIndex: 6, charIndex: 11 });
    first.unmount();

    expect(parseReadingPosition(server)).toEqual({
      chapterIndex: 4,
      paragraphIndex: 6,
      charIndex: 11,
    });

    const revisit = withSetup(() =>
      useReadingPosition({
        key: 'k',
        storage: {
          getItem: () => server,
          setItem: () => {},
          removeItem: () => {},
        },
      }),
    );
    expect(revisit.result.position.value).toEqual({
      chapterIndex: 4,
      paragraphIndex: 6,
      charIndex: 11,
    });
    revisit.unmount();
  });
});
