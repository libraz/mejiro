// @vitest-environment happy-dom
/** @jsxImportSource react */

import { EpubProject } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { type FetchEpubOptions, useEditableEpub, useEpub } from '../src/index.js';

/** EPUB bytes with one chapter holding `text`. */
function epubBytes(text = '本文です。'): Promise<Uint8Array> {
  return new EpubProject({
    metadata: { title: 'T' },
    includeTitlePage: false,
    chapters: [{ title: 'C', body: text }],
  }).export();
}

/** `bytes` placed at a non-zero offset of a larger buffer, as a Node `Buffer` may be. */
function offsetView(bytes: Uint8Array): Uint8Array {
  const backing = new Uint8Array(bytes.byteLength + 16);
  backing.fill(0xff);
  backing.set(bytes, 8);
  return backing.subarray(8, 8 + bytes.byteLength);
}

function stubFetch(respond: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetch = vi.fn((_url: string, _init?: RequestInit) => respond());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useEpub loads from the url option', () => {
  it('fetches url on mount and reports the parsed EPUB to onLoad', async () => {
    const bytes = await epubBytes();
    const fetch = stubFetch(async () => new Response(bytes));
    const onLoad = vi.fn();
    const { result } = renderHook(() => useEpub({ url: '/book.epub', onLoad }));

    await waitFor(() => expect(result.current.epub).not.toBeNull());
    expect(fetch.mock.calls[0][0]).toBe('/book.epub');
    expect(onLoad).toHaveBeenCalledWith(result.current.epub);
  });

  it('rejects a non-2xx response as MejiroError fetch-failed', async () => {
    stubFetch(async () => new Response('', { status: 404 }));
    const onError = vi.fn();
    const { result } = renderHook(() => useEpub({ url: '/missing.epub', onError }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
    expect(onError).toHaveBeenCalledWith(result.current.error);
  });

  it('passes a MejiroError from the parser through unchanged', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useEpub({ onError }));
    await act(async () => {
      await result.current.loadBuffer(new Uint8Array([1, 2, 3]));
    });
    expect(result.current.error).toMatchObject({
      name: 'MejiroError',
      code: 'epub-invalid-archive',
    });
  });
});

