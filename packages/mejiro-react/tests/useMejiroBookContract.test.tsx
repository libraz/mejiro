// @vitest-environment happy-dom
/** @jsxImportSource react */

import { type BookOptions, MejiroBook } from '@libraz/mejiro/book';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { useMejiroBook } from '../src/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMejiroBook follows its options argument', () => {
  it('applies a changed runtime key to the same book', async () => {
    const spy = vi.spyOn(MejiroBook.prototype, 'updateOptions');
    const { result, rerender } = renderHook(({ options }) => useMejiroBook(options), {
      initialProps: { options: { fontFamily: 'serif', fontSize: 16 } as BookOptions },
    });
    const book = result.current.book;

    await act(async () => {
      rerender({ options: { fontFamily: 'serif', fontSize: 20 } });
    });
    expect(result.current.book).toBe(book);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ fontSize: 20 });
    expect(result.current.options.fontSize).toBe(20);
    expect(book.getOptions().fontSize).toBe(20);
  });

  it('does nothing for a new object with the same content', async () => {
    const spy = vi.spyOn(MejiroBook.prototype, 'updateOptions');
    const { rerender } = renderHook(({ options }) => useMejiroBook(options), {
      initialProps: { options: { fontFamily: ['A', 'serif'], fontSize: 16 } as BookOptions },
    });
    await act(async () => {
      rerender({ options: { fontFamily: ['A', 'serif'], fontSize: 16 } });
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores a change to a construction-time key and keeps the book', async () => {
    const spy = vi.spyOn(MejiroBook.prototype, 'updateOptions');
    const { result, rerender } = renderHook(({ options }) => useMejiroBook(options), {
      initialProps: {
        options: { fontFamily: 'serif', fontSize: 16, strictFontCheck: false } as BookOptions,
      },
    });
    const book = result.current.book;
    await act(async () => {
      rerender({ options: { fontFamily: 'serif', fontSize: 16, strictFontCheck: true } });
    });
    expect(result.current.book).toBe(book);
    expect(spy).not.toHaveBeenCalled();
  });

  it('merges a patch through updateOptions', async () => {
    const { result } = renderHook(() => useMejiroBook({ fontFamily: 'serif', fontSize: 16 }));
    await act(async () => {
      await result.current.updateOptions({ lineSpacing: 2 });
    });
    expect(result.current.options).toMatchObject({ fontSize: 16, lineSpacing: 2 });
    expect(result.current.book.getOptions().lineSpacing).toBe(2);
  });
});

describe('useMejiroBook takes BookOptions and a BookOptionsPatch', () => {
  it('accepts construction-time keys up front and only runtime keys in updateOptions', () => {
    expectTypeErrors(
      `import type { BookOptions } from '@libraz/mejiro/book';
import { useMejiroBook, type UseMejiroBookReturn } from '@libraz/mejiro-react';
import type { MejiroBookOptions } from '@libraz/mejiro/book';
const options: BookOptions = { fontFamily: 'serif', fontSize: 16, strictFontCheck: true };
useMejiroBook(options, { debounceMs: 100, onError: (error: Error) => void error });
declare const hook: UseMejiroBookReturn;
hook.updateOptions({ fontSize: 18, kinsoku: 'loose' });
hook.updateOptions({ strictFontCheck: true });
hook.setOptions({ fontSize: 18 });`,
      {
        fails: ['{ MejiroBookOptions }', 'hook.updateOptions({ strictFontCheck', 'hook.setOptions'],
      },
    );
  });
});
