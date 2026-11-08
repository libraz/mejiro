// @vitest-environment happy-dom

import { estimateReadingTime } from '@libraz/mejiro/book';
import type { EpubChapter } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { MejiroStats } from '../src/MejiroStats.js';

describe('MejiroStats (Vue)', () => {
  it('renders an empty span when chapter is null', () => {
    const { container } = render(MejiroStats, { props: { chapter: null } });
    const el = container.querySelector('.mejiro-reader-stats');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('');
  });

  it('renders character count, page count and elapsed time', () => {
    const chapter: EpubChapter = {
      title: 'C',
      paragraphs: [
        { text: 'あいうえ', inlineAnnotations: [] },
        { text: 'お', inlineAnnotations: [] },
      ],
    };
    const { container } = render(MejiroStats, {
      props: { chapter, pageCount: 4, elapsedMs: 12.7 },
    });
    const text = container.querySelector('.mejiro-reader-stats')?.textContent ?? '';
    expect(text).toContain('5ch');
    expect(text).toContain('4pp');
    expect(text).toContain('13ms');
  });

  it('includes ruby count only when annotations are present', () => {
    const withRuby: EpubChapter = {
      title: 'C',
      paragraphs: [
        {
          text: '漢字',
          inlineAnnotations: [
            { type: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', rubyType: 'group' },
          ],
        },
      ],
    };
    const { container } = render(MejiroStats, { props: { chapter: withRuby, pageCount: 1 } });
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('1ruby');
  });

  it('counts characters over the same population as the reading-time estimate', () => {
    const chapter: EpubChapter = {
      title: 'C',
      paragraphs: [
        { text: '見出し', headingLevel: 1, inlineAnnotations: [] },
        { text: '𠮷野家', inlineAnnotations: [] },
      ],
    };
    const charsPerMinute = 60;
    const { container } = render(MejiroStats, {
      props: { chapter, pageCount: 1, showReadingTime: true, charsPerMinute },
    });

    const text = container.querySelector('.mejiro-reader-stats')?.textContent ?? '';
    const charsBehindTheEstimate =
      (estimateReadingTime(chapter, { charsPerMinute }) / 60_000) * charsPerMinute;
    expect(charsBehindTheEstimate).toBe(3);
    expect(text).toContain(`${charsBehindTheEstimate}ch`);
  });

  it('includes the fontLabel when provided', () => {
    const chapter: EpubChapter = { title: 'C', paragraphs: [{ text: 'a', inlineAnnotations: [] }] };
    const { container } = render(MejiroStats, {
      props: { chapter, pageCount: 1, fontLabel: 'Noto Serif 16px' },
    });
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain(
      'Noto Serif 16px',
    );
  });
});
