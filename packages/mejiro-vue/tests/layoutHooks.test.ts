// @vitest-environment happy-dom

import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { defineComponent, h, nextTick, type Ref, ref, shallowRef } from 'vue';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';

function mockLayout(): ChapterLayout {
  return { totalPages: 4, getSpread: vi.fn(), resize: vi.fn() } as unknown as ChapterLayout;
}

/** Gives `el` a client box, as layout would; the composables re-flow only when it changes. */
function setBox(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
}

interface ObserverStub {
  callback: ResizeObserverCallback;
  disconnect: Mock;
}

/** Records every `ResizeObserver` created; `fire` delivers a callback to the live ones. */
function stubResizeObserver(): { created: ObserverStub[]; fire: () => void } {
  const created: ObserverStub[] = [];
  class MockResizeObserver {
    readonly stub: ObserverStub;
    constructor(callback: ResizeObserverCallback) {
      this.stub = { callback, disconnect: vi.fn() };
      created.push(this.stub);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      this.stub.disconnect();
    }
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  return {
    created,
    fire: () => {
      for (const stub of created) {
        if (stub.disconnect.mock.calls.length === 0) stub.callback([], {} as ResizeObserver);
      }
    },
  };
}

type LayoutImpl = () => Promise<ChapterLayout>;

interface LayoutCtx {
  layout: Ref<ChapterLayout | null>;
  recompute: () => Promise<void>;
}

/** Both layout composables behind one shape: `source` selects the content, `calls` counts layouts. */
interface LayoutHookCase {
  name: string;
  setup(
    impl: LayoutImpl,
    surface: Ref<HTMLElement | null>,
    source: Ref<number>,
    onError?: (error: Error) => void,
  ): { calls: Mock; use: () => LayoutCtx };
}

const epub = shallowRef({
  chapters: [
    { title: 'A', paragraphs: [] },
    { title: 'B', paragraphs: [] },
  ],
} as unknown as EpubBook);
const manuscripts: ManuscriptChapter[] = [
  { id: 'a', title: 'A', body: 'a' },
  { id: 'b', title: 'B', body: 'b' },
];

const cases: LayoutHookCase[] = [
  {
    name: 'useChapterLayout',
    setup(impl, surface, source, onError) {
      const calls = vi.fn(impl);
      const book = {
        computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
        layoutChapter: calls,
      } as unknown as MejiroBook;
      return {
        calls,
        use: () => useChapterLayout(book, epub, source, surface, { resizeDebounce: 0, onError }),
      };
    },
  },
  {
    name: 'useManuscriptLayout',
    setup(impl, surface, source, onError) {
      const calls = vi.fn(impl);
      const book = {
        computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
        layoutManuscript: vi.fn(async ({ chapters }: { chapters: ManuscriptChapter[] }) => {
          const layout = await calls();
          return new Map([[chapters[0].id ?? '', layout]]);
        }),
      } as unknown as MejiroBook;
      const chapter = shallowRef<ManuscriptChapter | null>(manuscripts[source.value]);
      return {
        calls,
        use: () => {
          // Follow `source` the way a draft store would hand over another chapter.
          const ctx = useManuscriptLayout(book, chapter, surface, { resizeDebounce: 0, onError });
          return {
            ...ctx,
            select: (i: number) => {
              chapter.value = manuscripts[i];
            },
          };
        },
      };
    },
  },
];

/** Lets the sync source watch, the async layout and its commit settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await nextTick();
}

/** Lets pending rejections reach the host's unhandled-rejection tracking. */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe.each(cases)('$name (Vue) — layout lifecycle', ({ name, setup }) => {
  let observers: ReturnType<typeof stubResizeObserver>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    observers = stubResizeObserver();
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.unstubAllGlobals();
  });

  function mountHook(impl: LayoutImpl, onError?: (error: Error) => void) {
    const el = document.createElement('div');
    setBox(el, 640, 480);
    // The template ref is filled on mount, after setup ran with it empty.
    const surface = ref<HTMLElement | null>(null);
    const source = ref(0);
    const { calls, use } = setup(impl, surface, source, onError);
    const result = {
      current: undefined as unknown as LayoutCtx & { select?: (i: number) => void },
    };
    mount(
      defineComponent({
        setup() {
          result.current = use();
          return () => h('div');
        },
      }),
    );
    surface.value = el;
    /** Switches to the other content. */
    const select = (i: number) => {
      if (name === 'useChapterLayout') source.value = i;
      else result.current.select?.(i);
    };
    return { el, calls, result, select };
  }

  it('lays out once on mount, including the observer first callback on the same box', async () => {
    const { calls, result } = mountHook(async () => mockLayout());
    await flush();
    expect(result.current.layout.value).not.toBeNull();
    observers.fire();
    await flush();

    expect(calls).toHaveBeenCalledTimes(1);
    expect(observers.created).toHaveLength(1);
  });

  it('lays out once per source change and keeps the same observer', async () => {
    const { calls, result, select } = mountHook(async () => mockLayout());
    await flush();

    select(1);
    await flush();
    observers.fire();
    await flush();

    expect(result.current.layout.value).not.toBeNull();
    expect(calls).toHaveBeenCalledTimes(2);
    expect(observers.created).toHaveLength(1);
    expect(observers.created[0].disconnect).not.toHaveBeenCalled();
  });

  it('re-flows once when the observed box really changes', async () => {
    const { el, calls } = mountHook(async () => mockLayout());
    await flush();

    setBox(el, 800, 480);
    observers.fire();
    await flush();
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('reports a rejected layout through onError exactly once, with no unhandled rejection', async () => {
    const failure = new Error('layout failed');
    const onError = vi.fn();
    const { result } = mountHook(async () => Promise.reject(failure), onError);
    await flush();
    observers.fire();
    await flush();
    await nextMacrotask();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.layout.value).toBeNull();
    expect(unhandled).toEqual([]);

    // An awaited recompute settles; the failure goes to onError, not the caller.
    await expect(result.current.recompute()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('reports nothing for a layout superseded before it failed', async () => {
    let rejectFirst: (error: Error) => void = () => {};
    let call = 0;
    const onError = vi.fn();
    const { calls, result, select } = mountHook(
      () =>
        call++ === 0
          ? new Promise<ChapterLayout>((_, reject) => {
              rejectFirst = reject;
            })
          : Promise.resolve(mockLayout()),
      onError,
    );
    await flush();
    expect(calls).toHaveBeenCalledTimes(1);

    select(1);
    await flush();
    expect(result.current.layout.value).not.toBeNull();
    rejectFirst(new Error('stale'));
    await flush();
    await nextMacrotask();

    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it('rejects an awaited recompute without onError and leaves no unhandled rejection', async () => {
    const failure = new Error('layout failed');
    const { calls, result } = mountHook(async () => Promise.reject(failure));
    await flush();
    await nextMacrotask();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);

    await expect(result.current.recompute()).rejects.toBe(failure);
  });
});
