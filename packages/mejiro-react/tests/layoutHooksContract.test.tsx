// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, ManuscriptChapter, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { useChapterLayout, useManuscriptLayout } from '../src/index.js';

const GEOMETRY = {
  pageWidth: 320,
  lineWidth: 400,
  paddingX: 0,
  paddingY: 0,
  pageHeight: 480,
  contentHeight: 400,
};

function setBox(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
}

/** Records every `ResizeObserver` created; `fire` delivers a callback to all of them. */
function stubResizeObserver(): { fire: () => void } {
  const callbacks: ResizeObserverCallback[] = [];
  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  return {
    fire: () => {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
    },
  };
}

const epub = {
  title: 'T',
  chapters: [{ title: 'A', paragraphs: [{ text: 'a', inlineAnnotations: [] }] }],
} as EpubBook;
const manuscript: ManuscriptChapter = { id: 'a', title: 'A', body: 'a' };

interface Case {
  name: string;
  setup(
    layout: () => Promise<ChapterLayout>,
    surface: { current: HTMLElement | null },
  ): { fit: Mock; render: () => ReturnType<typeof useChapterLayout> };
}

const cases: Case[] = [
  {
    name: 'useChapterLayout',
    setup(layout, surface) {
      const fit = vi.fn(() => GEOMETRY);
      const book = { fitPageSize: fit, layoutChapter: vi.fn(layout) } as unknown as MejiroBook;
      return {
        fit,
        render: () =>
          useChapterLayout(book, { epub, chapterIndex: 0, surface, resizeDebounceMs: 0 }),
      };
    },
  },
  {
    name: 'useManuscriptLayout',
    setup(layout, surface) {
      const fit = vi.fn(() => GEOMETRY);
      const book = {
        fitPageSize: fit,
        layoutManuscript: vi.fn(async () => [await layout()]),
      } as unknown as MejiroBook;
      return {
        fit,
        render: () =>
          useManuscriptLayout(book, { chapter: manuscript, surface, resizeDebounceMs: 0 }),
      };
    },
  },
];

const layoutStub = { pageCount: 2 } as unknown as ChapterLayout;

describe.each(cases)('$name takes its inputs as an options object', ({ setup }) => {
  let observers: ReturnType<typeof stubResizeObserver>;
  beforeEach(() => {
    observers = stubResizeObserver();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lays out against the surface it was given and reports the fitted size', async () => {
    const el = document.createElement('div');
    setBox(el, 640, 480);
    const { fit, render } = setup(async () => layoutStub, { current: el });
    const { result } = renderHook(render);

    await waitFor(() => expect(result.current.layout).toBe(layoutStub));
    expect(fit.mock.calls[0][0]).toBe(el);
    expect(result.current.pageWidth).toBe(GEOMETRY.pageWidth);
    expect(result.current.contentHeight).toBe(GEOMETRY.contentHeight);
  });

  it('exposes a failed layout as error, without onError, and clears it on success', async () => {
    const el = document.createElement('div');
    setBox(el, 640, 480);
    const failure = new Error('layout failed');
    let fail = true;
    const { render } = setup(
      async () => {
        if (fail) throw failure;
        return layoutStub;
      },
      { current: el },
    );
    const { result } = renderHook(render);

    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.layout).toBeNull();

    fail = false;
    await act(async () => {
      await result.current.recompute();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.layout).toBe(layoutStub);
  });

  it('does not measure a surface with no box until the observer reports a positive one', async () => {
    const el = document.createElement('div');
    setBox(el, 0, 0);
    const { fit, render } = setup(async () => layoutStub, { current: el });
    const { result } = renderHook(render);

    await act(async () => observers.fire());
    expect(fit).not.toHaveBeenCalled();
    expect(result.current.layout).toBeNull();
    expect(result.current.error).toBeNull();

    setBox(el, 640, 480);
    await act(async () => observers.fire());
    await waitFor(() => expect(result.current.layout).toBe(layoutStub));
    expect(fit).toHaveBeenCalledTimes(1);
  });
});

describe('layout hook signatures', () => {
  it('take the book plus an options object and share one recompute options type', () => {
    expectTypeErrors(
      `import type { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import {
  type ChapterLayoutRecomputeOptions,
  type UseChapterLayoutReturn,
  type UseManuscriptLayoutReturn,
  useChapterLayout,
  useManuscriptLayout,
} from '@libraz/mejiro-react';
import type { RecomputeOptions } from '@libraz/mejiro-react';
import type { ManuscriptRecomputeOptions } from '@libraz/mejiro-react';
import type { PageDimensions } from '@libraz/mejiro-react';
import type { ManuscriptPageDimensions } from '@libraz/mejiro-react';
declare const book: MejiroBook;
declare const epub: EpubBook;
const surface = { current: null as HTMLElement | null };
useChapterLayout(book, { epub, chapterIndex: 0, surface, resizeDebounceMs: 50 });
useManuscriptLayout(book, { chapter: null, surface, resizeDebounceMs: 50 });
useChapterLayout(book, epub, 0, surface);
useManuscriptLayout(book, null, surface);
useChapterLayout(book, { epub, chapterIndex: 0, surface, resizeDebounce: 50 });
export const opts: ChapterLayoutRecomputeOptions = { blank: false };
export const r1: Parameters<UseChapterLayoutReturn['recompute']>[0] = opts;
export const r2: Parameters<UseManuscriptLayoutReturn['recompute']>[0] = opts;
export const e1: Error | null = null as unknown as UseChapterLayoutReturn['error'];
export const e2: UseManuscriptLayoutReturn['error'] = null;`,
      {
        fails: [
          '{ RecomputeOptions }',
          '{ ManuscriptRecomputeOptions }',
          '{ PageDimensions }',
          '{ ManuscriptPageDimensions }',
          'useChapterLayout(book, epub, 0, surface)',
          'useManuscriptLayout(book, null, surface)',
          'resizeDebounce: 50 })',
        ],
      },
    );
  });
});
