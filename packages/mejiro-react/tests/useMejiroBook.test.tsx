// @vitest-environment happy-dom
/** @jsxImportSource react */

import { MejiroBook as MejiroBookClass } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMejiroBook } from '../src/useMejiroBook.js';
import { countFontListeners } from './helpers/fixtures.js';

describe('useMejiroBook (React)', () => {
  it('creates a stable MejiroBook instance and reflects initial options', () => {
    const { result } = renderHook(() => useMejiroBook({ fontFamily: 'serif', fontSize: 16 }));
    expect(result.current.book).toBeTruthy();
    expect(result.current.options.fontFamily).toBe('serif');
    expect(result.current.options.fontSize).toBe(16);
  });

  it('updateOptions updates both the React snapshot and the underlying book', async () => {
    const { result } = renderHook(() => useMejiroBook({ fontFamily: 'serif', fontSize: 16 }));
    await act(async () => {
      await result.current.updateOptions({ fontSize: 24 });
    });
    expect(result.current.options.fontSize).toBe(24);
    expect(result.current.book.getOptions().fontSize).toBe(24);
  });

  it('keeps the book instance stable across rerenders with new options', async () => {
    const { result, rerender } = renderHook(({ options }) => useMejiroBook(options), {
      initialProps: { options: { fontFamily: 'serif', fontSize: 16 } },
    });
    const book = result.current.book;

    // A changed runtime key is applied to the same book instead of a new one.
    await act(async () => {
      rerender({ options: { fontFamily: 'serif', fontSize: 20 } });
    });
    expect(result.current.book).toBe(book);
    expect(result.current.options.fontSize).toBe(20);
  });

  it('ignores an option patched to undefined inside the debounce window', async () => {
    const { result } = renderHook(() =>
      useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { debounceMs: 20 }),
    );
    await act(async () => {
      await Promise.all([
        result.current.updateOptions({ fontSize: 18 }),
        result.current.updateOptions({ fontSize: undefined }),
      ]);
    });
    expect(result.current.options.fontSize).toBe(18);
    expect(result.current.book.getOptions().fontSize).toBe(18);
  });

  it('coalesces rapid changes into a single book application while updating the snapshot at once', async () => {
    const spy = vi.spyOn(MejiroBookClass.prototype, 'updateOptions');
    try {
      const { result } = renderHook(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { debounceMs: 20 }),
      );
      await act(async () => {
        const settled = Promise.all([
          result.current.updateOptions({ fontSize: 17 }),
          result.current.updateOptions({ fontSize: 18 }),
          result.current.updateOptions({ lineSpacing: 2 }),
        ]);
        await settled;
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ fontSize: 18, lineSpacing: 2 });
      expect(result.current.options.fontSize).toBe(18);
      expect(result.current.book.getOptions().fontSize).toBe(18);
    } finally {
      spy.mockRestore();
    }
  });

  it('releases the book font subscription on unmount', () => {
    const fonts = countFontListeners();
    try {
      for (let i = 0; i < 3; i++) {
        const { unmount } = renderHook(() => useMejiroBook({ fontFamily: 'serif', fontSize: 16 }));
        expect(fonts.listeners()).toBe(1);
        unmount();
        expect(fonts.listeners()).toBe(0);
      }
    } finally {
      fonts.restore();
    }
  });

  it('reports a failed application through onError and resolves the promise', async () => {
    const failure = new Error('font unavailable');
    const spy = vi.spyOn(MejiroBookClass.prototype, 'updateOptions').mockRejectedValue(failure);
    const onError = vi.fn();
    try {
      const { result } = renderHook(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { onError }),
      );
      let settled: unknown = 'not-settled';
      await act(async () => {
        settled = await result.current.updateOptions({ fontFamily: 'missing' });
      });
      expect(settled).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(failure);
    } finally {
      spy.mockRestore();
    }
  });
});
