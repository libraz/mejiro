// @vitest-environment happy-dom

import type { ChapterLayout } from '@libraz/mejiro/book';
import { render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroScrollView } from '../src/MejiroScrollView.js';
import { pageResult } from './helpers/fixtures.js';

/** Two-page layout stub carrying the geometry and typography it was measured with. */
const layout = {
  pageCount: 2,
  getPage: (i: number) => pageResult(`p${i}`),
  geometry: {
    pageWidth: 300,
    lineWidth: 400,
    paddingX: 10,
    paddingY: 20,
    pageHeight: 440,
    contentHeight: 400,
  },
  typography: { fontFamily: 'serif', fontSize: 18, lineSpacing: 2 },
} as unknown as ChapterLayout;

describe('MejiroScrollView (Vue) — layout defaults', () => {
  it('sizes every page from the layout geometry, explicit props winning', () => {
    const { container } = render(MejiroScrollView, { props: { layout, pageHeight: 500 } });

    const pages = container.querySelectorAll<HTMLElement>('.mejiro-reader-page');
    const content = container.querySelector<HTMLElement>('.mejiro-reader-page-content');
    expect(pages).toHaveLength(2);
    expect(pages[0].style.width).toBe('300px');
    expect(pages[0].style.height).toBe('500px');
    expect(content?.style.height).toBe('400px');
    expect(content?.style.fontSize).toBe('18px');
    expect(content?.style.lineHeight).toBe('2');
  });

  it('places the overlays of the spread at spreadIndex', () => {
    const { container } = render(MejiroScrollView, {
      props: {
        layout,
        spreadIndex: 0,
        images: [{ id: 'img', rect: { x: 10, y: 10, width: 40, height: 50 } }],
      },
    });
    expect(container.querySelectorAll('.mejiro-reader-image-overlay')).toHaveLength(1);
  });

  it('reports the visible page through update:visiblePage and takes index-named props', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import type { MejiroScrollViewProps } from '@libraz/mejiro-vue';
declare const layout: ChapterLayout;
const ok: MejiroScrollViewProps = { layout, spreadIndex: 0, 'onUpdate:visiblePage': (pageIndex: number, source: 'user' | 'programmatic') => void [pageIndex, source] };
void ok;
const p1: MejiroScrollViewProps = { layout, spreadIdx: 0 };
const p2: MejiroScrollViewProps = { layout, onVisiblePageChange: () => {} };`,
      { fails: ['const p1', 'const p2'] },
    );
  });
});
