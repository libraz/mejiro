// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EditableEpub } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loadMock = vi.hoisted(() => vi.fn());

vi.mock('@libraz/mejiro/epub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libraz/mejiro/epub')>()),
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
  EditableEpub: { load: loadMock },
}));

import { useEditableEpub } from '../src/useEditableEpub.js';

/** A promise settled from outside. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stubEditor(exportImpl?: () => Promise<ArrayBuffer>): EditableEpub {
  return {
    book: { chapters: [], packageData: { files: new Map() } },
    export: vi.fn(exportImpl ?? (async () => new ArrayBuffer(1))),
  } as unknown as EditableEpub;
}

afterEach(() => {
  vi.restoreAllMocks();
  loadMock.mockReset();
});

describe('useEditableEpub (React) — abandoned loads', () => {
  it('delivers no onLoad for a load still in flight at unmount', async () => {
    const pending = deferred<EditableEpub>();
    loadMock.mockReturnValue(pending.promise);
    const onLoad = vi.fn();
    const { result, unmount } = renderHook(() => useEditableEpub({ onLoad }));

    void result.current.loadBuffer(new ArrayBuffer(8));
    unmount();
    await act(async () => pending.resolve(stubEditor()));

    expect(onLoad).not.toHaveBeenCalled();
  });

  it('delivers no onError for a failing load still in flight at unmount', async () => {
    const pending = deferred<EditableEpub>();
    loadMock.mockReturnValue(pending.promise.then(() => Promise.reject(new Error('bad'))));
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useEditableEpub({ onError }));

    void result.current.loadBuffer(new ArrayBuffer(8));
    unmount();
    await act(async () => pending.resolve(stubEditor()));

    expect(onError).not.toHaveBeenCalled();
  });

  it('abandons a defaultUrl load when the URL is cleared mid-flight', async () => {
    const pending = deferred<EditableEpub>();
    loadMock.mockReturnValue(pending.promise);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
    const onLoad = vi.fn();
    const { result, rerender } = renderHook(
      ({ defaultUrl }: { defaultUrl?: string }) => useEditableEpub({ defaultUrl, onLoad }),
      { initialProps: { defaultUrl: '/a.epub' } as { defaultUrl?: string } },
    );
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);

    rerender({ defaultUrl: undefined });
    await act(async () => pending.resolve(stubEditor()));

    expect(onLoad).not.toHaveBeenCalled();
    expect(result.current.editor).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe('useEditableEpub (React) — exporting', () => {
  it('stays true until the last overlapping export settles', async () => {
    const first = deferred<ArrayBuffer>();
    const second = deferred<ArrayBuffer>();
    const exports = [first, second];
    const editor = stubEditor();
    vi.mocked(editor.export).mockImplementation(() => (exports.shift() as typeof first).promise);
    loadMock.mockResolvedValue(editor);
    const { result } = renderHook(() => useEditableEpub());
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });

    let one: Promise<unknown> = Promise.resolve();
    let two: Promise<unknown> = Promise.resolve();
    act(() => {
      one = result.current.exportEpub();
      two = result.current.exportEpub();
    });
    expect(result.current.exporting).toBe(true);

    await act(async () => {
      first.resolve(new ArrayBuffer(1));
      await one;
    });
    expect(result.current.exporting).toBe(true);

    await act(async () => {
      second.resolve(new ArrayBuffer(1));
      await two;
    });
    expect(result.current.exporting).toBe(false);
  });
});
