// @vitest-environment happy-dom

import { EpubProject } from '@libraz/mejiro/epub';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { type UseEpubOptions, type UseEpubReturn, useEpub } from '../src/useEpub.js';

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
const drain = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Mounts a component running `useEpub(options)` and returns its result. */
function mountEpub(options: UseEpubOptions) {
  let epub!: UseEpubReturn;
  const wrapper = mount(
    defineComponent({
      setup() {
        epub = useEpub(options);
        return () => h('div');
      },
    }),
  );
  return { wrapper, epub };
}

describe('useEpub (Vue) — abandoned loads', () => {
  it('reports nothing for a load that resolves after unmount', async () => {
    const book = await bytes();
    const { fetchEpub, requests } = manualFetcher();
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { wrapper } = mountEpub({ defaultUrl: '/a.epub', fetchEpub, onLoad, onError });
    expect(requests).toHaveLength(1);

    wrapper.unmount();
    requests[0].resolve(book);
    await drain();

    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports nothing for a load that fails after unmount', async () => {
    const { fetchEpub, requests } = manualFetcher();
    const onError = vi.fn();
    const { wrapper } = mountEpub({ defaultUrl: '/a.epub', fetchEpub, onError });

    wrapper.unmount();
    requests[0].reject(new Error('offline'));
    await drain();

    expect(onError).not.toHaveBeenCalled();
  });

  it('abandons the URL load when the URL is cleared', async () => {
    const book = await bytes();
    const { fetchEpub, requests } = manualFetcher();
    const onLoad = vi.fn();
    const url = ref<string | undefined>('/a.epub');
    const { epub } = mountEpub({
      get defaultUrl() {
        return url.value;
      },
      fetchEpub,
      onLoad,
    });
    expect(epub.loading.value).toBe(true);

    url.value = undefined;
    await nextTick();
    expect(epub.loading.value).toBe(false);
    requests[0].resolve(book);
    await drain();

    expect(onLoad).not.toHaveBeenCalled();
    expect(epub.epub.value).toBeNull();
  });

  it('loads only the latest URL when it changes mid-load', async () => {
    const book = await bytes();
    const { fetchEpub, requests } = manualFetcher();
    const onLoad = vi.fn();
    const url = ref('/a.epub');
    const { epub } = mountEpub({
      get defaultUrl() {
        return url.value;
      },
      fetchEpub,
      onLoad,
    });
    url.value = '/b.epub';
    await nextTick();
    requests[0].resolve(book);
    await drain();
    expect(onLoad).not.toHaveBeenCalled();

    requests[1].resolve(book);
    await drain();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(epub.epub.value?.title).toBe('本');
  });
});
