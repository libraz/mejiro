// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { type MejiroStorage, useAnnotations, useReadingPosition } from '../src/index.js';

function harness<T>(setup: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = setup();
        return () => h('div');
      },
    }),
  );
  return { result, unmount: () => wrapper.unmount() };
}

/** In-memory storage whose listed operations throw, as a disabled or full one does. */
function storage(
  seed: Record<string, string> = {},
  failing: ReadonlyArray<keyof MejiroStorage> = [],
): MejiroStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  const guard = (op: keyof MejiroStorage) => {
    if (failing.includes(op)) throw new Error(`${op} denied`);
  };
  return {
    data,
    getItem: (key) => {
      guard('getItem');
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      guard('setItem');
      data.set(key, value);
    },
    removeItem: (key) => {
      guard('removeItem');
      data.delete(key);
    },
  };
}

const RANGE = {
  chapterIndex: 0,
  start: { paragraphIndex: 0, charIndex: 0 },
  end: { paragraphIndex: 0, charIndex: 2 },
};
const ANCHOR = { chapterIndex: 1, paragraphIndex: 2, charIndex: 3 };

/** Each persistence composable, driven through one change. */
const composables = [
  {
    name: 'useAnnotations',
    use: (backend: MejiroStorage, onError?: (error: unknown) => void) =>
      useAnnotations({ key: 'k', storage: backend, debounceMs: 100, onError }),
    change: (state: ReturnType<typeof useAnnotations>) => state.add(RANGE),
    clear: (state: ReturnType<typeof useAnnotations>) => state.clear(),
  },
  {
    name: 'useReadingPosition',
    use: (backend: MejiroStorage, onError?: (error: unknown) => void) =>
      useReadingPosition({ key: 'k', storage: backend, debounceMs: 100, onError }),
    change: (state: ReturnType<typeof useReadingPosition>) => state.save(ANCHOR),
    clear: (state: ReturnType<typeof useReadingPosition>) => state.clear(),
  },
] as const;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(composables)('$name (Vue) — storage failures', ({ use, change, clear }) => {
  it('reports a throwing getItem as storage-read-failed', () => {
    const onError = vi.fn();
    harness(() => use(storage({}, ['getItem']), onError));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      name: 'MejiroError',
      code: 'storage-read-failed',
    });
  });

  it('reports a throwing setItem as storage-write-failed once the debounce elapses', () => {
    const onError = vi.fn();
    const { result } = harness(() => use(storage({}, ['setItem']), onError));

    change(result as never);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'storage-write-failed' });
  });

  it('reports a throwing removeItem as storage-write-failed', () => {
    const onError = vi.fn();
    const { result } = harness(() => use(storage({}, ['removeItem']), onError));

    change(result as never);
    clear(result as never);

    expect(onError.mock.calls.map(([error]) => error.code)).toEqual(['storage-write-failed']);
  });

  it('reports unreadable data as storage-corrupt and leaves it in place until the first change', () => {
    const onError = vi.fn();
    const backend = storage({ k: '{not json' });
    const { unmount } = harness(() => use(backend, onError));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'storage-corrupt' });
    unmount();
    expect(backend.data.get('k')).toBe('{not json');

    const second = harness(() => use(backend, () => {}));
    change(second.result as never);
    vi.advanceTimersByTime(100);
    expect(backend.data.get('k')).not.toBe('{not json');
  });

  it('warns on the console when no onError is given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    harness(() => use(storage({}, ['getItem'])));

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('writes only after debounceMs has passed since the last change', () => {
    const backend = storage();
    const { result } = harness(() => use(backend, vi.fn()));

    change(result as never);
    vi.advanceTimersByTime(99);
    expect(backend.data.has('k')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(backend.data.has('k')).toBe(true);
  });
});

describe('persistence composables (Vue) — public types', () => {
  it('take the shared storage type, reactive keys and renamed handlers', () => {
    expectTypeErrors(
      `import type { MejiroError, ReadingAnchor } from '@libraz/mejiro';
import { type MejiroStorage, useAnnotations, useReadingPosition } from '@libraz/mejiro-vue';
import { ref } from 'vue';
declare const storage: MejiroStorage;
const key = ref('k');
const onError = (error: MejiroError): void => void error.code;
const notes = useAnnotations({ key, storage, debounceMs: 10, onAnnotationsChange: () => {}, onError });
const position = useReadingPosition({ key: () => key.value, onPositionChange: () => {}, onError });
const anchor: ReadingAnchor | null = position.position.value;
notes.annotations.value = [];
position.position.value = null;
useAnnotations({ key, throttleMs: 10 });
useReadingPosition({ key, onChange: () => {} });`,
      {
        fails: [
          'notes.annotations.value = [];',
          'position.position.value = null;',
          'throttleMs: 10',
          '{ key, onChange: () => {} }',
        ],
      },
    );
  });
});
