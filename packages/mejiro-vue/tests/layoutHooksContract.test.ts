// @vitest-environment happy-dom

import { MejiroError } from '@libraz/mejiro';
import type {
  ChapterLayout,
  InChapterAnchor,
  ManuscriptChapter,
  MejiroBook,
  PageGeometry,
} from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, isRef, nextTick, reactive, ref, shallowRef } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { useChapterLayout, useManuscriptLayout } from '../src/index.js';

const GEOMETRY: PageGeometry = {
  pageWidth: 320,
  lineWidth: 400,
  pageHeight: 480,
  contentHeight: 400,
};
const ANCHOR: InChapterAnchor = { paragraphIndex: 0, charIndex: 4 };

const EPUB = {
  title: 'Book',
  chapters: [
    { title: 'A', paragraphs: [{ text: 'a', inlineAnnotations: [] }] },
    { title: 'B', paragraphs: [{ text: 'b', inlineAnnotations: [] }] },
  ],
} as EpubBook;

function fakeLayout(): ChapterLayout {
  return { pageCount: 4, getSpread: vi.fn() } as unknown as ChapterLayout;
}

/** A book stub whose layouts are produced by `next`. */
function fakeBook(next: () => Promise<ChapterLayout> = async () => fakeLayout()) {
  return {
    fitPageSize: vi.fn(() => GEOMETRY),
    layoutChapter: vi.fn(next),
    layoutManuscript: vi.fn(async () => [await next()]),
  };
}

/** Gives `el` a client box, as layout would. */
function setBox(el: HTMLElement, width: number, height: number): HTMLElement {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
  return el;
}

function sizedSurface(): HTMLElement {
  return setBox(document.createElement('div'), 640, 480);
}

function harness<T>(setup: () => T): T {
  let result!: T;
  mount(
    defineComponent({
      setup() {
        result = setup();
        return () => h('div');
      },
    }),
  );
  return result;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await nextTick();
}

/** Both composables behind one shape, to state the shared contract once. */
const composables = [
  {
    name: 'useChapterLayout',
    use: (book: ReturnType<typeof fakeBook>, surface: HTMLElement | null, extra = {}) =>
      useChapterLayout(book as unknown as MejiroBook, {
        epub: EPUB,
        chapterIndex: 0,
        surface,
        enableResize: false,
        ...extra,
      }),
  },
  {
    name: 'useManuscriptLayout',
    use: (book: ReturnType<typeof fakeBook>, surface: HTMLElement | null, extra = {}) =>
      useManuscriptLayout(book as unknown as MejiroBook, {
        chapter: { id: 'c', title: 'T', body: 'B' },
        surface,
        enableResize: false,
        ...extra,
      }),
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChapterLayout (Vue) — options object', () => {
  it('takes the chapter source and surface in one options object and follows getters', async () => {
    const book = fakeBook();
    const props = reactive({ chapterIndex: 0 });
    const surface = sizedSurface();
    const ctx = harness(() =>
      useChapterLayout(() => book as unknown as MejiroBook, {
        epub: () => EPUB,
        chapterIndex: () => props.chapterIndex,
        surface: () => surface,
        enableResize: false,
      }),
    );
    await settle();
    expect(book.layoutChapter).toHaveBeenLastCalledWith(EPUB.chapters[0]);

    props.chapterIndex = 1;
    await settle();
    expect(book.layoutChapter).toHaveBeenLastCalledWith(EPUB.chapters[1]);
    expect(ctx.layout.value).not.toBeNull();
  });
});

