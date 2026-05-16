// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useManuscriptDraft } from '../src/useManuscriptDraft.js';

describe('useManuscriptDraft (React)', () => {
  it('starts with one empty chapter when initialChapters is omitted', () => {
    const { result } = renderHook(() => useManuscriptDraft());
    expect(result.current.chapters).toHaveLength(1);
    expect(result.current.selected).toBe(0);
  });

  it('adds, patches, reorders, and removes chapters', () => {
    const { result } = renderHook(() =>
      useManuscriptDraft({
        initialChapters: [
          { id: 'a', title: 'A', body: '' },
          { id: 'b', title: 'B', body: '' },
        ],
      }),
    );
    act(() => result.current.addChapter({ id: 'c', title: 'C' }));
    expect(result.current.chapters.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.selected).toBe(2);

    act(() => result.current.patchChapter(0, { title: 'A!' }));
    expect(result.current.chapters[0].title).toBe('A!');

    act(() => result.current.reorderChapters(0, 2));
    expect(result.current.chapters.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(result.current.selected).toBe(1);

    act(() => result.current.removeChapter(0));
    expect(result.current.chapters.map((c) => c.id)).toEqual(['c', 'a']);
    expect(result.current.selected).toBe(0);
  });

  it('clamps direct selection and replaces empty chapter lists with a draft chapter', () => {
    const { result } = renderHook(() =>
      useManuscriptDraft({
        initialChapters: [
          { id: 'a', title: 'A', body: '' },
          { id: 'b', title: 'B', body: '' },
        ],
      }),
    );

    act(() => result.current.setSelected(99));
    expect(result.current.selected).toBe(1);

    act(() => result.current.setChapters([result.current.chapters[1], result.current.chapters[0]]));
    expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['b', 'a']);
    expect(result.current.selected).toBe(0);

    act(() => result.current.setChapters([]));
    expect(result.current.chapters).toHaveLength(1);
    expect(result.current.selected).toBe(0);
  });

  it('does not let undefined addChapter fields erase generated chapter data', () => {
    const { result } = renderHook(() => useManuscriptDraft());

    act(() => result.current.addChapter({ id: undefined, title: undefined, body: undefined }));

    const second = result.current.chapters[1];
    expect(second.id).toMatch(/^chapter-/);
    expect(second.title).toBe('第2話');
    expect(second.body).toBe('');
  });

  it('debounces and fires onAutosave', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { result } = renderHook(() =>
      useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }),
    );

    act(() => result.current.patchChapter(0, { body: 'changed' }));
    expect(save).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0][0].body).toBe('changed');
    vi.useRealTimers();
  });

  it('does not autosave the initial draft before a change', () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn();
      renderHook(() => useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }));

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
