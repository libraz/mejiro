// @vitest-environment happy-dom

import type { AssetResolverRequest } from '@libraz/mejiro/epub';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { useEpubProject } from '../src/useEpubProject.js';

const chapters = [{ id: 'a', title: 'A', body: '本文A' }];

const COVER_URL = 'https://cdn.example.test/works/1/cover.jpg';
const COVER_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function harness<T>(setup: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  const TestComponent = defineComponent({
    setup() {
      result.current = setup();
      return () => h('div');
    },
  });
  mount(TestComponent);
  return { result };
}

describe('useEpubProject asset registration (Vue)', () => {
  it('registers a URL-only cover in the project it builds', () => {
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    result.current.setCover({ href: 'OPS/Images/cover.jpg', url: COVER_URL });

    expect(result.current.cover.value).toMatchObject({ url: COVER_URL });
    expect(result.current.buildProject().assets).toEqual([
      expect.objectContaining({ url: COVER_URL, properties: 'cover-image' }),
    ]);
  });

  it('resolves a URL-only cover through assetResolver during exportEpub', async () => {
    const assetResolver = vi.fn(({ url }: AssetResolverRequest) => {
      expect(url).toBe(COVER_URL);
      return COVER_BYTES;
    });
    const { result } = harness(() =>
      useEpubProject({ chapters, debounceMs: 10_000, assetResolver }),
    );

    result.current.setCover({ href: 'OPS/Images/cover.jpg', url: COVER_URL });

    const buffer = await result.current.exportEpub();

    expect(assetResolver).toHaveBeenCalledTimes(1);
    expect(assetResolver.mock.calls[0][0]).toMatchObject({ url: COVER_URL });
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('drops the cover from the exported project when set back to null', async () => {
    const assetResolver = vi.fn(() => COVER_BYTES);
    const { result } = harness(() =>
      useEpubProject({ chapters, debounceMs: 10_000, assetResolver }),
    );

    result.current.setCover({ href: 'OPS/Images/cover.jpg', url: COVER_URL });
    result.current.setCover(null);

    await result.current.exportEpub();

    expect(result.current.cover.value).toBeNull();
    expect(result.current.buildProject().assets).toEqual([]);
    expect(assetResolver).not.toHaveBeenCalled();
  });

  it('registers URL-only non-cover assets through setAssets', async () => {
    const illustrationUrl = 'https://cdn.example.test/works/1/figure-01.png';
    const assetResolver = vi.fn(() => COVER_BYTES);
    const { result } = harness(() =>
      useEpubProject({ chapters, debounceMs: 10_000, assetResolver }),
    );

    result.current.setAssets([{ href: 'OPS/Images/figure-01.png', url: illustrationUrl }]);

    expect(result.current.buildProject().assets).toEqual([
      expect.objectContaining({ url: illustrationUrl }),
    ]);

    await result.current.exportEpub();

    expect(assetResolver.mock.calls[0][0]).toMatchObject({ url: illustrationUrl });
  });

  it('seeds the cover and assets from the initial options', () => {
    const { result } = harness(() =>
      useEpubProject({
        chapters,
        debounceMs: 10_000,
        cover: { href: 'OPS/Images/cover.jpg', url: COVER_URL },
        assets: [{ href: 'OPS/Images/figure-01.png', data: COVER_BYTES }],
      }),
    );

    expect(result.current.cover.value).toMatchObject({ url: COVER_URL });
    expect(result.current.assets.value).toHaveLength(1);
    expect(result.current.buildProject().assets.map((asset) => asset.href)).toEqual([
      'OPS/Images/cover.jpg',
      'OPS/Images/figure-01.png',
    ]);
  });

  it('rebuilds the preview when the cover changes', async () => {
    vi.useFakeTimers();
    try {
      const onPreview = vi.fn();
      const assetResolver = vi.fn(() => COVER_BYTES);
      const { result } = harness(() =>
        useEpubProject({ chapters, debounceMs: 10, assetResolver, onPreview }),
      );

      await vi.advanceTimersByTimeAsync(10);
      await vi.waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
      expect(assetResolver).not.toHaveBeenCalled();

      result.current.setCover({ href: 'OPS/Images/cover.jpg', url: COVER_URL });
      await vi.advanceTimersByTimeAsync(10);
      await vi.waitFor(() => expect(onPreview).toHaveBeenCalledTimes(2));

      expect(assetResolver).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
