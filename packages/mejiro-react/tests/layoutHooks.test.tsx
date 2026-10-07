// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { useManuscriptLayout } from '../src/useManuscriptLayout.js';

function mockLayout(): ChapterLayout {
  return { totalPages: 4, getSpread: vi.fn(), resize: vi.fn() } as unknown as ChapterLayout;
}

/** Gives `el` a client box, as layout would; the hooks re-flow only when it changes. */
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

interface HookOptions {
  onError?: (error: Error) => void;
  capturePosition?: () => null;
}

/** Both layout hooks behind one shape: `source` selects the content, `calls` counts layouts. */
interface LayoutHookCase {
  name: string;
  setup(
    impl: LayoutImpl,
    surface: { current: HTMLElement | null },
  ): {
    calls: Mock;
    render: (source: number, options: HookOptions) => ReturnType<typeof useChapterLayout>;
  };
}

const epub = {
  chapters: [
    { title: 'A', paragraphs: [] },
    { title: 'B', paragraphs: [] },
  ],
} as unknown as EpubBook;
const manuscripts: ManuscriptChapter[] = [
  { id: 'a', title: 'A', body: 'a' },
  { id: 'b', title: 'B', body: 'b' },
];

const cases: LayoutHookCase[] = [
  {
    name: 'useChapterLayout',
    setup(impl, surface) {
      const calls = vi.fn(impl);
      const book = {
        computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
        layoutChapter: calls,
      } as unknown as MejiroBook;
      return {
        calls,
        render: (source, options) =>
          useChapterLayout(book, epub, source, surface, { resizeDebounce: 0, ...options }),
      };
    },
  },
  {
    name: 'useManuscriptLayout',
    setup(impl, surface) {
      const calls = vi.fn(impl);
      const book = {
        computePageSize: vi.fn(() => ({ pageWidth: 320, pageHeight: 480, contentHeight: 400 })),
        layoutManuscript: vi.fn(async ({ chapters }: { chapters: ManuscriptChapter[] }) => {
          const layout = await calls();
          return new Map([[chapters[0].id ?? '', layout]]);
        }),
      } as unknown as MejiroBook;
      return {
        calls,
        render: (source, options) =>
          useManuscriptLayout(book, manuscripts[source], surface, {
            resizeDebounce: 0,
            ...options,
          }),
      };
    },
  },
];

/** Lets pending rejections reach the host's unhandled-rejection tracking. */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe.each(cases)('$name (React) — layout lifecycle', ({ setup }) => {
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

  function mount(impl: LayoutImpl, options: HookOptions = {}) {
    const el = document.createElement('div');
    setBox(el, 640, 480);
    const { calls, render } = setup(impl, { current: el });
    const hook = renderHook(({ source, opts }) => render(source, opts), {
      initialProps: { source: 0, opts: options },
    });
    return { el, calls, hook };
  }

  it('lays out once on mount, including the observer first callback on the same box', async () => {
    const { calls, hook } = mount(async () => mockLayout());
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());
    // A browser delivers an initial observation for the box already laid out.
    await act(async () => observers.fire());

    expect(calls).toHaveBeenCalledTimes(1);
    expect(observers.created).toHaveLength(1);
  });

  it('lays out once per source change and keeps the same observer', async () => {
    const { calls, hook } = mount(async () => mockLayout());
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());

    hook.rerender({ source: 1, opts: {} });
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());
    await act(async () => observers.fire());

    expect(calls).toHaveBeenCalledTimes(2);
    expect(observers.created).toHaveLength(1);
    expect(observers.created[0].disconnect).not.toHaveBeenCalled();
  });

  it('keeps the observer across a re-render with unchanged inputs', async () => {
    const { calls, hook } = mount(async () => mockLayout(), { capturePosition: () => null });
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());

    // Inline option callbacks change identity on every parent render.
    hook.rerender({ source: 0, opts: { capturePosition: () => null } });
    hook.rerender({ source: 0, opts: { capturePosition: () => null } });

    expect(observers.created).toHaveLength(1);
    expect(observers.created[0].disconnect).not.toHaveBeenCalled();
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('re-flows once when the observed box really changes', async () => {
    const { el, calls, hook } = mount(async () => mockLayout());
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());

    setBox(el, 800, 480);
    await act(async () => observers.fire());
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
  });

  it('reports a rejected layout through onError exactly once, with no unhandled rejection', async () => {
    const failure = new Error('layout failed');
    const onError = vi.fn();
    const { hook } = mount(async () => Promise.reject(failure), { onError });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await act(async () => observers.fire());
    await nextMacrotask();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(hook.result.current.layout).toBeNull();
    expect(unhandled).toEqual([]);

    // An awaited recompute settles; the failure goes to onError, not the caller.
    await act(async () => {
      await expect(hook.result.current.recompute()).resolves.toBeUndefined();
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('reports nothing for a layout superseded before it failed', async () => {
    let rejectFirst: (error: Error) => void = () => {};
    let call = 0;
    const onError = vi.fn();
    const { calls, hook } = mount(
      () =>
        call++ === 0
          ? new Promise<ChapterLayout>((_, reject) => {
              rejectFirst = reject;
            })
          : Promise.resolve(mockLayout()),
      { onError },
    );
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));

    hook.rerender({ source: 1, opts: { onError } });
    await waitFor(() => expect(hook.result.current.layout).not.toBeNull());
    await act(async () => rejectFirst(new Error('stale')));
    await nextMacrotask();

    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it('rejects an awaited recompute without onError and leaves no unhandled rejection', async () => {
    const failure = new Error('layout failed');
    const { calls, hook } = mount(async () => Promise.reject(failure));
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    await nextMacrotask();
    expect(unhandled).toEqual([]);

    await act(async () => {
      await expect(hook.result.current.recompute()).rejects.toBe(failure);
    });
  });
});