describe.each(composables)('$name (Vue) — layout state', ({ use }) => {
  it('exposes a failed layout as error and clears it when a layout succeeds', async () => {
    const failure = new MejiroError('font-load-failed', 'font failed');
    let fail = true;
    const book = fakeBook(async () => {
      if (fail) throw failure;
      return fakeLayout();
    });
    const ctx = harness(() => use(book, sizedSurface()));
    await settle();

    expect(ctx.error.value).toBe(failure);
    expect(ctx.error.value).toMatchObject({ name: 'MejiroError', code: 'font-load-failed' });
    expect(ctx.layout.value).toBeNull();

    fail = false;
    await ctx.recompute();
    expect(ctx.error.value).toBeNull();
    expect(ctx.layout.value).not.toBeNull();
  });

  it('holds the anchor of a reflow in a pendingRestore ref', async () => {
    const book = fakeBook();
    const ctx = harness(() => use(book, sizedSurface(), { capturePosition: () => ANCHOR }));
    await settle();

    await ctx.recompute({ blank: false });

    expect(isRef(ctx.pendingRestore)).toBe(true);
    expect(ctx.pendingRestore.value).toEqual(ANCHOR);
    ctx.pendingRestore.value = null;
    expect(ctx.pendingRestore.value).toBeNull();
  });

  it('reports the size fitPageSize measured', async () => {
    const book = fakeBook();
    const ctx = harness(() => use(book, sizedSurface()));
    await settle();

    expect([ctx.pageWidth.value, ctx.pageHeight.value, ctx.contentHeight.value]).toEqual([
      GEOMETRY.pageWidth,
      GEOMETRY.pageHeight,
      GEOMETRY.contentHeight,
    ]);
  });

  it('does not fit the page size while the surface measures zero, and lays out once it has a box', async () => {
    let observerCallback: ResizeObserverCallback = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observerCallback = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const book = fakeBook();
    const surface = setBox(document.createElement('div'), 0, 0);
    const ctx = harness(() => use(book, surface, { enableResize: true }));
    await settle();
    observerCallback([], {} as ResizeObserver);
    await settle();

    expect(book.fitPageSize).not.toHaveBeenCalled();
    expect(ctx.layout.value).toBeNull();
    expect(ctx.error.value).toBeNull();

    setBox(surface, 640, 480);
    observerCallback([], {} as ResizeObserver);
    await settle();

    expect(book.fitPageSize).toHaveBeenCalledTimes(1);
    expect(ctx.layout.value).not.toBeNull();
  });
});

describe('useManuscriptLayout (Vue) — options object', () => {
  it('follows a chapter getter and a dialect ref', async () => {
    const book = fakeBook();
    const chapter = shallowRef<ManuscriptChapter | null>({ title: 'T', body: 'one' });
    const dialect = ref<'mejiro' | 'narou'>('mejiro');
    harness(() =>
      useManuscriptLayout(book as unknown as MejiroBook, {
        chapter: () => chapter.value,
        surface: sizedSurface(),
        dialect,
        enableResize: false,
      }),
    );
    await settle();
    dialect.value = 'narou';
    await settle();

    expect(book.layoutManuscript).toHaveBeenLastCalledWith({
      chapters: [{ title: 'T', body: 'one' }],
      dialect: 'narou',
    });
  });
});

describe('layout composables (Vue) — public types', () => {
  it('take one options object and return refs typed by the shared names', () => {
    expectTypeErrors(
      `import type { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import {
  type ChapterLayoutRecomputeOptions,
  useChapterLayout,
  useManuscriptLayout,
} from '@libraz/mejiro-vue';
import { ref } from 'vue';
declare const book: MejiroBook;
declare const epub: EpubBook | null;
const surface = ref<HTMLElement | null>(null);
const ctx = useChapterLayout(book, { epub: () => epub, chapterIndex: () => 0, surface });
const manuscript = useManuscriptLayout(() => book, { chapter: () => null, surface });
const recompute: ChapterLayoutRecomputeOptions = { blank: false };
void ctx.recompute(recompute);
void manuscript.recompute(recompute);
ctx.pendingRestore.value = null;
const pageWidth: number = ctx.pageWidth.value;
useChapterLayout(book, ref(epub), ref(0), surface);
ctx.layout.value = null;
manuscript.error.value = null;
ctx.pageWidth.value = 0;`,
      {
        fails: [
          'useChapterLayout(book, ref(epub), ref(0), surface);',
          'ctx.layout.value = null;',
          'manuscript.error.value = null;',
          'ctx.pageWidth.value = 0;',
        ],
      },
    );
  });

  it('export one name per shared shape', () => {
    expectTypeErrors(
      `import type {
  ChapterLayoutRecomputeOptions,
  FetchEpubOptions,
  MejiroStorage,
} from '@libraz/mejiro-vue';
import type { RecomputeOptions } from '@libraz/mejiro-vue';
import type { PageDimensions } from '@libraz/mejiro-vue';
import type { ManuscriptRecomputeOptions } from '@libraz/mejiro-vue';
import type { ManuscriptPageDimensions } from '@libraz/mejiro-vue';
import type { AnnotationsStorage } from '@libraz/mejiro-vue';
import type { ReadingPositionStorage } from '@libraz/mejiro-vue';
import type { EpubProjectChapterDraft } from '@libraz/mejiro-vue';
import type { ManuscriptEditorChapter } from '@libraz/mejiro-vue';
type Uses = [ChapterLayoutRecomputeOptions, FetchEpubOptions, MejiroStorage];`,
      {
        fails: [
          '{ RecomputeOptions }',
          '{ PageDimensions }',
          '{ ManuscriptRecomputeOptions }',
          '{ ManuscriptPageDimensions }',
          '{ AnnotationsStorage }',
          '{ ReadingPositionStorage }',
          '{ EpubProjectChapterDraft }',
          '{ ManuscriptEditorChapter }',
        ],
      },
    );
  });
});
