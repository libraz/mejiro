// @vitest-environment happy-dom

import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, type Ref, ref, shallowRef } from 'vue';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';

function mockLayout(): ChapterLayout {
  return {
    totalPages: 4,
    getSpread: vi.fn(),
    setImages: vi.fn(),
    clearImages: vi.fn(),
    syncImages: vi.fn(),
    resize: vi.fn(),
  } as unknown as ChapterLayout;
}

function mockBook(layout: ChapterLayout = mockLayout()): MejiroBook {
  return {
    computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
    layoutManuscript: vi.fn(async ({ chapters }: { chapters: ManuscriptChapter[] }) => {
      const map = new Map<string, ChapterLayout>();
      for (const chapter of chapters) {
        map.set(chapter.id ?? 'fallback', layout);
      }
      return map;
    }),
    getOptions: vi.fn(() => ({ fontSize: 16 })),
  } as unknown as MejiroBook;
}

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

describe('useManuscriptLayout (Vue)', () => {
  it('lays out a single manuscript chapter via layoutManuscript', async () => {
    const book = mockBook();
    const surfaceEl = document.createElement('div');
    const chapter: Ref<ManuscriptChapter | null> = shallowRef({
      id: 'c1',
      title: 'T',
      body: 'B',
    });
    const surface = ref(surfaceEl);
    const { result } = harness(() => useManuscriptLayout(book, chapter, surface));

    await nextTick();
    await nextTick();

    expect(book.layoutManuscript).toHaveBeenCalledWith({
      chapters: [chapter.value],
      dialect: 'mejiro',
    });
    expect(result.current.pageWidth.value).toBe(320);
  });

  it('clears layout when chapter becomes null', async () => {
    const book = mockBook();
    const surfaceEl = document.createElement('div');
    const chapter: Ref<ManuscriptChapter | null> = shallowRef({
      id: 'c1',
      title: 'T',
      body: 'B',
    });
    const surface = ref(surfaceEl);
    const { result } = harness(() => useManuscriptLayout(book, chapter, surface));
    await nextTick();
    await nextTick();
    expect(result.current.layout.value).not.toBeNull();

    chapter.value = null;
    await nextTick();
    await nextTick();
    expect(result.current.layout.value).toBeNull();
    expect(result.current.pageWidth.value).toBe(0);
  });

  it('honors a reactive dialect option', async () => {
    const book = mockBook();
    const surfaceEl = document.createElement('div');
    const chapter: Ref<ManuscriptChapter | null> = shallowRef({
      id: 'c1',
      title: 'T',
      body: 'B',
    });
    const surface = ref(surfaceEl);
    const dialect = shallowRef<'mejiro' | 'narou'>('mejiro');
    harness(() => useManuscriptLayout(book, chapter, surface, { dialect }));

    await nextTick();
    await nextTick();
    dialect.value = 'narou';
    await nextTick();
    await nextTick();

    const calls = (book.layoutManuscript as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.at(-1)?.[0]).toEqual({ chapters: [chapter.value], dialect: 'narou' });
  });
});
