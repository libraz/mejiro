// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useEpub } from '../src/useEpub.js';
import { withSetup } from './helpers/fixtures.js';

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the parser is faked; the module's pure helpers stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();

  return {
    ...actual,
    parseEpub: vi.fn(async () => ({
      title: 'Mocked',
      author: 'A',
      chapters: [{ title: 'C1', paragraphs: [{ text: 'a', inlineAnnotations: [] }] }],
    })),
  };
});

describe('useEpub (Vue)', () => {
  it('starts with epub=null, loading=false, error=null', () => {
    const { result, unmount } = withSetup(() => useEpub());
    expect(result.epub.value).toBeNull();
    expect(result.loading.value).toBe(false);
    expect(result.error.value).toBeNull();
    unmount();
  });

  it('loadBuffer populates epub and toggles loading', async () => {
    const { result, unmount } = withSetup(() => useEpub());
    const book = await result.loadBuffer(new ArrayBuffer(8));
    expect(book?.title).toBe('Mocked');
    expect(result.epub.value?.title).toBe('Mocked');
    expect(result.loading.value).toBe(false);
    expect(result.error.value).toBeNull();
    unmount();
  });

  it('captures parser errors and surfaces them via the error ref', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = withSetup(() => useEpub());
    const book = await result.loadBuffer(new ArrayBuffer(8));
    expect(book).toBeNull();
    expect(result.epub.value).toBeNull();
    expect(result.error.value?.message).toBe('boom');
    unmount();
  });

  it('invokes onError when parsing fails', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const onError = vi.fn();
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = withSetup(() => useEpub({ onError }));
    await result.loadBuffer(new ArrayBuffer(8));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('boom');
    unmount();
  });

  it('setEpub replaces the current EPUB without going through the parser and clears stale errors', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = withSetup(() => useEpub());
    await result.loadBuffer(new ArrayBuffer(8));
    expect(result.error.value?.message).toBe('boom');

    result.setEpub({ title: 'Direct', author: 'X', chapters: [] });
    expect(result.epub.value?.title).toBe('Direct');
    expect(result.error.value).toBeNull();
    unmount();
  });

  it('invokes the onLoad callback after a successful loadBuffer', async () => {
    const onLoad = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ onLoad }));
    await result.loadBuffer(new ArrayBuffer(8));
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].title).toBe('Mocked');
    unmount();
  });

  it('loadUrl reports a non-OK response through error and onError exactly once', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const onError = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ onError }));
    const book = await result.loadUrl('/missing.epub');
    expect(book).toBeNull();
    expect(result.error.value).toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
    expect(result.loading.value).toBe(false);
    expect(result.epub.value).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(result.error.value);
    fetchSpy.mockRestore();
    unmount();
  });

  it('reports a non-OK url response through onError', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const onError = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ url: '/down.epub', onError }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.error.value).toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
    expect(result.loading.value).toBe(false);
    fetchSpy.mockRestore();
    unmount();
  });

  it('loadUrl captures network errors via the error ref', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const { result, unmount } = withSetup(() => useEpub());
    const book = await result.loadUrl('/x.epub');
    expect(book).toBeNull();
    expect(result.error.value?.message).toBe('offline');
    fetchSpy.mockRestore();
    unmount();
  });

  it('invokes onError when URL loading rejects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const onError = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ onError }));
    const book = await result.loadUrl('/x.epub');
    expect(book).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('offline');
    fetchSpy.mockRestore();
    unmount();
  });

  it('auto-loads via url on mount', async () => {
    const buf = new ArrayBuffer(8);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(buf, { status: 200 }));
    const onLoad = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ url: '/auto.epub', onLoad }));
    // onMounted runs synchronously inside mount; flush the chained microtasks.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).toHaveBeenCalledWith(
      '/auto.epub',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.epub.value?.title).toBe('Mocked');
    expect(onLoad).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
    unmount();
  });

  it('reloads when a url getter changes', async () => {
    const url = ref('/one.epub');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { unmount } = withSetup(() => useEpub({ url: () => url.value }));
    await vi.waitFor(() => expect(fetchSpy.mock.calls.map(([u]) => u)).toContain('/one.epub'));

    url.value = '/two.epub';
    await nextTick();

    await vi.waitFor(() => expect(fetchSpy.mock.calls.map(([u]) => u)).toContain('/two.epub'));
    fetchSpy.mockRestore();
    unmount();
  });
});

describe('useEpub (Vue) — parse limits', () => {
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
    const { result, unmount } = withSetup(() => useEpub({ limits: { maxTotalBytes: 2048 } }));

    const book = await result.loadBuffer(new ArrayBuffer(8));

    expect(book).toBeNull();
    expect(result.error.value?.message).toBe('EPUB archive is too large');
    restore();
    unmount();
  });

  it('accepts the same archive under a looser limit', async () => {
    const restore = await withLimitAwareParser();
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const buffer = new ArrayBuffer(8);
    const { result, unmount } = withSetup(() => useEpub({ limits: { maxTotalBytes: 10_000 } }));

    const book = await result.loadBuffer(buffer);

    expect(book?.title).toBe('Large');
    expect(result.error.value).toBeNull();
    expect(parseEpub).toHaveBeenCalledWith(buffer, {
      limits: { maxTotalBytes: 10_000 },
      signal: expect.any(AbortSignal),
    });
    restore();
    unmount();
  });
});
