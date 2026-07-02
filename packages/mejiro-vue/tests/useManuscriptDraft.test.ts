// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { useManuscriptDraft } from '../src/useManuscriptDraft.js';

function harness<T>(setup: () => T): { result: { current: T }; app: ReturnType<typeof mount> } {
  const result = { current: undefined as unknown as T };
  const TestComponent = defineComponent({
    setup() {
      result.current = setup();
      return () => h('div');
    },
  });
  const app = mount(TestComponent);
  return { result, app };
}

describe('useManuscriptDraft (Vue)', () => {
  it('seeds a single empty chapter when initialChapters is omitted', () => {
    const { result } = harness(() => useManuscriptDraft());
    expect(result.current.chapters.value).toHaveLength(1);
    expect(result.current.selected.value).toBe(0);
  });

  it('mutates chapters via the helper methods', () => {
    const { result } = harness(() =>
      useManuscriptDraft({
        initialChapters: [
          { id: 'a', title: 'A', body: '' },
          { id: 'b', title: 'B', body: '' },
        ],
      }),
    );
    result.current.addChapter({ id: 'c', title: 'C' });
    expect(result.current.chapters.value.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    result.current.patchChapter(0, { title: 'A!' });
    expect(result.current.chapters.value[0].title).toBe('A!');
    result.current.reorderChapters(0, 2);
    expect(result.current.chapters.value.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(result.current.selected.value).toBe(1);
    result.current.removeChapter(0);
    expect(result.current.chapters.value.map((c) => c.id)).toEqual(['c', 'a']);
    expect(result.current.selected.value).toBe(0);
  });

  it('clamps direct selection and replaces empty chapter lists with a draft chapter', () => {
    const { result } = harness(() =>
      useManuscriptDraft({
        initialChapters: [
          { id: 'a', title: 'A', body: '' },
          { id: 'b', title: 'B', body: '' },
        ],
      }),
    );
    result.current.setSelected(99);
    expect(result.current.selected.value).toBe(1);
    result.current.setChapters([
      result.current.chapters.value[1],
      result.current.chapters.value[0],
    ]);
    expect(result.current.chapters.value.map((chapter) => chapter.id)).toEqual(['b', 'a']);
    expect(result.current.selected.value).toBe(0);
    result.current.setChapters([]);
    expect(result.current.chapters.value).toHaveLength(1);
    expect(result.current.selected.value).toBe(0);
  });

  it('does not let undefined addChapter fields erase generated chapter data', () => {
    const { result } = harness(() => useManuscriptDraft());

    result.current.addChapter({ id: undefined, title: undefined, body: undefined });

    const second = result.current.chapters.value[1];
    expect(second.id).toMatch(/^chapter-/);
    expect(second.title).toBe('第2話');
    expect(second.body).toBe('');
  });

  it('uses custom default chapter copy for generated chapters', () => {
    const { result } = harness(() =>
      useManuscriptDraft({
        defaultChapterTitle: (index) => `Episode ${index + 1}`,
        defaultChapterBody: (index) => `Body ${index + 1}`,
      }),
    );

    expect(result.current.chapters.value[0]).toMatchObject({
      title: 'Episode 1',
      body: 'Body 1',
    });
    result.current.addChapter();
    expect(result.current.chapters.value[1]).toMatchObject({
      title: 'Episode 2',
      body: 'Body 2',
    });
    result.current.setChapters([]);
    expect(result.current.chapters.value[0]).toMatchObject({
      title: 'Episode 1',
      body: 'Body 1',
    });
  });

  it('debounces and fires onAutosave', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { result } = harness(() => useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }));
    result.current.patchChapter(0, { body: 'changed' });
    await nextTick();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0][0].body).toBe('changed');
    vi.useRealTimers();
  });

  it('cancels a pending autosave when the scope is disposed', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { result, app } = harness(() =>
      useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }),
    );
    result.current.patchChapter(0, { body: 'changed' });
    await nextTick();
    app.unmount();
    vi.advanceTimersByTime(150);
    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
