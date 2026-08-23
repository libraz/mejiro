// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
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

  it('uses custom default chapter copy for generated chapters', () => {
    const { result } = renderHook(() =>
      useManuscriptDraft({
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

  for (const [mode, wrapper] of [
    ['plain', undefined],
    ['strict', StrictMode],
  ] as const) {
    it(`tracks the selected chapter through add / remove / reorder (${mode})`, () => {
      const { result } = renderHook(
        () =>
          useManuscriptDraft({
            initialChapters: [
              { id: 'a', title: 'A', body: '' },
              { id: 'b', title: 'B', body: '' },
              { id: 'c', title: 'C', body: '' },
              { id: 'd', title: 'D', body: '' },
            ],
          }),
        { wrapper },
      );

      act(() => result.current.setSelected(3));
      act(() => result.current.removeChapter(1));
      expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['a', 'c', 'd']);
      expect(result.current.selected).toBe(2);

      act(() => result.current.reorderChapters(0, 2));
      expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['c', 'd', 'a']);
      expect(result.current.selected).toBe(1);

      act(() => result.current.addChapter({ id: 'e', title: 'E' }));
      expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['c', 'd', 'a', 'e']);
      expect(result.current.selected).toBe(3);
    });
  }

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

  it('flushes a pending autosave on unmount', () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn();
      const { result, unmount } = renderHook(() =>
        useManuscriptDraft({ onAutosave: save, autosaveDelay: 1000 }),
      );

      act(() => result.current.patchChapter(0, { body: 'changed' }));
      expect(save).not.toHaveBeenCalled();

      unmount();

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0][0].body).toBe('changed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces autosave errors', async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn(async () => {
        throw new Error('save failed');
      });
      const { result } = renderHook(() =>
        useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }),
      );

      act(() => result.current.patchChapter(0, { body: 'changed' }));
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.autosaveError?.message).toBe('save failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the draft dirty after a rejected autosave so the next flush retries', async () => {
    vi.useFakeTimers();
    try {
      let attempt = 0;
      const save = vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
      });
      const { result } = renderHook(() =>
        useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }),
      );

      act(() => result.current.patchChapter(0, { body: 'changed' }));
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(result.current.autosaveError?.message).toBe('offline');

      await act(async () => {
        result.current.flushAutosave();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0][0].body).toBe('changed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying once an autosave succeeds', async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn(async () => {});
      const { result } = renderHook(() =>
        useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }),
      );

      act(() => result.current.patchChapter(0, { body: 'changed' }));
      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(save).toHaveBeenCalledTimes(1);

      await act(async () => {
        result.current.flushAutosave();
        await Promise.resolve();
      });
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
