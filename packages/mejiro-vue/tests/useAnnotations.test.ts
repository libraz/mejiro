// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent } from 'vue';
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
