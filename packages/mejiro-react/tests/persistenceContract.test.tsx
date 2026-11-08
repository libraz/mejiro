// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { type MejiroStorage, useAnnotations, useReadingPosition } from '../src/index.js';

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

/** A storage whose named methods throw; the rest delegate to a memory store. */
function failingStorage(failing: readonly (keyof MejiroStorage)[]): MejiroStorage {
  const inner = memoryStorage();
  const fail = (name: keyof MejiroStorage) => {
    if (failing.includes(name)) throw new Error(`${name} denied`);
  };
  return {
    getItem: (k) => {
      fail('getItem');
      return inner.getItem(k);
    },
    setItem: (k, v) => {
      fail('setItem');
      inner.setItem(k, v);
    },
    removeItem: (k) => {
      fail('removeItem');
      inner.removeItem(k);
    },
  };
}

const range = {
  chapterIndex: 1,
  start: { paragraphIndex: 0, charIndex: 0 },
  end: { paragraphIndex: 0, charIndex: 2 },
};

const anchor = { chapterIndex: 2, paragraphIndex: 3, charIndex: 4 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('persistence hooks report storage failures', () => {
  it('reports unreadable stored annotations as storage-corrupt and leaves them in place', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{not json');
    const onError = vi.fn();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage, onError }));

    expect(result.current.annotations).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      name: 'MejiroError',
      code: 'storage-corrupt',
    });
    act(() => vi.runAllTimers());
    expect(storage.data.get('k')).toBe('{not json');

    act(() => {
      result.current.add(range);
    });
    act(() => vi.runAllTimers());
    expect(storage.data.get('k')).not.toBe('{not json');
  });

  it('reports an unreadable stored position as storage-corrupt', () => {
    const storage = memoryStorage();
    storage.setItem('p', JSON.stringify({ version: 99, chapterIndex: 0 }));
    const onError = vi.fn();
    const { result } = renderHook(() => useReadingPosition({ key: 'p', storage, onError }));

    expect(result.current.position).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      name: 'MejiroError',
      code: 'storage-corrupt',
    });
  });

  it('reports nothing when the key was never written', () => {
    const onError = vi.fn();
    renderHook(() => useAnnotations({ key: 'k', storage: memoryStorage(), onError }));
    renderHook(() => useReadingPosition({ key: 'p', storage: memoryStorage(), onError }));
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a throwing getItem as storage-read-failed', () => {
    const onError = vi.fn();
    renderHook(() => useAnnotations({ key: 'k', storage: failingStorage(['getItem']), onError }));
    renderHook(() =>
      useReadingPosition({ key: 'p', storage: failingStorage(['getItem']), onError }),
    );
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      'storage-read-failed',
      'storage-read-failed',
    ]);
  });

  it('reports a throwing setItem as storage-write-failed and keeps the in-memory value', () => {
    const onError = vi.fn();
    const annotations = renderHook(() =>
      useAnnotations({ key: 'k', storage: failingStorage(['setItem']), onError }),
    );
    const position = renderHook(() =>
      useReadingPosition({ key: 'p', storage: failingStorage(['setItem']), onError }),
    );
    act(() => {
      annotations.result.current.add(range);
      position.result.current.save(anchor);
    });
    act(() => vi.runAllTimers());

    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      'storage-write-failed',
      'storage-write-failed',
    ]);
    expect(annotations.result.current.annotations).toHaveLength(1);
    expect(position.result.current.position).toEqual(anchor);
  });

  it('reports a throwing removeItem as storage-write-failed', () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useReadingPosition({ key: 'p', storage: failingStorage(['removeItem']), onError }),
    );
    act(() => result.current.clear());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'storage-write-failed' });
  });

  it('falls back to console.warn without onError', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem('k', '[[');
    renderHook(() => useAnnotations({ key: 'k', storage }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ code: 'storage-corrupt' });
  });
});

describe('persistence hooks debounce writes by debounceMs', () => {
  it('writes the latest value debounceMs after the last change', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useReadingPosition({ key: 'p', storage, debounceMs: 100 }));
    act(() => result.current.save(anchor));
    act(() => vi.advanceTimersByTime(99));
    expect(storage.data.has('p')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(JSON.parse(storage.data.get('p') ?? 'null')).toMatchObject(anchor);
  });

  it('notifies changes through onAnnotationsChange and onPositionChange', () => {
    const onAnnotationsChange = vi.fn();
    const onPositionChange = vi.fn();
    const annotations = renderHook(() =>
      useAnnotations({ key: 'k', storage: memoryStorage(), onAnnotationsChange }),
    );
    const position = renderHook(() =>
      useReadingPosition({ key: 'p', storage: memoryStorage(), onPositionChange }),
    );
    act(() => {
      annotations.result.current.add(range);
      position.result.current.save(anchor);
    });
    expect(onAnnotationsChange.mock.calls[0][0]).toMatchObject([range]);
    expect(onPositionChange).toHaveBeenCalledWith(anchor);
  });

  it('types the debounce as debounceMs and rejects throttleMs', () => {
    expectTypeErrors(
      `import { useAnnotations, useReadingPosition } from '@libraz/mejiro-react';
useAnnotations({ key: 'k', debounceMs: 100 });
useReadingPosition({ key: 'p', debounceMs: 100 });
useAnnotations({ key: 'k', throttleMs: 100 });
useReadingPosition({ key: 'p', throttleMs: 100 });`,
      {
        fails: [
          "useAnnotations({ key: 'k', throttleMs",
          "useReadingPosition({ key: 'p', throttleMs",
        ],
      },
    );
  });
});

describe('persistence hooks share the MejiroStorage type', () => {
  it('exports MejiroStorage and no per-hook storage alias', () => {
    expectTypeErrors(
      `import type { MejiroStorage as Core } from '@libraz/mejiro';
import type { MejiroStorage, UseAnnotationsOptions, UseReadingPositionOptions } from '@libraz/mejiro-react';
import type { AnnotationsStorage } from '@libraz/mejiro-react';
import type { ReadingPositionStorage } from '@libraz/mejiro-react';
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const a: Same<MejiroStorage, Core> = true;
export const b: Same<NonNullable<UseAnnotationsOptions['storage']>, Core> = true;
export const c: Same<NonNullable<UseReadingPositionOptions['storage']>, Core> = true;`,
      { fails: ['{ AnnotationsStorage }', '{ ReadingPositionStorage }'] },
    );
  });
});
