// @vitest-environment happy-dom
/** @jsxImportSource react */

import { EpubProject } from '@libraz/mejiro/epub';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEpub } from '../src/useEpub.js';

/** A fetcher whose responses the test releases by hand. */
function manualFetcher() {
  const requests: Array<{ resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }> = [];
  const fetchEpub = vi.fn(
    () =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        requests.push({ resolve, reject });
      }),
  );
  return { fetchEpub, requests };
}

const bytes = () =>
  new EpubProject({
    metadata: { title: '本' },
    chapters: [{ title: '一', body: '本文。' }],
    includeTitlePage: false,
  }).export();

/** Lets the parse of a released response run to completion. */
const drain = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

describe('useEpub (React) — abandoned loads', () => {
  it('reports nothing for a load that resolves after unmount', async () => {
    const book = await bytes();
    const { fetchEpub, requests } = manualFetcher();
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { unmount } = renderHook(() =>
      useEpub({ defaultUrl: '/a.epub', fetchEpub, onLoad, onError }),
    );
    expect(requests).toHaveLength(1);

    unmount();
    requests[0].resolve(book);
    await drain();

    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports nothing for a load that fails after unmount', async () => {
    const { fetchEpub, requests } = manualFetcher();
    const onError = vi.fn();
    const { unmount } = renderHook(() => useEpub({ defaultUrl: '/a.epub', fetchEpub, onError }));

    unmount();
    requests[0].reject(new Error('offline'));
    await drain();

    expect(onError).not.toHaveBeenCalled();
  });

  it('abandons the URL load when the URL is cleared', async () => {
    const book = await bytes();
    const { fetchEpub, requests } = manualFetcher();
    const onLoad = vi.fn();
    const { result, rerender } = renderHook(
      ({ url }: { url: string | undefined }) => useEpub({ defaultUrl: url, fetchEpub, onLoad }),
      { initialProps: { url: '/a.epub' as string | undefined } },
    );
    expect(result.current.loading).toBe(true);

    rerender({ url: undefined });
    expect(result.current.loading).toBe(false);
    requests[0].resolve(book);
    await drain();

    expect(onLoad).not.toHaveBeenCalled();
    expect(result.current.epub).toBeNull();
  });

  it('loads only the latest URL when it changes mid-load', async () => {
    const book = await bytes();
    const { fetchEpub, requests } = manualFetcher();
    const onLoad = vi.fn();
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useEpub({ defaultUrl: url, fetchEpub, onLoad }),
      { initialProps: { url: '/a.epub' } },
    );
    rerender({ url: '/b.epub' });
    requests[0].resolve(book);
    await drain();
    expect(onLoad).not.toHaveBeenCalled();

    requests[1].resolve(book);
    await drain();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(result.current.epub?.title).toBe('本');
  });
});
