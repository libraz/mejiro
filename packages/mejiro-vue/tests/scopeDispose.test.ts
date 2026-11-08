// @vitest-environment happy-dom

import type { ChapterLayout, MejiroBook, SpreadResult } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';
import { useSpread } from '../src/useSpread.js';

const disconnects: number[] = [];
let observerCount = 0;

class StubResizeObserver {
  private readonly id = observerCount++;
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    disconnects.push(this.id);
  }
}

function stubBook(): MejiroBook {
  return {
    fitPageSize: vi.fn(() => ({
      pageWidth: 320,
      lineWidth: 400,
      pageHeight: 480,
      contentHeight: 400,
    })),
    layoutChapter: vi.fn(async () => null),
    layoutManuscript: vi.fn(async () => []),
    getOptions: vi.fn(() => ({ fontSize: 16 })),
  } as unknown as MejiroBook;
}

/** A surface element with a measurable box, as a mounted reader has. */
function sizedSurface(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 480 });
  return el;
}

function mockLayout(pageCount = 8): ChapterLayout {
  return {
    pageCount,
    getSpread: vi.fn((i: number) => ({ spreadIndex: i, pageCount }) as unknown as SpreadResult),
  } as unknown as ChapterLayout;
}

describe('composable cleanup in a bare effectScope', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    disconnects.length = 0;
  });

  it('useChapterLayout disconnects its ResizeObserver when the scope stops', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const surface = ref<HTMLElement | null>(sizedSurface());
    const scope = effectScope();
    scope.run(() =>
      useChapterLayout(stubBook(), {
        epub: shallowRef<EpubBook | null>(null),
        chapterIndex: ref(0),
        surface,
      }),
    );
    await nextTick();
    const before = disconnects.length;
    scope.stop();
    expect(disconnects.length).toBe(before + 1);
  });

  it('useManuscriptLayout disconnects its ResizeObserver when the scope stops', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const surface = ref<HTMLElement | null>(sizedSurface());
    const scope = effectScope();
    scope.run(() => useManuscriptLayout(stubBook(), { chapter: ref(null), surface }));
    await nextTick();
    const before = disconnects.length;
    scope.stop();
    expect(disconnects.length).toBe(before + 1);
  });

  it('useChapterLayout removes its window resize fallback when the scope stops', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const remove = vi.spyOn(window, 'removeEventListener');
    const scope = effectScope();
    scope.run(() =>
      useChapterLayout(stubBook(), {
        epub: shallowRef<EpubBook | null>(null),
        chapterIndex: ref(0),
        surface: ref(null),
      }),
    );
    scope.stop();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    remove.mockRestore();
  });

  it('useSpread cancels a pending page turn when the scope stops', () => {
    vi.useFakeTimers();
    const layout = shallowRef<ChapterLayout | null>(mockLayout());
    const scope = effectScope();
    const spread = scope.run(() => useSpread(layout, { turnDurationMs: 100 }));
    spread?.goTo(1);
    scope.stop();
    vi.advanceTimersByTime(200);
    expect(spread?.index.value).toBe(0);
  });
});

describe('layout composables abandon an in-flight layout when the scope stops', () => {
  /** A promise settled from outside. */
  function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('useChapterLayout assigns nothing and reports no error after the scope stops', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const pending = deferred<ChapterLayout | null>();
    const book = stubBook();
    vi.mocked(book.layoutChapter).mockReturnValue(pending.promise);
    const onError = vi.fn();
    const epub = shallowRef({ chapters: [{ title: 'c' }] } as unknown as EpubBook);
    const scope = effectScope();
    const state = scope.run(() =>
      useChapterLayout(book, {
        epub,
        chapterIndex: ref(0),
        surface: ref(sizedSurface()),
        onError,
      }),
    );
    await nextTick();
    expect(book.layoutChapter).toHaveBeenCalledTimes(1);

    scope.stop();
    pending.resolve(mockLayout());
    await pending.promise;
    await nextTick();

    expect(state?.layout.value).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('useChapterLayout reports no error for a layout that fails after the scope stops', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const pending = deferred<ChapterLayout | null>();
    const book = stubBook();
    vi.mocked(book.layoutChapter).mockReturnValue(pending.promise);
    const onError = vi.fn();
    const epub = shallowRef({ chapters: [{ title: 'c' }] } as unknown as EpubBook);
    const scope = effectScope();
    scope.run(() =>
      useChapterLayout(book, {
        epub,
        chapterIndex: ref(0),
        surface: ref(sizedSurface()),
        onError,
      }),
    );
    await nextTick();

    scope.stop();
    pending.reject(new Error('late failure'));
    await pending.promise.catch(() => {});
    await nextTick();

    expect(onError).not.toHaveBeenCalled();
  });

  it('useManuscriptLayout assigns nothing and skips restorePosition after the scope stops', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const pending = deferred<ChapterLayout[]>();
    const book = stubBook();
    vi.mocked(book.layoutManuscript).mockReturnValue(pending.promise);
    const restorePosition = vi.fn();
    const scope = effectScope();
    const state = scope.run(() =>
      useManuscriptLayout(book, {
        chapter: ref({ id: 'c1', title: 'T', body: 'B' }),
        surface: ref(sizedSurface()),
        restorePosition,
      }),
    );
    await nextTick();
    expect(book.layoutManuscript).toHaveBeenCalledTimes(1);

    scope.stop();
    pending.resolve([mockLayout()]);
    await pending.promise;
    await nextTick();

    expect(state?.layout.value).toBeNull();
    expect(restorePosition).not.toHaveBeenCalled();
  });
});
