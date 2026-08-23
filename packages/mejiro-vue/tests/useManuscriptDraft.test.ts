// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
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

  it('flushes a pending autosave when the scope is disposed', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { result, app } = harness(() =>
      useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }),
    );
    result.current.patchChapter(0, { body: 'changed' });
    await nextTick();
    expect(save).not.toHaveBeenCalled();

    app.unmount();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0][0].body).toBe('changed');
    vi.advanceTimersByTime(150);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('surfaces autosave errors', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {
      throw new Error('save failed');
    });
    const { result } = harness(() => useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }));
    result.current.patchChapter(0, { body: 'changed' });
    await nextTick();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.autosaveError.value?.message).toBe('save failed');
    vi.useRealTimers();
  });

  it('keeps the draft dirty after a rejected autosave so the next flush retries', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const save = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('offline');
    });
    const { result } = harness(() => useManuscriptDraft({ onAutosave: save, autosaveDelay: 100 }));
    result.current.patchChapter(0, { body: 'changed' });
    await nextTick();
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    result.current.flushAutosave();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0][0].body).toBe('changed');
    vi.useRealTimers();
  });

  it('autosaves a mapped payload and reacts to autosaveKey changes', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const metaKey = ref('Draft');
    const { result } = harness(() =>
      useManuscriptDraft<{ title: string; chapters: unknown[] }>({
        onAutosave: save,
        autosaveDelay: 100,
        autosaveKey: metaKey,
        autosavePayload: (chapters) => ({ title: metaKey.value, chapters }),
      }),
    );

    result.current.patchChapter(0, { body: 'changed' });
    await nextTick();
    vi.advanceTimersByTime(150);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ title: 'Draft' });

    metaKey.value = 'Renamed';
    await nextTick();
    vi.advanceTimersByTime(150);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ title: 'Renamed' });
    vi.useRealTimers();
  });
});
