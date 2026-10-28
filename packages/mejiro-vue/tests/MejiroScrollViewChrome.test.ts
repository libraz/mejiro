// @vitest-environment happy-dom

import type { EpubBook } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { MejiroReader } from '../src/MejiroReader.js';

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

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await vi.runAllTimersAsync();
    await nextTick();
  }
}

/** Page numbers printed in the scroll track, by page index ('' when hidden). */
function printedNumbers(container: Element): string[] {
  return Array.from(container.querySelectorAll('.mejiro-reader-scroll .mejiro-reader-page')).map(
    (page) => page.querySelector('.mejiro-reader-page-header-num')?.textContent ?? '',
  );
}

describe('MejiroReader (Vue) — scroll mode chrome', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('numbers every page by default', async () => {
    vi.useFakeTimers();
    const { container } = render(MejiroReader, { props: { epub: longEpub(), mode: 'scroll' } });
    await settle();
    const numbers = printedNumbers(container);
    expect(numbers.length).toBeGreaterThan(3);
    expect(numbers.slice(0, 4)).toEqual(['1', '2', '3', '4']);
  });

  it("pageNumbers='none' prints no page number", async () => {
    vi.useFakeTimers();
    const { container } = render(MejiroReader, {
      props: { epub: longEpub(), mode: 'scroll', pageNumbers: 'none' },
    });
    await settle();
    const numbers = printedNumbers(container);
    expect(numbers.length).toBeGreaterThan(3);
    expect(numbers.every((n) => n === '')).toBe(true);
  });

  it("pageNumbers='right' numbers only the even-index pages", async () => {
    vi.useFakeTimers();
    const { container } = render(MejiroReader, {
      props: { epub: longEpub(), mode: 'scroll', pageNumbers: 'right' },
    });
    await settle();
    expect(printedNumbers(container).slice(0, 4)).toEqual(['1', '', '3', '']);
  });

  it('renders the n / total indicator when enabled and omits it when disabled', async () => {
    vi.useFakeTimers();
    const on = render(MejiroReader, {
      props: { epub: longEpub(), mode: 'scroll', enablePageIndicator: true },
    });
    await settle();
    expect(on.container.querySelector('.mejiro-reader-page-indicator')?.textContent).toMatch(
      /^1 \/ \d+$/,
    );
    on.unmount();

    const off = render(MejiroReader, {
      props: { epub: longEpub(), mode: 'scroll', enablePageIndicator: false },
    });
    await settle();
    expect(off.container.querySelector('.mejiro-reader-page-indicator')).toBeNull();
  });
});
