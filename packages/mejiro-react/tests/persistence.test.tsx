// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { MejiroStorage } from '@libraz/mejiro';
import { parseAnnotations, parseReadingPosition } from '@libraz/mejiro';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('persistence hooks (React) — denied default storage', () => {
  it('useReadingPosition falls back to in-memory state', () => {
    denyLocalStorage();
    const { result } = renderHook(() => useReadingPosition({ key: 'k' }));
    expect(result.current.position).toBeNull();
    act(() => result.current.save(ANCHOR));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.position).toEqual(ANCHOR);
  });

  it('useAnnotations falls back to in-memory state', () => {
    denyLocalStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k' }));
    expect(result.current.annotations).toEqual([]);
    act(() => {
      result.current.add(NOTE);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.annotations).toHaveLength(1);
  });
});

describe.each(['pagehide', 'beforeunload'])('persistence hooks (React) — %s', (type) => {
  it('useReadingPosition flushes the pending save', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage }));
    act(() => result.current.save(ANCHOR));
    expect(storage.data.has('k')).toBe(false);
    window.dispatchEvent(new Event(type));
    expect(parseReadingPosition(storage.data.get('k') ?? null)).toEqual(ANCHOR);
  });

  it('useAnnotations flushes the pending mutation', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage }));
    act(() => {
      result.current.add(NOTE);
    });
    expect(storage.data.has('k')).toBe(false);
    window.dispatchEvent(new Event(type));
    expect(parseAnnotations(storage.data.get('k') ?? null)).toHaveLength(1);
  });
});

describe('useAnnotations (React) — update()', () => {
  it('keeps the previous value for every patch key set to undefined', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useAnnotations({ key: 'k', storage }));
    let id = '';
    act(() => {
      id = result.current.add({ ...NOTE, note: 'n' }).id;
    });
    act(() =>
      result.current.update(id, {
        chapter: undefined,
        start: undefined,
        end: undefined,
        color: undefined,
        note: 'changed',
      }),
    );
    expect(result.current.annotations[0]).toMatchObject({ ...NOTE, id, note: 'changed' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(parseAnnotations(storage.data.get('k') ?? null)[0]).toMatchObject({
      ...NOTE,
      note: 'changed',
    });
  });
});
