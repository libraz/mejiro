// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EpubBook } from '@libraz/mejiro/epub';
import { act, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MejiroReader, type MejiroReaderHandle } from '../src/MejiroReader.js';

/** Minimal stand-in for a real `IntersectionObserver`, driven manually by the tests. */
interface ObserverStub {
  callback: IntersectionObserverCallback;
  disconnected: boolean;
}

/** Replaces the global `IntersectionObserver` and collects every instance created. */
function installIntersectionObserver(): ObserverStub[] {
  const created: ObserverStub[] = [];
  class Stub {
    disconnected = false;
    callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      created.push(this as unknown as ObserverStub);
    }
    observe(): void {}
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

function longEpub(): EpubBook {
  return {
    title: 'Long Book',
    author: 'Author',
    chapters: [
      {
        title: 'Long Chapter',
        paragraphs: Array.from({ length: 80 }, (_, i) => ({
          text: `段落${i}。`.repeat(80),
          inlineAnnotations: [],
        })),
      },
    ],
  };
}

async function settle(step?: () => void): Promise<void> {
  await act(async () => {
    step?.();
    await vi.runAllTimersAsync();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The Vue suite (MejiroScrollView.test.ts) drives the identical scenarios.
describe('MejiroReader (React) — scroll mode page wiring', () => {
  it('paints annotations and the image overlay on the visible page', async () => {
    vi.useFakeTimers();
    installIntersectionObserver();
    const { container } = render(
      <MejiroReader
        epub={longEpub()}
        mode="scroll"
        enableImageOverlay
        annotations={[
          {
            chapter: 0,
            start: { paragraph: 0, charIndex: 0 },
            end: { paragraph: 0, charIndex: 8 },
            color: 'rgb(255, 235, 59)',
          },
        ]}
      />,
    );
    await settle();
    const imageButton = Array.from(container.querySelectorAll('.mejiro-reader-btn')).find((b) =>
      b.textContent?.includes('Image'),
    ) as HTMLButtonElement;
    await settle(() => fireEvent.click(imageButton));

    const first = container.querySelector('.mejiro-reader-scroll [data-page-idx="0"]');
    const rects = Array.from(first?.querySelectorAll<HTMLElement>('.mejiro-selection-rect') ?? []);
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) expect(rect.style.backgroundColor).toBe('rgb(255, 235, 59)');
    expect(first?.querySelectorAll('.mejiro-reader-image-overlay')).toHaveLength(1);
    expect(container.querySelectorAll('.mejiro-reader-image-overlay')).toHaveLength(1);
  });

  it('leaves a user scroll onto an odd page where the user put it', async () => {
    vi.useFakeTimers();
    const observers = installIntersectionObserver();
    const restoreOffsets = stubPageOffsets();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const { container } = render(<MejiroReader ref={ref} epub={longEpub()} mode="scroll" />);
      await settle();
      const scroller = container.querySelector('.mejiro-reader-scroll') as HTMLElement;
      const page3 = container.querySelector('.mejiro-reader-scroll [data-page-idx="3"]') as Element;

      scroller.scrollTop = 330;
      await settle(() => {
        observers[observers.length - 1].callback(
          [
            {
              target: page3,
              isIntersecting: true,
              intersectionRatio: 0.9,
            } as unknown as IntersectionObserverEntry,
          ],
          observers[observers.length - 1] as unknown as IntersectionObserver,
        );
      });

      expect(ref.current?.getReadingPosition().spreadIdx).toBe(1);
      expect(scroller.scrollTop).toBe(330);

      // A programmatic turn still scrolls to its spread.
      await settle(() => ref.current?.goToSpread(3));
      expect(scroller.scrollTop).toBe(600);
    } finally {
      restoreOffsets();
    }
  });
});
