// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroShelf } from '../src/MejiroShelf.js';
import { MejiroToc } from '../src/MejiroToc.js';
import { fakeEpub } from './helpers/fixtures.js';

describe('MejiroToc and MejiroShelf (React)', () => {
  it('uses the i18n catalog for default TOC and shelf copy', () => {
    const epub = fakeEpub();
    epub.chapters[0] = { paragraphs: [{ text: 'untitled', inlineAnnotations: [] }] };
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroToc epub={epub} showSearch />
        <MejiroShelf volumes={[{ id: 'a', label: 'Book A' }]} />
      </MejiroI18nProvider>,
    );

    expect(container.querySelector('.mejiro-toc-title')?.textContent).toBe(jaMessages.tocTitle);
    expect(container.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe(
      jaMessages.tocSearchPlaceholder,
    );
    expect(container.textContent).toContain('第1章');
    expect(container.querySelector('.mejiro-shelf-title')?.textContent).toBe(jaMessages.shelfTitle);
  });
});

describe('MejiroToc (React) — repeated sub-headings', () => {
  it('renders every repeated sub-heading without a duplicate-key warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const epub = fakeEpub();
    epub.chapters[0] = {
      title: 'C1',
      paragraphs: [
        { text: '＊', inlineAnnotations: [], headingLevel: 2 },
        { text: 'body', inlineAnnotations: [] },
        { text: '＊', inlineAnnotations: [], headingLevel: 2 },
      ],
    };
    const { container } = render(<MejiroToc epub={epub} showSearch />);
    fireEvent.change(container.querySelector('input[type="search"]') as HTMLInputElement, {
      target: { value: 'C1' },
    });

    expect(container.querySelectorAll('.mejiro-toc-subhead')).toHaveLength(2);
    expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
  });
});

describe('MejiroToc (React) — search and selection', () => {
  it('shows the search input only with showSearch', () => {
    const { container, rerender } = render(<MejiroToc epub={fakeEpub()} />);
    expect(container.querySelector('input[type="search"]')).toBeNull();

    rerender(<MejiroToc epub={fakeEpub()} showSearch />);
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
  });

  it('reports the picked chapter index through onChapterSelect and highlights the anchor chapter', () => {
    const onChapterSelect = vi.fn();
    const { container } = render(
      <MejiroToc
        epub={fakeEpub()}
        currentAnchor={{ chapterIndex: 1, paragraphIndex: 0, charIndex: 0 }}
        onChapterSelect={onChapterSelect}
      />,
    );
    const links = container.querySelectorAll<HTMLButtonElement>('.mejiro-toc-link');
    expect(links[1].getAttribute('aria-current')).toBe('true');

    fireEvent.click(links[2]);
    expect(onChapterSelect).toHaveBeenCalledExactlyOnceWith(2);
  });
});
