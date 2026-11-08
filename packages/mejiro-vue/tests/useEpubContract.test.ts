// @vitest-environment happy-dom

import { EpubProject } from '@libraz/mejiro/epub';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { type UseEpubOptions, type UseEpubReturn, useEpub } from '../src/index.js';

/** Real EPUB bytes with one chapter, titled `title`. */
function epubBytes(title: string): Promise<Uint8Array> {
  return new EpubProject({
    metadata: { title },
    chapters: [{ title: '一', body: '本文。' }],
    includeTitlePage: false,
  }).export();
}

function harness(options: UseEpubOptions): { epub: UseEpubReturn; unmount: () => void } {
  let epub!: UseEpubReturn;
  const wrapper = mount(
    defineComponent({
      setup() {
        epub = useEpub(options);
        return () => h('div');
      },
    }),
  );
  return { epub, unmount: () => wrapper.unmount() };
}

/** A fetcher whose requests stay pending, recording the signal each one received. */
function pendingFetcher() {
  const signals: AbortSignal[] = [];
  const fetchEpub = vi.fn(
    (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise<Uint8Array>((_, reject) => {
        signals.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  return { fetchEpub, signals };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEpub (Vue) — url option', () => {
  it('loads the url once mounted and again whenever a url ref changes', async () => {
    const books = { '/a.epub': await epubBytes('A'), '/b.epub': await epubBytes('B') };
    const fetchEpub = vi.fn(async (url: string) => books[url as keyof typeof books]);
    const url = ref('/a.epub');
    const { epub } = harness({ url, fetchEpub });

    await vi.waitFor(() => expect(epub.epub.value?.title).toBe('A'));
    url.value = '/b.epub';
    await vi.waitFor(() => expect(epub.epub.value?.title).toBe('B'));
    expect(fetchEpub.mock.calls.map(([u]) => u)).toEqual(['/a.epub', '/b.epub']);
  });
});

describe('useEpub (Vue) — cancellation', () => {
  it('hands fetchEpub a signal that aborts when a newer load starts', async () => {
    const { fetchEpub, signals } = pendingFetcher();
    const onError = vi.fn();
    const { epub } = harness({ fetchEpub, onError });

    const first = epub.loadUrl('/a.epub');
    void epub.loadUrl('/b.epub');

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await expect(first).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('aborts the load in flight when the owning component unmounts', async () => {
    const { fetchEpub, signals } = pendingFetcher();
    const onError = vi.fn();
    const { epub, unmount } = harness({ fetchEpub, onError });

    const pending = epub.loadUrl('/a.epub');
    unmount();

    expect(signals[0].aborted).toBe(true);
    await expect(pending).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('passes the signal to the default fetch together with fetchOptions', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(await epubBytes('A'), { status: 200 }));
    const { epub } = harness({ fetchOptions: { credentials: 'include' } });

    await epub.loadUrl('/a.epub');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/a.epub',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
  });
});

describe('useEpub (Vue) — inputs and failures', () => {
  it('loads a Uint8Array view whose byteOffset is not zero', async () => {
    const bytes = await epubBytes('View');
    const backing = new Uint8Array(bytes.byteLength + 16);
    backing.set(bytes, 16);
    const { epub } = harness({});

    const book = await epub.loadBuffer(backing.subarray(16));

    expect(book?.title).toBe('View');
  });

  it('reports a non-2xx response as MejiroError fetch-failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const onError = vi.fn();
    const { epub } = harness({ onError });

    await epub.loadUrl('/missing.epub');

    expect(epub.error.value).toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
    expect(onError).toHaveBeenCalledWith(epub.error.value);
  });

  it('passes a MejiroError from the parser through unchanged', async () => {
    const onError = vi.fn();
    const { epub } = harness({ onError });

    await epub.loadBuffer(new Uint8Array([1, 2, 3, 4]));
    await flushPromises();
    await nextTick();

    expect(epub.error.value).toMatchObject({ name: 'MejiroError', code: 'epub-invalid-archive' });
    expect(onError).toHaveBeenCalledWith(epub.error.value);
  });
});

describe('useEpub (Vue) — public types', () => {
  it('takes reactive url input and returns read-only state', () => {
    expectTypeErrors(
      `import type { BinaryInput } from '@libraz/mejiro';
import { type FetchEpubOptions, useEpub } from '@libraz/mejiro-vue';
import { ref } from 'vue';
const url = ref<string | null>(null);
const fetchEpub = async (_url: string, options: FetchEpubOptions): Promise<BinaryInput> => {
  void options.signal;
  return new Uint8Array();
};
const epub = useEpub({ url, fetchEpub });
useEpub({ url: () => url.value });
void epub.loadBuffer(new Uint8Array());
epub.setEpub(null);
epub.epub.value = null;
epub.loading.value = false;
useEpub({ defaultUrl: '/a.epub' });`,
      {
        fails: ['epub.epub.value = null;', 'epub.loading.value = false;', "defaultUrl: '/a.epub'"],
      },
    );
  });
});
