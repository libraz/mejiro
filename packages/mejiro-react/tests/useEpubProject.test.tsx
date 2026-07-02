// @vitest-environment happy-dom
/** @jsxImportSource react */

import { EpubProject } from '@libraz/mejiro/epub';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@libraz/mejiro/epub', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
  EpubProject: {
    fromManuscript: vi.fn(() => ({
      export: vi.fn(async () => new ArrayBuffer(8)),
    })),
  },
  parseEpub: vi.fn(async () => ({ title: 'Preview', chapters: [] })),
}));

import { useEpubProject } from '../src/useEpubProject.js';

const chapters = [
  { id: 'a', title: 'A', body: '本文A' },
  { id: 'b', title: 'B', body: '本文B' },
  { id: 'c', title: 'C', body: '本文C' },
];

describe('useEpubProject (React)', () => {
  it('keeps selection on the same chapter when removing earlier chapters', () => {
    const { result } = renderHook(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    act(() => result.current.setSelectedChapter(2));
    act(() => result.current.removeChapter(0));

    expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['b', 'c']);
    expect(result.current.selectedChapter).toBe(1);
    expect(result.current.currentChapter?.id).toBe('c');
  });

  it('clamps direct chapter replacement and preserves a draft chapter for empty input', () => {
    const { result } = renderHook(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    act(() => result.current.setSelectedChapter(99));
    expect(result.current.selectedChapter).toBe(2);

    act(() => result.current.setChapters([result.current.chapters[2], result.current.chapters[0]]));
    expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['c', 'a']);
    expect(result.current.selectedChapter).toBe(0);

    act(() => result.current.setChapters([]));
    expect(result.current.chapters).toHaveLength(1);
    expect(result.current.selectedChapter).toBe(0);
    expect(result.current.currentChapter).not.toBeNull();
  });

  it('reorders chapters and keeps the selected chapter identity', () => {
    const { result } = renderHook(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    act(() => result.current.setSelectedChapter(2));
    act(() => result.current.reorderChapters(0, 2));
    expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['b', 'c', 'a']);
    expect(result.current.selectedChapter).toBe(1);
    expect(result.current.currentChapter?.id).toBe('c');

    act(() => result.current.reorderChapters(1, 0));
    expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['c', 'b', 'a']);
    expect(result.current.selectedChapter).toBe(0);
  });

  it('does not let undefined addChapter fields erase generated chapter data', () => {
    const { result } = renderHook(() => useEpubProject({ debounceMs: 10_000 }));

    act(() => result.current.addChapter({ id: undefined, title: undefined, body: undefined }));

    const second = result.current.chapters[1];
    expect(second.id).toMatch(/^chapter-/);
    expect(second.title).toBe('第2話');
    expect(second.body).toBe('');
  });

  it('uses custom default chapter copy for generated chapters', () => {
    const { result } = renderHook(() =>
      useEpubProject({
        debounceMs: 10_000,
        defaultChapterTitle: (index) => `Episode ${index + 1}`,
        defaultChapterBody: (index) => `Body ${index + 1}`,
      }),
    );

    expect(result.current.chapters[0]).toMatchObject({ title: 'Episode 1', body: 'Body 1' });
    act(() => result.current.addChapter());
    expect(result.current.chapters[1]).toMatchObject({ title: 'Episode 2', body: 'Body 2' });
    act(() => result.current.setChapters([]));
    expect(result.current.chapters[0]).toMatchObject({ title: 'Episode 1', body: 'Body 1' });
  });

  it('falls back to "Untitled" when exporting a chapter with no title', () => {
    const fromManuscript = vi.mocked(EpubProject.fromManuscript);
    fromManuscript.mockClear();
    const { result } = renderHook(() =>
      useEpubProject({
        debounceMs: 10_000,
        chapters: [{ id: 'blank', title: '', body: 'Body' }],
      }),
    );

    result.current.buildProject();

    expect(fromManuscript).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chapters: [expect.objectContaining({ id: 'blank', title: 'Untitled', body: 'Body' })],
      }),
    );
  });
});
