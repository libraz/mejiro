// @vitest-environment happy-dom

import { MejiroError } from '@libraz/mejiro';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import {
  type UseEpubProjectOptions,
  type UseEpubProjectReturn,
  useEpubProject,
} from '../src/index.js';

function harness(options: UseEpubProjectOptions = {}): UseEpubProjectReturn {
  let result!: UseEpubProjectReturn;
  mount(
    defineComponent({
      setup() {
        result = useEpubProject({ debounceMs: 10_000, ...options });
        return () => h('div');
      },
    }),
  );
  return result;
}

const CHAPTERS = [
  { id: 'a', title: 'A', body: 'a' },
  { id: 'b', title: 'B', body: 'b' },
  { id: 'c', title: 'C', body: 'c' },
] as const;

describe('useEpubProject (Vue) — defaults', () => {
  it('starts with an empty title and one empty chapter', () => {
    const project = harness();

    expect(project.metadata.value.title).toBe('');
    expect(project.chapters.value).toHaveLength(1);
    expect(project.chapters.value[0]).toMatchObject({ title: '', body: '' });
  });

  it('seeds its state from the initial options', () => {
    const project = harness({
      initialChapters: CHAPTERS,
      initialMetadata: { title: 'Seeded' },
      initialCover: { url: 'https://cdn.example.test/cover.jpg', mediaType: 'image/jpeg' },
      initialAssets: [{ href: 'OPS/Images/f.png', url: 'https://cdn.example.test/f.png' }],
    });

    expect(project.chapters.value.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(project.metadata.value.title).toBe('Seeded');
    expect(project.cover.value).toMatchObject({ mediaType: 'image/jpeg' });
    expect(project.assets.value).toHaveLength(1);
  });
});

describe('useEpubProject (Vue) — chapter list', () => {
  it('selects through selectedChapterIndex and removes the chapter at the given index', () => {
    const project = harness({ initialChapters: CHAPTERS });

    project.setSelectedChapterIndex(2);
    project.removeChapter(0);

    expect(project.chapters.value.map((c) => c.id)).toEqual(['b', 'c']);
    expect(project.selectedChapterIndex.value).toBe(1);
    expect(project.currentChapter.value?.id).toBe('c');
  });

  it('merges partial changes through updateChapter and updateMetadata', () => {
    const project = harness({ initialChapters: CHAPTERS, initialMetadata: { title: 'T' } });

    project.updateChapter(1, { body: 'changed' });
    project.updateMetadata({ subtitle: 'S' });

    expect(project.chapters.value[1]).toEqual({ id: 'b', title: 'B', body: 'changed' });
    expect(project.metadata.value).toMatchObject({ title: 'T', subtitle: 'S' });
  });
});

describe('useEpubProject (Vue) — export', () => {
  it('exports Uint8Array bytes, tracking exporting while it runs', async () => {
    const onExport = vi.fn();
    const project = harness({ initialChapters: CHAPTERS, onExport });

    const pending = project.exportEpub();
    expect(project.exporting.value).toBe(true);
    const bytes = await pending;

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(onExport).toHaveBeenCalledWith(bytes);
    expect(project.exporting.value).toBe(false);
    expect(project.error.value).toBeNull();
  });

  it('reports a failed export through error and onError and still rejects', async () => {
    const failure = new MejiroError('asset-fetch-failed', 'cover unavailable');
    const onError = vi.fn();
    const project = harness({
      initialChapters: CHAPTERS,
      initialCover: { url: 'https://cdn.example.test/cover.jpg', mediaType: 'image/jpeg' },
      assetResolver: () => Promise.reject(failure),
      onError,
    });

    await expect(project.exportEpub()).rejects.toBe(failure);

    expect(project.error.value).toMatchObject({ name: 'MejiroError', code: 'asset-fetch-failed' });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(project.exporting.value).toBe(false);
  });

  it('publishes the rebuilt preview as previewEpub', async () => {
    const project = harness({ initialChapters: CHAPTERS, debounceMs: 0 });

    await vi.waitFor(() => expect(project.previewEpub.value).not.toBeNull());
    expect(project.previewEpub.value?.chapters.length).toBeGreaterThan(0);
  });
});

describe('useEpubProject (Vue) — public types', () => {
  it('accepts readonly inputs and keeps its state read-only', () => {
    expectTypeErrors(
      `import { useEpubProject } from '@libraz/mejiro-vue';
const chapters = [{ id: 'a', title: 'A', body: 'a' }] as const;
const project = useEpubProject({ initialChapters: chapters, initialAssets: [] as const });
project.setChapters(chapters);
project.removeChapter(0);
const bytes: Promise<Uint8Array> = project.exportEpub();
project.metadata.value = { title: 'x' };
project.selectedChapterIndex.value = 1;
project.removeChapter();
project.patchChapter(0, {});
project.setMetadata({});
useEpubProject({ chapters });`,
      {
        fails: [
          "project.metadata.value = { title: 'x' };",
          'project.selectedChapterIndex.value = 1;',
          'project.removeChapter();',
          'project.patchChapter(0, {});',
          'project.setMetadata({});',
          'useEpubProject({ chapters });',
        ],
      },
    );
  });
});
