// @vitest-environment happy-dom

import { EpubProject } from '@libraz/mejiro/epub';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

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

function harness<T>(setup: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  const TestComponent = defineComponent({
    setup() {
      result.current = setup();
      return () => h('div');
    },
  });
  mount(TestComponent);
  return { result };
}

describe('useEpubProject (Vue)', () => {
  it('keeps selection on the same chapter when removing earlier chapters', () => {
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    result.current.setSelectedChapter(2);
    result.current.removeChapter(0);

    expect(result.current.chapters.value.map((chapter) => chapter.id)).toEqual(['b', 'c']);
    expect(result.current.selectedChapter.value).toBe(1);
    expect(result.current.currentChapter.value?.id).toBe('c');
  });

  it('clamps direct chapter replacement and preserves a draft chapter for empty input', () => {
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    result.current.setSelectedChapter(99);
    expect(result.current.selectedChapter.value).toBe(2);

    result.current.setChapters([
      result.current.chapters.value[2],
      result.current.chapters.value[0],
    ]);
    expect(result.current.chapters.value.map((chapter) => chapter.id)).toEqual(['c', 'a']);
    expect(result.current.selectedChapter.value).toBe(0);

    result.current.setChapters([]);
    expect(result.current.chapters.value).toHaveLength(1);
    expect(result.current.selectedChapter.value).toBe(0);
    expect(result.current.currentChapter.value).not.toBeNull();
  });

  it('reorders chapters and keeps the selected chapter identity', () => {
    const { result } = harness(() => useEpubProject({ chapters, debounceMs: 10_000 }));

    result.current.setSelectedChapter(2);
    result.current.reorderChapters(0, 2);
    expect(result.current.chapters.value.map((chapter) => chapter.id)).toEqual(['b', 'c', 'a']);
    expect(result.current.selectedChapter.value).toBe(1);
    expect(result.current.currentChapter.value?.id).toBe('c');

    result.current.reorderChapters(1, 0);
    expect(result.current.chapters.value.map((chapter) => chapter.id)).toEqual(['c', 'b', 'a']);
    expect(result.current.selectedChapter.value).toBe(0);
  });

  it('does not let undefined addChapter fields erase generated chapter data', () => {
    const { result } = harness(() => useEpubProject({ debounceMs: 10_000 }));

    result.current.addChapter({ id: undefined, title: undefined, body: undefined });

    const second = result.current.chapters.value[1];
    expect(second.id).toMatch(/^chapter-/);
    expect(second.title).toBe('第2話');
    expect(second.body).toBe('');
  });

  it('falls back to "Untitled" when exporting a chapter with no title', () => {
    const fromManuscript = vi.mocked(EpubProject.fromManuscript);
    fromManuscript.mockClear();
    const { result } = harness(() =>
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
