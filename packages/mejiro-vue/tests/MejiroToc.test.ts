// @vitest-environment happy-dom

import type { EpubBook } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroShelf } from '../src/MejiroShelf.js';
import { MejiroToc } from '../src/MejiroToc.js';
import { fakeEpub } from './helpers/fixtures.js';

describe('MejiroToc and MejiroShelf (Vue)', () => {
  it('uses the i18n catalog for default TOC and shelf copy', () => {
    const epub = fakeEpub();
    epub.chapters[0] = { paragraphs: [{ text: 'untitled', inlineAnnotations: [] }] };
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: jaMessages }, () => [
            h(MejiroToc, { epub, showSearch: true }),
            h(MejiroShelf, { volumes: [{ id: 'a', label: 'Book A' }] }),
          ]);
      },
    });
    const { container } = render(Wrapped);
    expect(container.querySelector('.mejiro-toc-title')?.textContent).toBe(jaMessages.tocTitle);
    expect(container.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe(
      jaMessages.tocSearchPlaceholder,
    );
    expect(container.textContent).toContain('第1章');
    expect(container.querySelector('.mejiro-shelf-title')?.textContent).toBe(jaMessages.shelfTitle);
  });
});

describe('MejiroToc (Vue) — repeated sub-headings', () => {
  function withHeadings(...texts: string[]): EpubBook {
    const epub = fakeEpub();
    epub.chapters[0] = {
      title: 'C1',
      paragraphs: texts.map((text) => ({ text, inlineAnnotations: [], headingLevel: 2 })),
    };
    return epub;
  }

  it('renders every repeated sub-heading without a duplicate-key warning', async () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, rerender } = render(MejiroToc, { props: { epub: withHeadings('p', 'q') } });

    await rerender({ epub: withHeadings('＊', 'x', '＊') });

    expect(
      [...container.querySelectorAll('.mejiro-toc-subhead')].map((item) => item.textContent),
    ).toEqual(['＊', 'x', '＊']);
    expect(warnings.mock.calls.some((call) => String(call[0]).includes('Duplicate keys'))).toBe(
      false,
    );
    warnings.mockRestore();
  });
});
