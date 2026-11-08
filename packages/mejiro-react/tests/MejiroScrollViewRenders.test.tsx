// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout } from '@libraz/mejiro/book';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MejiroScrollView } from '../src/MejiroScrollView.js';
import { FAKE_LAYOUT_METRICS } from './helpers/fixtures.js';

const rendered = vi.hoisted(() => ({ pages: [] as number[] }));

vi.mock('../src/MejiroPageView.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mirrors the component export name.
  MejiroPageView: ({ result }: { result: { index: number } }) => {
    rendered.pages.push(result.index);
    return null;
  },
}));

function fakeLayout(pageCount: number): ChapterLayout {
  const pages = Array.from({ length: pageCount }, (_, index) => ({ index }));
  return {
    ...FAKE_LAYOUT_METRICS,
    pageCount,
    getPage: (i: number) => pages[i],
  } as unknown as ChapterLayout;
}

describe('MejiroScrollView (React) — re-renders', () => {
  it('re-renders only the pages whose inputs changed', () => {
    const layout = fakeLayout(4);
    const props = { layout, pageWidth: 100, pageHeight: 150, contentHeight: 120 };
    const { rerender } = render(<MejiroScrollView {...props} />);
    expect(rendered.pages.sort()).toEqual([0, 1, 2, 3]);

    // A new callback and scroll target touch no page input.
    rendered.pages.length = 0;
    rerender(<MejiroScrollView {...props} scrollToPage={2} onVisiblePageChange={() => {}} />);
    expect(rendered.pages).toEqual([]);

    // Selection rects for page 1 re-render that page alone.
    const rect = { pageIndex: 1, x: 0, y: 0, width: 1, height: 1 };
    rerender(<MejiroScrollView {...props} scrollToPage={2} selectionRects={[rect]} />);
    expect(rendered.pages).toEqual([1]);
  });
});
