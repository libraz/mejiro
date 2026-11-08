// @vitest-environment happy-dom

import type { ChapterLayout } from '@libraz/mejiro/book';
import { render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { MejiroPageView } from '../src/MejiroPageView.js';
import { pageResult } from './helpers/fixtures.js';

const layout = {
  typography: { fontFamily: 'serif', fontSize: 18, lineSpacing: 2 },
} as unknown as ChapterLayout;

describe('MejiroPageView (Vue) — layout defaults', () => {
  it('draws slot columns in the layout typography, explicit props winning', () => {
    const { container } = render(MejiroPageView, {
      props: { result: pageResult('本文'), layout, slotMode: true, lineSpacing: 1.5 },
    });

    const slots = container.querySelector<HTMLElement>('.mejiro-page-slots');
    const column = slots?.firstElementChild as HTMLElement | null;
    expect(slots?.style.fontFamily).toBe('serif');
    expect(column?.style.lineHeight).toBe('1.5');
  });
});
