// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { useManuscriptDraft } from '../src/index.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useManuscriptDraft autosaves on autosaveDeps changes', () => {
  it('saves after autosaveDebounceMs when a dependency changes', () => {
    const onAutosave = vi.fn();
    const { rerender } = renderHook(
      ({ title }) =>
        useManuscriptDraft({ onAutosave, autosaveDeps: [title], autosaveDebounceMs: 100 }),
      { initialProps: { title: 'A' } },
    );
    act(() => vi.advanceTimersByTime(500));
    expect(onAutosave).not.toHaveBeenCalled();

    rerender({ title: 'B' });
    act(() => vi.advanceTimersByTime(99));
    expect(onAutosave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onAutosave).toHaveBeenCalledTimes(1);
  });

  it('does not restart the debounce for a new array holding the same values', () => {
    const onAutosave = vi.fn();
    const { result, rerender } = renderHook(
      ({ title }) =>
        useManuscriptDraft({ onAutosave, autosaveDeps: [title], autosaveDebounceMs: 100 }),
      { initialProps: { title: 'A' } },
    );
    act(() => result.current.updateChapter(0, { body: 'edit' }));
    act(() => vi.advanceTimersByTime(60));
    rerender({ title: 'A' });
    act(() => vi.advanceTimersByTime(40));
    expect(onAutosave).toHaveBeenCalledTimes(1);
  });
});

describe('useManuscriptDraft state names', () => {
  it('starts with one empty chapter and selects by selectedChapterIndex', () => {
    const { result } = renderHook(() => useManuscriptDraft());
    expect(result.current.chapters).toHaveLength(1);
    expect(result.current.chapters[0]).toMatchObject({ title: '', body: '' });

    act(() => result.current.addChapter({ title: 'Two' }));
    expect(result.current.selectedChapterIndex).toBe(1);
    act(() => result.current.setSelectedChapterIndex(0));
    expect(result.current.selectedChapterIndex).toBe(0);
    act(() => result.current.updateChapter(1, { body: 'b' }));
    expect(result.current.chapters[1]).toMatchObject({ title: 'Two', body: 'b' });
  });

  it('types the draft API with the shared names and readonly inputs', () => {
    expectTypeErrors(
      `import type { ManuscriptChapter } from '@libraz/mejiro';
import { useManuscriptDraft, type UseManuscriptDraftReturn } from '@libraz/mejiro-react';
import type { ManuscriptEditorChapter } from '@libraz/mejiro-react';
const initialChapters: readonly ManuscriptChapter[] = [{ id: 'a', title: 'A', body: '' }];
useManuscriptDraft({ initialChapters, autosaveDeps: ['t', 1], autosaveDebounceMs: 10 });
useManuscriptDraft({ autosavePayload: (chapters: readonly ManuscriptChapter[]) => chapters.length });
declare const d: UseManuscriptDraftReturn;
d.setChapters(initialChapters);
d.updateChapter(0, { title: 'B' });
d.removeChapter(d.selectedChapterIndex);
d.setSelectedChapterIndex(0);
useManuscriptDraft({ autosaveKey: 'k' });
useManuscriptDraft({ autosaveDelay: 10 });
d.patchChapter(0, { title: 'B' });
d.removeChapter();
export const old = d.selected;`,
      {
        fails: [
          '{ ManuscriptEditorChapter }',
          "autosaveKey: 'k'",
          'autosaveDelay: 10',
          'd.patchChapter',
          'd.removeChapter();',
          'd.selected;',
        ],
      },
    );
  });
});