describe('useEpub and useEditableEpub abort a superseded fetch', () => {
  it('hands fetchEpub a signal that aborts on unmount', async () => {
    let seen: FetchEpubOptions | undefined;
    const fetchEpub = vi.fn((_url: string, options: FetchEpubOptions) => {
      seen = options;
      return new Promise<Uint8Array>(() => {});
    });
    const { unmount } = renderHook(() => useEpub({ url: '/a.epub', fetchEpub }));
    await waitFor(() => expect(fetchEpub).toHaveBeenCalledTimes(1));
    expect(seen?.signal.aborted).toBe(false);

    unmount();
    expect(seen?.signal.aborted).toBe(true);
  });

  it('aborts the previous load when a new one starts', async () => {
    const signals: AbortSignal[] = [];
    const bytes = await epubBytes();
    const fetchEpub = vi.fn(async (_url: string, { signal }: FetchEpubOptions) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<Uint8Array>(() => {}) : bytes;
    });
    const { result } = renderHook(() => useEditableEpub({ fetchEpub }));

    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.loadUrl('/one.epub');
    });
    await act(async () => {
      await result.current.loadUrl('/two.epub');
    });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(result.current.editor).not.toBeNull();
    void first;
  });

  it('passes the signal to the default fetch together with fetchOptions', async () => {
    const bytes = await epubBytes();
    const fetch = stubFetch(async () => new Response(bytes));
    const { result } = renderHook(() =>
      useEditableEpub({ url: '/private.epub', fetchOptions: { credentials: 'include' } }),
    );

    await waitFor(() => expect(result.current.editor).not.toBeNull());
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('EPUB hooks take and return Uint8Array bytes', () => {
  it('loads a Uint8Array view at a non-zero offset', async () => {
    const view = offsetView(await epubBytes('オフセット'));
    const reader = renderHook(() => useEpub());
    const editable = renderHook(() => useEditableEpub());
    await act(async () => {
      await reader.result.current.loadBuffer(view);
      await editable.result.current.loadBuffer(view);
    });
    expect(reader.result.current.epub?.chapters[0].paragraphs.at(-1)?.text).toBe('オフセット');
    expect(editable.result.current.epub?.chapters).toHaveLength(1);
  });

  it('exports Uint8Array bytes and hands the same bytes to onExport', async () => {
    const onExport = vi.fn();
    const { result } = renderHook(() => useEditableEpub({ onExport }));
    await act(async () => {
      await result.current.loadBuffer(await epubBytes());
    });
    let bytes: Uint8Array | null = null;
    await act(async () => {
      bytes = await result.current.exportEpub();
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(onExport).toHaveBeenCalledWith(bytes);
  });
});

describe('useEditableEpub follows the editing session', () => {
  it('names the live document epub and the reader projection previewEpub', async () => {
    const { result } = renderHook(() => useEditableEpub());
    await act(async () => {
      await result.current.loadBuffer(await epubBytes('最初'));
    });
    const { editor, epub, previewEpub, selection } = result.current;
    expect(epub).toBe(editor?.epub);
    expect(previewEpub?.chapters[0].paragraphs.map((p) => p.text)).toContain('最初');
    expect(selection).toEqual({ chapterIndex: 0, blockId: epub?.chapters[0].blocks[0].id });
  });

  it('re-renders for an edit made on the editor directly', async () => {
    const { result } = renderHook(() => useEditableEpub());
    await act(async () => {
      await result.current.loadBuffer(await epubBytes('最初'));
    });
    const revision = result.current.revision;
    const editor = result.current.editor;
    const blockId = result.current.selectedParagraph?.id as string;

    act(() => {
      editor?.updateParagraph(0, blockId, { text: '直接編集' });
    });
    expect(result.current.revision).toBeGreaterThan(revision);
    expect(result.current.previewEpub?.chapters[0].paragraphs.map((p) => p.text)).toContain(
      '直接編集',
    );
    expect(result.current.history?.canUndo).toBe(true);
  });

  it('edits the selected block through the hook commands', async () => {
    const { result } = renderHook(() => useEditableEpub());
    await act(async () => {
      await result.current.loadBuffer(await epubBytes('最初'));
    });
    act(() => {
      result.current.updateParagraph({ text: '変更後' });
    });
    expect(result.current.selectedParagraph?.text).toBe('変更後');
    act(() => {
      expect(result.current.undo()).toBe(true);
    });
    expect(result.current.selectedParagraph?.text).not.toBe('変更後');
  });
});

describe('a failed export reaches error and onError and still rejects', () => {
  it('useEditableEpub', async () => {
    const failure = new Error('resolver down');
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useEditableEpub({
        onError,
        assetResolver: () => {
          throw failure;
        },
      }),
    );
    await act(async () => {
      await result.current.loadBuffer(await epubBytes());
    });
    act(() => {
      result.current.addImage({ filename: 'a.png', url: 'https://example.com/a.png' });
    });

    await act(async () => {
      await expect(result.current.exportEpub()).rejects.toBe(failure);
    });
    expect(result.current.error).toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.exporting).toBe(false);
  });
});

describe('EPUB hook option and return names', () => {
  it('uses url, epub, previewEpub and a signal-taking fetchEpub', () => {
    expectTypeErrors(
      `import type { EpubBook } from '@libraz/mejiro/epub';
import { useEditableEpub, useEpub, type UseEditableEpubReturn, type UseEpubOptions } from '@libraz/mejiro-react';
useEpub({ url: '/a.epub', onLoad: (epub: EpubBook) => void epub });
useEditableEpub({ url: '/a.epub', fetchOptions: { credentials: 'include' } });
useEditableEpub({ fetchEpub: async (_url, { signal }) => new Uint8Array(signal.aborted ? 0 : 1) });
export const fetcher: UseEpubOptions['fetchEpub'] = async () => new ArrayBuffer(1);
declare const hook: UseEditableEpubReturn;
export const preview: EpubBook | null = hook.previewEpub;
export const live = hook.epub;
useEpub({ defaultUrl: '/a.epub' });
useEditableEpub({ defaultUrl: '/a.epub' });
export const oldBook = hook.book;
export const oldPreview = hook.previewBook;
export const exported: Promise<Uint8Array | null> = hook.exportEpub();`,
      {
        fails: [
          "useEpub({ defaultUrl: '/a.epub' })",
          "useEditableEpub({ defaultUrl: '/a.epub' })",
          'hook.book;',
          'hook.previewBook;',
        ],
      },
    );
  });
});
