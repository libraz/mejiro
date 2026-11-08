// @vitest-environment happy-dom

import { MejiroBook as MejiroBookClass } from '@libraz/mejiro/book';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useMejiroBook } from '../src/useMejiroBook.js';
import { countFontListeners, withSetup } from './helpers/fixtures.js';

describe('useMejiroBook (Vue)', () => {
  it('creates a stable MejiroBook instance and reflects initial options', () => {
    const { result, unmount } = withSetup(() =>
      useMejiroBook({ fontFamily: 'serif', fontSize: 16 }),
    );
    expect(result.book).toBeTruthy();
    expect(result.options.value.fontFamily).toBe('serif');
    expect(result.options.value.fontSize).toBe(16);
    unmount();
  });

  it('updateOptions updates both the reactive snapshot and the underlying book', async () => {
    const { result, unmount } = withSetup(() =>
      useMejiroBook({ fontFamily: 'serif', fontSize: 16 }),
    );
    const settled = result.updateOptions({ fontSize: 24 });
    // The reactive snapshot is the caller's intent, so it updates right away.
    expect(result.options.value.fontSize).toBe(24);
    // Font-affecting options reach the book once the font preload settles.
    await settled;
    expect(result.book.getOptions().fontSize).toBe(24);
    unmount();
  });

  it('follows options passed as a ref', async () => {
    const source = ref({ fontFamily: 'serif', fontSize: 18 });
    const { result, unmount } = withSetup(() => useMejiroBook(source));
    source.value = { fontFamily: 'serif', fontSize: 22 };
    await nextTick();
    expect(result.options.value.fontSize).toBe(22);
    unmount();
  });

  it('ignores an option patched to undefined inside the debounce window', async () => {
    const { result, unmount } = withSetup(() =>
      useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { debounceMs: 20 }),
    );
    await Promise.all([
      result.updateOptions({ fontSize: 18 }),
      result.updateOptions({ fontSize: undefined }),
    ]);
    expect(result.options.value.fontSize).toBe(18);
    expect(result.book.getOptions().fontSize).toBe(18);
    unmount();
  });

  it('coalesces rapid changes into a single book application while updating the snapshot at once', async () => {
    const spy = vi.spyOn(MejiroBookClass.prototype, 'updateOptions');
    try {
      const { result, unmount } = withSetup(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { debounceMs: 20 }),
      );
      const settled = Promise.all([
        result.updateOptions({ fontSize: 17 }),
        result.updateOptions({ fontSize: 18 }),
        result.updateOptions({ lineSpacing: 2 }),
      ]);
      // The snapshot is the caller's intent, so it is never debounced.
      expect(result.options.value.fontSize).toBe(18);
      await settled;

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ fontSize: 18, lineSpacing: 2 });
      expect(result.book.getOptions().fontSize).toBe(18);
      unmount();
    } finally {
      spy.mockRestore();
    }
  });

  it('releases the book font subscription on unmount', () => {
    const fonts = countFontListeners();
    try {
      for (let i = 0; i < 3; i++) {
        const { unmount } = withSetup(() => useMejiroBook({ fontFamily: 'serif', fontSize: 16 }));
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
      const { result, unmount } = withSetup(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { onError }),
      );
      await expect(result.updateOptions({ fontFamily: 'missing' })).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledWith(failure);
      unmount();
    } finally {
      spy.mockRestore();
    }
  });

  it('debounces and reports through the hook options together', async () => {
    const failure = new Error('font unavailable');
    const spy = vi.spyOn(MejiroBookClass.prototype, 'updateOptions').mockRejectedValue(failure);
    const onError = vi.fn();
    try {
      const { result, unmount } = withSetup(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { debounceMs: 20, onError }),
      );
      const settled = Promise.all([
        result.updateOptions({ fontSize: 17 }),
        result.updateOptions({ fontSize: 18 }),
      ]);
      expect(spy).not.toHaveBeenCalled();
      await expect(settled).resolves.toEqual([undefined, undefined]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ fontSize: 18 });
      expect(onError).toHaveBeenCalledWith(failure);
      unmount();
    } finally {
      spy.mockRestore();
    }
  });
});
