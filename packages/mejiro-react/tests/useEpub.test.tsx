// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEpub } from '../src/useEpub.js';

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the loaders are faked; the module's pure helpers (the book clone the
  // preview relies on, the selection clamp) stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();

  function makeEditable(): unknown {
    return {
      book: {
        title: 'Editable',
        chapters: [
          {
            href: 'OPS/Text/chapter.xhtml',
            title: 'C1',
            paragraphs: [
              { text: 'editable', inlineAnnotations: [] },
              { text: 'second', inlineAnnotations: [] },
            ],
            blocks: [
              { kind: 'paragraph', id: 'b-1', text: 'editable', inlineAnnotations: [] },
              { kind: 'paragraph', id: 'b-2', text: 'second', inlineAnnotations: [] },
            ],
            imageAssets: new Map(),
          },
        ],
        packageData: {
          rootfilePath: 'OPS/package.opf',
          opfDir: 'OPS/',
          opfXml: '',
          files: new Map(),
        },
      },
      history: { canUndo: true, canRedo: false, depth: 1, redoDepth: 0 },
      updateParagraph: vi.fn(),
      setInlineAnnotations: vi.fn(),
      addImage: vi.fn(),
      undo: vi.fn(function (this: { history: unknown }) {
        this.history = { canUndo: false, canRedo: true, depth: 0, redoDepth: 1 };
        return true;
      }),
      redo: vi.fn(function (this: { history: unknown }) {
        this.history = { canUndo: true, canRedo: false, depth: 1, redoDepth: 0 };
        return true;
      }),
      export: vi.fn(async () => new ArrayBuffer(4)),
    };
  }
  return {
    ...actual,
    // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
    EditableEpub: {
      load: vi.fn(async () => makeEditable()),
    },
    parseEpub: vi.fn(async () => ({
      title: 'Mocked',
      author: 'A',
      chapters: [{ title: 'C1', paragraphs: [{ text: 'a', inlineAnnotations: [] }] }],
    })),
  };
});

describe('useEpub (React)', () => {
  it('starts with epub=null, loading=false, error=null', () => {
    const { result } = renderHook(() => useEpub());
    expect(result.current.epub).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('loadBuffer populates epub', async () => {
    const { result } = renderHook(() => useEpub());
    let book: unknown;
    await act(async () => {
      book = await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect((book as { title: string }).title).toBe('Mocked');
    expect(result.current.epub?.title).toBe('Mocked');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('captures parser errors via the error state', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useEpub());
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(result.current.epub).toBeNull();
    expect(result.current.error?.message).toBe('boom');
  });

  it('invokes onError when parsing fails', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const onError = vi.fn();
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useEpub({ onError }));
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('boom');
  });

  it('setEpub replaces the current EPUB without going through the parser and clears stale errors', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useEpub());
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(result.current.error?.message).toBe('boom');

    act(() => result.current.setEpub({ title: 'Direct', author: 'X', chapters: [] }));
    expect(result.current.epub?.title).toBe('Direct');
    expect(result.current.error).toBeNull();
  });

  it('invokes the onLoad callback after a successful loadBuffer', async () => {
    const onLoad = vi.fn();
    const { result } = renderHook(() => useEpub({ onLoad }));
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].title).toBe('Mocked');
  });

  it('loadUrl reports a non-OK response through error and onError exactly once', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const onError = vi.fn();
    const { result } = renderHook(() => useEpub({ onError }));
    let book: unknown;
    await act(async () => {
      book = await result.current.loadUrl('/missing.epub');
    });
    expect(book).toBeNull();
    expect(result.current.error).toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
    expect(result.current.loading).toBe(false);
    expect(result.current.epub).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(result.current.error);
    fetchSpy.mockRestore();
  });

  it('reports a non-OK url response through onError', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const onError = vi.fn();
    const { result } = renderHook(() => useEpub({ url: '/down.epub', onError }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current.error).toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
    expect(result.current.loading).toBe(false);
    fetchSpy.mockRestore();
  });

  it('loadUrl captures network errors via the error state', async () => {
    const offline = new Error('offline');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(offline);
    const { result } = renderHook(() => useEpub());
    await act(async () => {
      await result.current.loadUrl('/x.epub');
    });
    expect(result.current.error).toMatchObject({ code: 'fetch-failed', cause: offline });
    fetchSpy.mockRestore();
  });

  it('uses the latest onError callback without reloading the url', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const firstOnError = vi.fn();
    const secondOnError = vi.fn();
    const { rerender } = renderHook(({ onError }) => useEpub({ url: '/auto.epub', onError }), {
      initialProps: { onError: firstOnError },
    });

    rerender({ onError: secondOnError });

    await waitFor(() => expect(secondOnError).toHaveBeenCalledTimes(1));
    expect(firstOnError).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('auto-loads the url on mount', async () => {
    const buf = new ArrayBuffer(8);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(buf, { status: 200 }));
    const onLoad = vi.fn();
    const { result } = renderHook(() => useEpub({ url: '/auto.epub', onLoad }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchSpy.mock.calls[0][0]).toBe('/auto.epub');
    expect(result.current.epub?.title).toBe('Mocked');
    expect(onLoad).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

describe('useEpub (React) — parse limits', () => {
  /** Stand-in expanded size of the archive the mocked parser "opens". */
  const archiveBytes = 5000;

  /** Installs a parser that enforces `maxTotalBytes` and returns a restorer. */
  async function withLimitAwareParser(): Promise<() => void> {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const parseMock = parseEpub as ReturnType<typeof vi.fn>;
    const previous = parseMock.getMockImplementation();
    parseMock.mockImplementation(
      async (_buffer: ArrayBuffer, options?: { limits?: { maxTotalBytes?: number } }) => {
        const maxTotalBytes = options?.limits?.maxTotalBytes ?? 1024;
        if (archiveBytes > maxTotalBytes) throw new Error('EPUB archive is too large');
        return { title: 'Large', author: 'A', chapters: [] };
      },
    );
    return () => {
      if (previous) parseMock.mockImplementation(previous);
    };
  }

  it('rejects an archive that exceeds the configured limit', async () => {
    const restore = await withLimitAwareParser();
    const { result } = renderHook(() => useEpub({ limits: { maxTotalBytes: 2048 } }));

    let book: unknown;
    await act(async () => {
      book = await result.current.loadBuffer(new ArrayBuffer(8));
    });

    expect(book).toBeNull();
    expect(result.current.error?.message).toBe('EPUB archive is too large');
    restore();
  });

  it('accepts the same archive under a looser limit', async () => {
    const restore = await withLimitAwareParser();
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const buffer = new ArrayBuffer(8);
    const { result } = renderHook(() => useEpub({ limits: { maxTotalBytes: 10_000 } }));

    let book: unknown;
    await act(async () => {
      book = await result.current.loadBuffer(buffer);
    });

    expect((book as { title: string }).title).toBe('Large');
    expect(result.current.error).toBeNull();
    expect(parseEpub).toHaveBeenCalledWith(buffer, {
      limits: { maxTotalBytes: 10_000 },
      signal: expect.any(AbortSignal),
    });
    restore();
  });
});
