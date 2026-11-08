// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { useEpubProject } from '../src/index.js';

describe('useEpubProject starts empty', () => {
  it('defaults to an empty title and one empty chapter', () => {
    const { result } = renderHook(() => useEpubProject());
    expect(result.current.metadata.title).toBe('');
    expect(result.current.chapters).toHaveLength(1);
    expect(result.current.chapters[0]).toMatchObject({ title: '', body: '' });
  });

  it('generates chapters from defaultChapterTitle and defaultChapterBody', () => {
    const { result } = renderHook(() =>
      useEpubProject({
        defaultChapterTitle: (i) => `Chapter ${i + 1}`,
        defaultChapterBody: () => '…',
      }),
    );
    act(() => result.current.addChapter());
    expect(result.current.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(result.current.chapters[1].body).toBe('…');
  });
});

describe('useEpubProject takes initial values and merges through update*', () => {
  it('reads initialMetadata, initialChapters, initialCover and initialAssets on mount', () => {
    const cover = { data: new Uint8Array([1]), mediaType: 'image/png', filename: 'c.png' };
    const asset = { href: 'OPS/Images/a.png', data: new Uint8Array([2]) };
    const chapters = [{ id: 'one', title: 'One', body: 'a' }] as const;
    const { result } = renderHook(() =>
      useEpubProject({
        initialMetadata: { title: 'Book' },
        initialChapters: chapters,
        initialCover: cover,
        initialAssets: [asset],
      }),
    );
    expect(result.current.metadata.title).toBe('Book');
    expect(result.current.chapters).toEqual(chapters);
    expect(result.current.cover).toBe(cover);
    expect(result.current.assets).toEqual([asset]);
  });

  it('merges a patch with updateChapter and updateMetadata', () => {
    const { result } = renderHook(() =>
      useEpubProject({ initialChapters: [{ id: 'x', title: 'Old', body: 'keep' }] }),
    );
    act(() => {
      result.current.updateChapter(0, { title: 'New' });
      result.current.updateMetadata({ subtitle: 'Sub' });
    });
    expect(result.current.chapters[0]).toEqual({ id: 'x', title: 'New', body: 'keep' });
    expect(result.current.metadata.subtitle).toBe('Sub');
  });

  it('selects with setSelectedChapterIndex and removes the chapter at the index given', () => {
    const { result } = renderHook(() =>
      useEpubProject({
        initialChapters: [
          { id: 'a', title: 'A', body: '' },
          { id: 'b', title: 'B', body: '' },
          { id: 'c', title: 'C', body: '' },
        ],
      }),
    );
    act(() => result.current.setSelectedChapterIndex(2));
    expect(result.current.selectedChapterIndex).toBe(2);
    act(() => result.current.removeChapter(0));
    expect(result.current.chapters.map((c) => c.id)).toEqual(['b', 'c']);
    expect(result.current.selectedChapterIndex).toBe(1);
  });
});

describe('useEpubProject exports Uint8Array bytes', () => {
  it('resolves to bytes, hands them to onExport and builds previewEpub', async () => {
    const onExport = vi.fn();
    const { result } = renderHook(() =>
      useEpubProject({
        debounceMs: 0,
        initialChapters: [{ id: 'a', title: 'A', body: '本文。' }],
        onExport,
      }),
    );
    let bytes: Uint8Array | undefined;
    await act(async () => {
      bytes = await result.current.exportEpub();
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(onExport).toHaveBeenCalledWith(bytes);
    expect(result.current.exporting).toBe(false);
    await waitFor(() => expect(result.current.previewEpub).not.toBeNull());
  });

  it('stores a failed export in error, passes it to onError and rejects', async () => {
    const failure = new Error('resolver down');
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useEpubProject({
        debounceMs: 60_000,
        initialAssets: [{ href: 'OPS/Images/a.png', url: 'https://example.com/a.png' }],
        assetResolver: () => {
          throw failure;
        },
        onError,
      }),
    );
    let pending: Promise<Uint8Array> = Promise.resolve(new Uint8Array());
    act(() => {
      pending = result.current.exportEpub();
    });
    expect(result.current.exporting).toBe(true);
    await act(async () => {
      await expect(pending).rejects.toBe(failure);
    });
    expect(result.current.error).toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.exporting).toBe(false);
  });
});

describe('useEpubProject option and return names', () => {
  it('uses initial*, update*, selectedChapterIndex, previewEpub and readonly inputs', () => {
    expectTypeErrors(
      `import type { ManuscriptChapter } from '@libraz/mejiro';
import { useEpubProject, type UseEpubProjectReturn } from '@libraz/mejiro-react';
import type { EpubProjectChapterDraft } from '@libraz/mejiro-react';
const chapters: readonly ManuscriptChapter[] = [{ title: 'A', body: '' }];
useEpubProject({ initialChapters: chapters, initialMetadata: { title: 'T' } });
useEpubProject({ initialCover: { url: 'https://example.com/c.jpg', mediaType: 'image/jpeg' } });
declare const p: UseEpubProjectReturn;
p.setChapters(chapters);
p.setAssets([] as const);
p.updateChapter(0, { title: 'B' });
p.updateMetadata({ title: 'U' });
p.setSelectedChapterIndex(p.selectedChapterIndex);
p.removeChapter(p.selectedChapterIndex);
export const bytes: Promise<Uint8Array> = p.exportEpub();
export const flags: [boolean, Error | null] = [p.exporting, p.error];
export const preview = p.previewEpub;
useEpubProject({ chapters });
useEpubProject({ metadata: { title: 'T' } });
p.patchChapter(0, { title: 'B' });
p.setMetadata({ title: 'U' });
p.removeChapter();
export const old = p.previewBook;
export const oldSelected = p.selectedChapter;`,
      {
        fails: [
          '{ EpubProjectChapterDraft }',
          'useEpubProject({ chapters })',
          'useEpubProject({ metadata:',
          'p.patchChapter',
          'p.setMetadata',
          'p.removeChapter();',
          'p.previewBook',
          'p.selectedChapter;',
        ],
      },
    );
  });
});
