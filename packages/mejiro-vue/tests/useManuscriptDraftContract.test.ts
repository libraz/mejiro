// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import {
  type UseManuscriptDraftOptions,
  type UseManuscriptDraftReturn,
  useManuscriptDraft,
} from '../src/index.js';

function harness<T>(options: UseManuscriptDraftOptions<T> = {}): UseManuscriptDraftReturn {
  let result!: UseManuscriptDraftReturn;
  mount(
    defineComponent({
      setup() {
        result = useManuscriptDraft(options);
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

afterEach(() => {
  vi.useRealTimers();
});

describe('useManuscriptDraft (Vue) — chapter list', () => {
  it('starts with one chapter whose title and body are empty', () => {
    const draft = harness();

    expect(draft.chapters.value).toHaveLength(1);
    expect(draft.chapters.value[0]).toMatchObject({ title: '', body: '' });
  });

  it('selects through selectedChapterIndex and merges through updateChapter', () => {
    const draft = harness({ initialChapters: CHAPTERS });

    draft.setSelectedChapterIndex(2);
    draft.updateChapter(2, { body: 'changed' });
    draft.removeChapter(0);

    expect(draft.selectedChapterIndex.value).toBe(1);
    expect(draft.chapters.value[1]).toEqual({ id: 'c', title: 'C', body: 'changed' });
  });
});

describe('useManuscriptDraft (Vue) — autosave', () => {
  it('waits autosaveDebounceMs after the last change before saving', async () => {
    vi.useFakeTimers();
    const onAutosave = vi.fn();
    const draft = harness({ initialChapters: CHAPTERS, onAutosave, autosaveDebounceMs: 300 });

    draft.updateChapter(0, { body: 'x' });
    await nextTick();
    vi.advanceTimersByTime(299);
    expect(onAutosave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAutosave).toHaveBeenCalledTimes(1);
  });

  it('saves again when a value in autosaveDeps changes', async () => {
    vi.useFakeTimers();
    const title = ref('First');
    const onAutosave = vi.fn();
    harness({
      initialChapters: CHAPTERS,
      onAutosave,
      autosaveDebounceMs: 10,
      autosaveDeps: () => [title.value],
      autosavePayload: (chapters) => ({ title: title.value, chapters }),
    });

    title.value = 'Second';
    await nextTick();
    vi.advanceTimersByTime(10);

    expect(onAutosave).toHaveBeenCalledTimes(1);
    expect(onAutosave.mock.calls[0][0]).toMatchObject({ title: 'Second' });

    title.value = 'Second';
    await nextTick();
    vi.advanceTimersByTime(10);
    expect(onAutosave).toHaveBeenCalledTimes(1);
  });
});

describe('useManuscriptDraft (Vue) — public types', () => {
  it('takes the shared chapter type and readonly inputs', () => {
    expectTypeErrors(
      `import type { ManuscriptChapter } from '@libraz/mejiro';
import { useManuscriptDraft } from '@libraz/mejiro-vue';
const chapters = [{ id: 'a', title: 'A', body: 'a' }] as const;
const draft = useManuscriptDraft({ initialChapters: chapters, autosaveDeps: [1, 'x'] });
const first: ManuscriptChapter | undefined = draft.chapters.value[0];
draft.setChapters(chapters);
draft.chapters.value = [];
draft.patchChapter(0, {});
useManuscriptDraft({ autosaveKey: 'k' });
useManuscriptDraft({ autosaveDelay: 100 });`,
      {
        fails: [
          'draft.chapters.value = [];',
          'draft.patchChapter(0, {});',
          "autosaveKey: 'k'",
          'autosaveDelay: 100',
        ],
      },
    );
  });
});
