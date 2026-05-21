// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useReadingPosition (React)', () => {
  it('returns null when no position is stored', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage }));
    expect(result.current.position).toBeNull();
  });

  it('hydrates a v2 anchor from storage on mount', () => {
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 2, paragraph: 7, charIndex: 12 }));
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage }));
    expect(result.current.position).toEqual({ chapter: 2, paragraph: 7, charIndex: 12 });
  });

  it('save() updates position immediately and writes a v2 payload after throttle', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage, throttleMs: 100 }));
    act(() => {
      result.current.save({ chapter: 1, paragraph: 3, charIndex: 5 });
    });
    expect(result.current.position).toEqual({ chapter: 1, paragraph: 3, charIndex: 5 });
    expect(storage.data.get('k')).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(JSON.parse(storage.data.get('k') ?? '{}')).toEqual({
      version: 2,
      chapter: 1,
      paragraph: 3,
      charIndex: 5,
    });
  });

  it('clear() removes both state and storage', () => {
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 4, paragraph: 0, charIndex: 0 }));
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage }));
    act(() => {
      result.current.clear();
    });
    expect(result.current.position).toBeNull();
    expect(storage.data.get('k')).toBeUndefined();
  });

  it('ignores malformed storage payloads', () => {
    const storage = memoryStorage();
    storage.setItem('k', 'not-json');
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage }));
    expect(result.current.position).toBeNull();
  });

  it('re-hydrates when the key changes', () => {
    const storage = memoryStorage();
    storage.setItem('a', JSON.stringify({ version: 2, chapter: 1, paragraph: 1, charIndex: 0 }));
    storage.setItem('b', JSON.stringify({ version: 2, chapter: 2, paragraph: 2, charIndex: 0 }));
    const { result, rerender } = renderHook(({ key }) => useReadingPosition({ key, storage }), {
      initialProps: { key: 'a' },
    });
    expect(result.current.position).toEqual({ chapter: 1, paragraph: 1, charIndex: 0 });
    rerender({ key: 'b' });
    expect(result.current.position).toEqual({ chapter: 2, paragraph: 2, charIndex: 0 });
  });

  it('migrates legacy {chapter, spreadIdx} payloads to chapter start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ chapter: 5, spreadIdx: 12 }));
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage }));
    expect(result.current.position).toEqual({ chapter: 5, paragraph: 0, charIndex: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('onChange fires synchronously on save() with the new anchor', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage, onChange }));
    act(() => {
      result.current.save({ chapter: 2, paragraph: 1, charIndex: 9 });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ chapter: 2, paragraph: 1, charIndex: 9 });
  });

  it('onChange fires with null on clear()', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 1, paragraph: 0, charIndex: 0 }));
    const { result } = renderHook(() => useReadingPosition({ key: 'k', storage, onChange }));
    act(() => {
      result.current.clear();
    });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('onChange is not invoked during initial hydration', () => {
    const onChange = vi.fn();
    const storage = memoryStorage();
    storage.setItem('k', JSON.stringify({ version: 2, chapter: 1, paragraph: 0, charIndex: 0 }));
    renderHook(() => useReadingPosition({ key: 'k', storage, onChange }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
