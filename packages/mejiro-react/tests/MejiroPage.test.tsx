// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { RenderPage } from '@libraz/mejiro/render';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MejiroPage } from '../src/MejiroPage.js';

describe('MejiroPage (React)', () => {
  it('uses stable line-scoped keys for repeated ruby segments', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
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

    const { container } = render(<MejiroPage page={page} />);

    expect([...container.querySelectorAll('ruby')].map((el) => el.textContent)).toEqual([
      '漢かん',
      '字じ',
    ]);
    expect(
      consoleError.mock.calls.some((args) =>
        args.some((arg) => String(arg).includes('Encountered two children with the same key')),
      ),
    ).toBe(false);
    consoleError.mockRestore();
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

    const { container } = render(<MejiroPage page={page} />);

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

    const { container } = render(<MejiroPage page={page} />);

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.test');
    expect(anchor?.querySelector('ruby')?.textContent).toBe('漢字かんじ');
  });

  it('draws a ruby segment from its text and rubyText', () => {
    const page: RenderPage = {
      paragraphs: [{ lines: [{ segments: [{ type: 'ruby', text: '振', rubyText: 'ふ' }] }] }],
    };

    const { container } = render(<MejiroPage page={page} />);

    const ruby = container.querySelector('ruby');
    expect(ruby?.firstChild?.textContent).toBe('振');
    expect(ruby?.querySelector('rt')?.textContent).toBe('ふ');
  });
});
