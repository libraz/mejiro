// @vitest-environment happy-dom

import type { MejiroStorage } from '@libraz/mejiro';
import { parseAnnotations, parseReadingPosition } from '@libraz/mejiro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, effectScope } from 'vue';
import { useAnnotations } from '../src/useAnnotations.js';
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

function withSetup<T>(setup: () => T): { result: T; unmount: () => void } {
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
  return { result, unmount: () => app.unmount() };
}

const ANCHOR = { chapter: 1, paragraph: 2, charIndex: 3 };
const NOTE = {
  chapter: 0,
  start: { paragraph: 2, charIndex: 3 },
  end: { paragraph: 2, charIndex: 9 },
  color: 'yellow',
};

let original: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
});

afterEach(() => {
  vi.useRealTimers();
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** Makes reading `globalThis.localStorage` throw, as in a sandboxed iframe. */
function denyLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
}

describe('persistence composables (Vue) — denied default storage', () => {
  it('useReadingPosition falls back to in-memory state', () => {
    denyLocalStorage();
    const { result } = withSetup(() => useReadingPosition({ key: 'k' }));
    expect(result.position.value).toBeNull();
    result.save(ANCHOR);
    vi.advanceTimersByTime(500);
    expect(result.position.value).toEqual(ANCHOR);
  });

  it('useAnnotations falls back to in-memory state', () => {
    denyLocalStorage();
    const { result } = withSetup(() => useAnnotations({ key: 'k' }));
    expect(result.annotations.value).toEqual([]);
    result.add(NOTE);
    vi.advanceTimersByTime(500);
    expect(result.annotations.value).toHaveLength(1);
  });
});

describe.each(['pagehide', 'beforeunload'])('persistence composables (Vue) — %s', (type) => {
  it('useReadingPosition flushes the pending save', () => {
    const storage = memoryStorage();
    const { result } = withSetup(() => useReadingPosition({ key: 'k', storage }));
    result.save(ANCHOR);
    expect(storage.data.has('k')).toBe(false);
    window.dispatchEvent(new Event(type));
    expect(parseReadingPosition(storage.data.get('k') ?? null)).toEqual(ANCHOR);
  });

  it('useAnnotations flushes the pending mutation', () => {
    const storage = memoryStorage();
    const { result } = withSetup(() => useAnnotations({ key: 'k', storage }));
    result.add(NOTE);
    expect(storage.data.has('k')).toBe(false);
    window.dispatchEvent(new Event(type));
    expect(parseAnnotations(storage.data.get('k') ?? null)).toHaveLength(1);
  });
});

describe('persistence composables (Vue) — bare effectScope disposal', () => {
  it('useAnnotations flushes the pending mutation exactly once and detaches its listeners', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const scope = effectScope();
    const result = scope.run(() => useAnnotations({ key: 'k', storage }));
    result?.add(NOTE);
    scope.stop();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(parseAnnotations(storage.data.get('k') ?? null)).toHaveLength(1);
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(500);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('useReadingPosition flushes the pending save exactly once', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const scope = effectScope();
    const result = scope.run(() => useReadingPosition({ key: 'k', storage }));
    result?.save(ANCHOR);
    scope.stop();
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe('useAnnotations (Vue) — update()', () => {
  it('keeps the previous value for every patch key set to undefined', () => {
    const storage = memoryStorage();
    const { result } = withSetup(() => useAnnotations({ key: 'k', storage }));
    const { id } = result.add({ ...NOTE, note: 'n' });
    result.update(id, {
      chapter: undefined,
      start: undefined,
      end: undefined,
      color: undefined,
      note: 'changed',
    });
    expect(result.annotations.value[0]).toMatchObject({ ...NOTE, id, note: 'changed' });
    vi.advanceTimersByTime(500);
    expect(parseAnnotations(storage.data.get('k') ?? null)[0]).toMatchObject({
      ...NOTE,
      note: 'changed',
    });
  });
});
