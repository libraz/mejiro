// @vitest-environment happy-dom

import type { RenderPage } from '@libraz/mejiro/render';
import { render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { MejiroPage } from '../src/MejiroPage.js';

describe('MejiroPage (Vue)', () => {
  it('uses stable line-scoped keys for repeated ruby segments', () => {
    const page: RenderPage = {
      paragraphs: [
        {
          lines: [
            { segments: [{ type: 'ruby', text: '漢', rubyText: 'かん' }] },
            { segments: [{ type: 'ruby', text: '字', rubyText: 'じ' }] },
          ],
        },
      ],
    };

    const { container } = render(MejiroPage, { props: { page } });

    expect([...container.querySelectorAll('ruby')].map((el) => el.textContent)).toEqual([
      '漢かん',
      '字じ',
    ]);
  });

  it('renders unsafe links as text', () => {
    const page: RenderPage = {
      paragraphs: [
        {
          lines: [
            {
              segments: [{ type: 'link', text: 'unsafe', href: 'javascript:alert(1)' }],
            },
          ],
        },
      ],
    };

    const { container } = render(MejiroPage, { props: { page } });

    expect(container.textContent).toContain('unsafe');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders nested ruby inside links', () => {
    const page: RenderPage = {
      paragraphs: [
        {
          lines: [
            {
              segments: [
                {
                  type: 'link',
                  text: '漢字',
                  href: 'https://example.test',
                  children: [{ type: 'ruby', text: '漢字', rubyText: 'かんじ' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const { container } = render(MejiroPage, { props: { page } });

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.test');
    expect(anchor?.querySelector('ruby')?.textContent).toBe('漢字かんじ');
  });
});
