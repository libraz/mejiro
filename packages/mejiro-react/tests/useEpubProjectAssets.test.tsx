// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { AssetResolverRequest } from '@libraz/mejiro/epub';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEpubProject } from '../src/useEpubProject.js';

const chapters = [{ id: 'a', title: 'A', body: '本文A' }];

const COVER_URL = 'https://cdn.example.test/works/1/cover.jpg';
const COVER_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe('useEpubProject asset registration (React)', () => {
  it('registers a URL-only cover in the project it builds', () => {
    const { result } = renderHook(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    act(() => result.current.setCover({ href: 'OPS/Images/cover.jpg', url: COVER_URL }));

    expect(result.current.cover).toMatchObject({ url: COVER_URL });
    expect(result.current.buildProject().assets).toEqual([
      expect.objectContaining({ url: COVER_URL, properties: 'cover-image' }),
    ]);
  });

  it('resolves a URL-only cover through assetResolver during exportEpub', async () => {
    const assetResolver = vi.fn(({ url }: AssetResolverRequest) => {
      expect(url).toBe(COVER_URL);
      return COVER_BYTES;
    });
    const { result } = renderHook(() =>
      useEpubProject({ chapters, debounceMs: 10_000, assetResolver }),
    );

    act(() => result.current.setCover({ href: 'OPS/Images/cover.jpg', url: COVER_URL }));

    const buffer = await act(async () => result.current.exportEpub());

    expect(assetResolver).toHaveBeenCalledTimes(1);
    expect(assetResolver.mock.calls[0][0]).toMatchObject({ url: COVER_URL });
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('drops the cover from the exported project when set back to null', async () => {
    const assetResolver = vi.fn(() => COVER_BYTES);
    const { result } = renderHook(() =>
      useEpubProject({ chapters, debounceMs: 10_000, assetResolver }),
    );

    act(() => result.current.setCover({ href: 'OPS/Images/cover.jpg', url: COVER_URL }));
    act(() => result.current.setCover(null));

    await act(async () => result.current.exportEpub());

    expect(result.current.cover).toBeNull();
    expect(result.current.buildProject().assets).toEqual([]);
    expect(assetResolver).not.toHaveBeenCalled();
  });

  it('registers URL-only non-cover assets through setAssets', async () => {
    const illustrationUrl = 'https://cdn.example.test/works/1/figure-01.png';
    const assetResolver = vi.fn(() => COVER_BYTES);
    const { result } = renderHook(() =>
      useEpubProject({ chapters, debounceMs: 10_000, assetResolver }),
    );

    act(() =>
      result.current.setAssets([{ href: 'OPS/Images/figure-01.png', url: illustrationUrl }]),
    );

    expect(result.current.buildProject().assets).toEqual([
      expect.objectContaining({ url: illustrationUrl }),
    ]);

    await act(async () => result.current.exportEpub());

    expect(assetResolver.mock.calls[0][0]).toMatchObject({ url: illustrationUrl });
  });

  it('seeds the cover and assets from the initial options', () => {
    const { result } = renderHook(() =>
      useEpubProject({
        chapters,
        debounceMs: 10_000,
        cover: { href: 'OPS/Images/cover.jpg', url: COVER_URL },
        assets: [{ href: 'OPS/Images/figure-01.png', data: COVER_BYTES }],
      }),
    );

    expect(result.current.cover).toMatchObject({ url: COVER_URL });
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.buildProject().assets.map((asset) => asset.href)).toEqual([
      'OPS/Images/cover.jpg',
      'OPS/Images/figure-01.png',
    ]);
  });
});
