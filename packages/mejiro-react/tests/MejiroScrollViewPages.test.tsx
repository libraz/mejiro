// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, PageResult } from '@libraz/mejiro/book';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MejiroScrollView } from '../src/MejiroScrollView.js';

// The Vue suite (MejiroScrollView.test.ts) drives the identical scenarios.

/** Minimal stand-in for a real `IntersectionObserver`, driven manually by the tests. */
interface ObserverStub {
  callback: IntersectionObserverCallback;
  targets: Element[];
  disconnected: boolean;
}

/** Replaces the global `IntersectionObserver` and collects every instance created. */
function installIntersectionObserver(): ObserverStub[] {
  const created: ObserverStub[] = [];
  class Stub {
    targets: Element[] = [];
    disconnected = false;
    callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      created.push(this as unknown as ObserverStub);
    }
    observe(el: Element): void {
      this.targets.push(el);
    }
    unobserve(): void {}
    disconnect(): void {
      this.disconnected = true;
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', Stub);
  return created;
}

/** Gives every page element a distinct `offsetTop` (page i at i * 100). Returns a restore function. */
function stubPageOffsets(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const idx = Number(this.dataset.pageIdx);
      return Number.isNaN(idx) ? 0 : idx * 100;
    },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetTop', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetTop');
  };
}

/** Feeds one intersection entry to the observer, as the browser would on scroll. */
function intersect(observer: ObserverStub, target: Element, ratio: number): void {
  act(() => {
    observer.callback(
      [
        {
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as unknown as IntersectionObserverEntry,
      ],
      observer as unknown as IntersectionObserver,
    );
  });
}

function pageResult(text: string): PageResult {
  return {
    page: {
      paragraphs: [
        {
          lines: [{ segments: [{ type: 'text', text }] }],
          isHeading: false,
        },
      ],
    },
    lines: [{ segments: [{ type: 'text', text }], fontSize: 16 }],
    slots: [{ xPos: 0, yStart: 0, height: 240 }],
    hasImages: false,
  } as unknown as PageResult;
}

function fakeScrollLayout(totalPages: number): ChapterLayout {
  return {
    totalPages,
    getPage: (index: number) => pageResult(`頁${index + 1}`),
  } as unknown as ChapterLayout;
}

const geometry = { pageWidth: 320, pageHeight: 460, contentHeight: 360 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MejiroScrollView (React) — page observation', () => {
  it('forwards the most visible page to onVisiblePageChange as a user scroll', () => {
    const observers = installIntersectionObserver();
    const onVisiblePageChange = vi.fn();
    const { container } = render(
      <MejiroScrollView
        layout={fakeScrollLayout(2)}
        {...geometry}
        onVisiblePageChange={onVisiblePageChange}
      />,
    );
    const pages = container.querySelectorAll('.mejiro-reader-page');
    intersect(observers[0], pages[1], 0.8);

    expect(onVisiblePageChange).toHaveBeenCalledWith(1, 'user');
  });

  it('re-observes the page elements after a reflow changes the page count', () => {
    const observers = installIntersectionObserver();
    const onVisiblePageChange = vi.fn();
    const { container, rerender } = render(
      <MejiroScrollView
        layout={fakeScrollLayout(2)}
        {...geometry}
        onVisiblePageChange={onVisiblePageChange}
      />,
    );
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toHaveLength(2);

    rerender(
      <MejiroScrollView
        layout={fakeScrollLayout(3)}
        {...geometry}
        onVisiblePageChange={onVisiblePageChange}
      />,
    );

    expect(observers[0].disconnected).toBe(true);
    expect(observers).toHaveLength(2);
    expect(observers[1].targets).toHaveLength(3);

    const pages = container.querySelectorAll('.mejiro-reader-page');
    expect(pages).toHaveLength(3);
    intersect(observers[1], pages[2], 0.9);

    expect(onVisiblePageChange).toHaveBeenLastCalledWith(2, 'user');
  });
});

describe('MejiroScrollView (React) — scrollToPage', () => {
  it('scrolls to the requested page on the first paint after mount', () => {
    installIntersectionObserver();
    const restoreOffsets = stubPageOffsets();
    try {
      const { container } = render(
        <MejiroScrollView layout={fakeScrollLayout(12)} {...geometry} scrollToPage={10} />,
      );

      const scroller = container.querySelector('.mejiro-reader-scroll') as HTMLElement;
      const target = container.querySelectorAll<HTMLElement>('.mejiro-reader-page')[10];
      expect(scroller.scrollTop).toBe(target.offsetTop);
      expect(scroller.scrollTop).toBe(1000);
    } finally {
      restoreOffsets();
    }
  });

  it('follows later scrollToPage changes', () => {
    installIntersectionObserver();
    const restoreOffsets = stubPageOffsets();
    try {
      const layout = fakeScrollLayout(12);
      const { container, rerender } = render(
        <MejiroScrollView layout={layout} {...geometry} scrollToPage={0} />,
      );

      rerender(<MejiroScrollView layout={layout} {...geometry} scrollToPage={4} />);

      const scroller = container.querySelector('.mejiro-reader-scroll') as HTMLElement;
      expect(scroller.scrollTop).toBe(400);
    } finally {
      restoreOffsets();
    }
  });

  it('reports the scroll it performed itself as programmatic, later ones as user', async () => {
    const observers = installIntersectionObserver();
    const restoreOffsets = stubPageOffsets();
    try {
      const onVisiblePageChange = vi.fn();
      const layout = fakeScrollLayout(12);
      const { container, rerender } = render(
        <MejiroScrollView
          layout={layout}
          {...geometry}
          scrollToPage={0}
          onVisiblePageChange={onVisiblePageChange}
        />,
      );
      const pages = container.querySelectorAll('.mejiro-reader-page');

      rerender(
        <MejiroScrollView
          layout={layout}
          {...geometry}
          scrollToPage={6}
          onVisiblePageChange={onVisiblePageChange}
        />,
      );
      intersect(observers[0], pages[6], 0.9);

      expect(onVisiblePageChange).toHaveBeenLastCalledWith(6, 'programmatic');

      // The programmatic window closes once the task queue drains.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      intersect(observers[0], pages[7], 0.95);

      expect(onVisiblePageChange).toHaveBeenLastCalledWith(7, 'user');
    } finally {
      restoreOffsets();
    }
  });
});
