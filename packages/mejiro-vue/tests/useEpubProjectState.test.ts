// @vitest-environment happy-dom

import type { AssetResolverRequest } from '@libraz/mejiro/epub';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { useEpubProject } from '../src/useEpubProject.js';

const chapters = [
  { id: 'a', title: 'A', body: '本文A' },
  { id: 'b', title: 'B', body: '本文B' },
];

const COVER = { href: 'OPS/Images/cover.jpg', url: 'https://cdn.example.test/cover.jpg' };
const COVER_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function harness<T>(setup: () => T): { result: { current: T }; unmount: () => void } {
  const result = { current: undefined as unknown as T };
  const TestComponent = defineComponent({
    setup() {
      result.current = setup();
      return () => h('div');
    },
  });
  const wrapper = mount(TestComponent);
  return { result, unmount: () => wrapper.unmount() };
}

/** Resolver that stays pending until its request is aborted, recording each signal. */
function pendingResolver(): {
  resolver: (request: AssetResolverRequest) => Promise<Uint8Array>;
  signals: AbortSignal[];
} {
  const signals: AbortSignal[] = [];
  const resolver = ({ signal }: AssetResolverRequest) =>
    new Promise<Uint8Array>((_, reject) => {
      if (!signal) throw new Error('preview export passed no signal');
      signals.push(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  return { resolver, signals };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEpubProject actions read the latest state (Vue)', () => {
  it('builds from setter values applied earlier in the same tick', () => {
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    result.current.setMetadata({ title: 'Renamed' });
    result.current.setCover(COVER);
    result.current.setAssets([{ href: 'OPS/Images/figure.png', data: COVER_BYTES }]);
    result.current.addChapter({ id: 'c', title: 'C', body: '本文C' });
    const built = result.current.buildProject();

    expect(built.metadata.title).toBe('Renamed');
    expect(built.assets.map((asset) => asset.href)).toEqual([
      'OPS/Images/cover.jpg',
      'OPS/Images/figure.png',
    ]);
    expect(built.chapters.map((chapter) => chapter.id)).toContain('c');
  });

  it('exports the cover set in the same tick', async () => {
    const assetResolver = vi.fn(() => COVER_BYTES);
    const { result } = harness(() =>
      useEpubProject({ chapters, debounceMs: 10_000, assetResolver }),
    );

    result.current.setCover(COVER);
    await result.current.exportEpub();

    expect(assetResolver).toHaveBeenCalledWith(expect.objectContaining({ url: COVER.url }));
  });
});

describe('useEpubProject package identifier (Vue)', () => {
  it('keeps one identifier across builds of the same project', () => {
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    const first = result.current.buildProject().metadata.identifier;
    const second = result.current.buildProject().metadata.identifier;

    expect(first).toMatch(/^urn:uuid:/u);
    expect(second).toBe(first);
    expect(result.current.metadata.value.identifier).toBe(first);
  });

  it('keeps a caller-supplied identifier', () => {
    const { result } = harness(() =>
      useEpubProject({ chapters, metadata: { identifier: 'urn:isbn:1' }, debounceMs: 10_000 }),
    );

    expect(result.current.buildProject().metadata.identifier).toBe('urn:isbn:1');
  });

  it('keeps the identifier when setMetadata clears or blanks it', () => {
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 10_000 }));
    const seeded = result.current.buildProject().metadata.identifier;

    for (const identifier of [undefined, '', '   ']) {
      result.current.setMetadata({ identifier });
      expect(result.current.buildProject().metadata.identifier).toBe(seeded);
    }
    result.current.setMetadata({ identifier: 'urn:isbn:2' });
    expect(result.current.buildProject().metadata.identifier).toBe('urn:isbn:2');
    result.current.setMetadata({ identifier: undefined });
    expect(result.current.buildProject().metadata.identifier).toBe('urn:isbn:2');
  });
});

describe('useEpubProject generated chapter ids (Vue)', () => {
  it('never reuses an id still in the list within one millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const { result } = harness(() => useEpubProject({ debounceMs: 10_000 }));

    result.current.addChapter();
    result.current.removeChapter(0);
    result.current.addChapter();

    const ids = result.current.chapters.value.map((chapter) => chapter.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('useEpubProject preview pipeline (Vue)', () => {
  it('publishes a rebuilt preview and reports it through onPreview', async () => {
    const onPreview = vi.fn();
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 0, onPreview }));

    await vi.waitFor(() => expect(result.current.previewBook.value).not.toBeNull());
    expect(result.current.previewing.value).toBe(false);
    expect(result.current.previewError.value).toBeNull();
    expect(onPreview).toHaveBeenCalledWith(result.current.previewBook.value);
  });

  it('aborts the asset resolution of a superseded preview and ignores its failure', async () => {
    const { resolver, signals } = pendingResolver();
    const assetResolver = vi.fn(resolver);
    const { result } = harness(() =>
      useEpubProject({ chapters, debounceMs: 0, cover: COVER, assetResolver }),
    );
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    assetResolver.mockImplementation(() => Promise.resolve(COVER_BYTES));
    result.current.setMetadata({ title: 'Edited' });
    await nextTick();

    expect(signals[0]?.aborted).toBe(true);
    await vi.waitFor(() => expect(result.current.previewBook.value?.title).toBe('Edited'));
    expect(result.current.previewError.value).toBeNull();
  });

  it('aborts the asset resolution of a preview still running at unmount', async () => {
    const { resolver, signals } = pendingResolver();
    const onPreview = vi.fn();
    const { unmount } = harness(() =>
      useEpubProject({ chapters, debounceMs: 0, cover: COVER, assetResolver: resolver, onPreview }),
    );
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    unmount();

    expect(signals[0]?.aborted).toBe(true);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('never starts a preview whose debounce is still pending at unmount', async () => {
    const assetResolver = vi.fn(() => COVER_BYTES);
    const { unmount } = harness(() =>
      useEpubProject({ chapters, debounceMs: 20, cover: COVER, assetResolver }),
    );

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(assetResolver).not.toHaveBeenCalled();
  });
});
