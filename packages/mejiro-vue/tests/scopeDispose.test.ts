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
    computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
    layoutChapter: vi.fn(async () => null),
    layoutManuscript: vi.fn(async () => new Map()),
    getOptions: vi.fn(() => ({ fontSize: 16 })),
  } as unknown as MejiroBook;
}

function mockLayout(totalPages = 8): ChapterLayout {
  return {
    totalPages,
    getSpread: vi.fn((i: number) => ({ spreadIdx: i, totalPages }) as unknown as SpreadResult),
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
    const surface = ref<HTMLElement | null>(document.createElement('div'));
    const scope = effectScope();
    scope.run(() =>
      useChapterLayout(stubBook(), shallowRef<EpubBook | null>(null), ref(0), surface),
    );
    await nextTick();
    const before = disconnects.length;
    scope.stop();
    expect(disconnects.length).toBe(before + 1);
  });

  it('useManuscriptLayout disconnects its ResizeObserver when the scope stops', async () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const surface = ref<HTMLElement | null>(document.createElement('div'));
    const scope = effectScope();
    scope.run(() => useManuscriptLayout(stubBook(), ref(null), surface));
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
      useChapterLayout(stubBook(), shallowRef<EpubBook | null>(null), ref(0), ref(null)),
    );
    scope.stop();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    remove.mockRestore();
  });

  it('useSpread cancels a pending page turn when the scope stops', () => {
    vi.useFakeTimers();
    const layout = shallowRef<ChapterLayout | null>(mockLayout());
    const scope = effectScope();
    const spread = scope.run(() => useSpread(layout, { turnDuration: 100 }));
    spread?.goTo(1);
    scope.stop();
    vi.advanceTimersByTime(200);
    expect(spread?.spreadIdx.value).toBe(0);
  });
});
