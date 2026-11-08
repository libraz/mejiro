// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EpubBook } from '@libraz/mejiro/epub';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroChapterNav } from '../src/MejiroChapterNav.js';
import { fakeEpub } from './helpers/fixtures.js';

describe('MejiroChapterNav (React)', () => {
  it("renders a <select> with one option per chapter ('select' variant)", () => {
    const { container } = render(
      <MejiroChapterNav epub={fakeEpub()} chapterIndex={0} onChapterIndexChange={() => {}} />,
    );
    const options = container.querySelectorAll('select option');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toBe('C1');
    expect((options[0] as HTMLOptionElement).value).toBe('0');
  });

  it("calls onChapterIndexChange when the select changes ('select' variant)", () => {
    const onChapterIndexChange = vi.fn();
    const { container } = render(
      <MejiroChapterNav
        epub={fakeEpub()}
        chapterIndex={0}
        onChapterIndexChange={onChapterIndexChange}
      />,
    );
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '2' } });
    expect(onChapterIndexChange).toHaveBeenCalledWith(2);
  });

  it('keeps duplicate chapter titles individually selectable', () => {
    const epub = fakeEpub();
    epub.chapters = [
      { title: '同名', paragraphs: [] },
      { title: '同名', paragraphs: [] },
      { title: '同名', paragraphs: [] },
    ];
    const onChapterIndexChange = vi.fn();

    const { container } = render(
      <MejiroChapterNav epub={epub} chapterIndex={0} onChapterIndexChange={onChapterIndexChange} />,
    );
    const options = Array.from(container.querySelectorAll<HTMLOptionElement>('select option'));

    expect(options).toHaveLength(3);
    // Titles collide, so only the value distinguishes the chapters.
    expect(options.map((option) => option.value)).toEqual(['0', '1', '2']);

    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '2' } });
    expect(onChapterIndexChange).toHaveBeenCalledWith(2);
  });

  it("renders a list of chapter cards with the active card marked ('panel' variant)", () => {
    const { container } = render(
      <MejiroChapterNav
        epub={fakeEpub()}
        chapterIndex={1}
        onChapterIndexChange={() => {}}
        variant="panel"
      />,
    );
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    expect(cards).toHaveLength(3);
    expect(cards[1].classList.contains('is-active')).toBe(true);
    expect(cards[1].getAttribute('aria-current')).toBe('true');
    expect(cards[0].getAttribute('aria-current')).toBeNull();
  });

  it("calls onChapterIndexChange when a panel card is clicked ('panel' variant)", () => {
    const onChapterIndexChange = vi.fn();
    const { container } = render(
      <MejiroChapterNav
        epub={fakeEpub()}
        chapterIndex={0}
        onChapterIndexChange={onChapterIndexChange}
        variant="panel"
      />,
    );
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    (cards[2] as HTMLButtonElement).click();
    expect(onChapterIndexChange).toHaveBeenCalledWith(2);
  });

  it('uses the i18n catalog for fallback chapter labels and panel title', () => {
    const epub = fakeEpub();
    epub.chapters[0] = { paragraphs: [{ text: 'untitled', inlineAnnotations: [] }] };
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroChapterNav
          epub={epub}
          chapterIndex={0}
          onChapterIndexChange={() => {}}
          variant="panel"
        />
      </MejiroI18nProvider>,
    );
    expect(container.textContent).toContain(jaMessages.tocTitle);
    expect(container.textContent).toContain('第1章');
  });
});

describe('MejiroChapterNav (React) — identical chapters', () => {
  it('keeps one panel entry per chapter when chapters share title and text', () => {
    const twin = { title: '同題', paragraphs: [{ text: '同文', inlineAnnotations: [] }] };
    const epub: EpubBook = { title: 'B', author: '', chapters: [twin, { ...twin }, { ...twin }] };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container, rerender } = render(
        <MejiroChapterNav
          epub={epub}
          chapterIndex={0}
          onChapterIndexChange={vi.fn()}
          variant="panel"
        />,
      );
      rerender(
        <MejiroChapterNav
          epub={epub}
          chapterIndex={2}
          onChapterIndexChange={vi.fn()}
          variant="panel"
        />,
      );

      const items = container.querySelectorAll('.mejiro-reader-chapter-list-item');
      expect(items).toHaveLength(3);
      expect(items[2].querySelector('.is-active')).not.toBeNull();
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('MejiroChapterNav (React) — repeated sub-headings', () => {
  it('renders every repeated panel sub-heading without a duplicate-key warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const epub = fakeEpub();
    epub.chapters[0] = {
      title: 'C1',
      paragraphs: [
        { text: '＊', inlineAnnotations: [], headingLevel: 2 },
        { text: '＊', inlineAnnotations: [], headingLevel: 2 },
      ],
    };
    const { container } = render(
      <MejiroChapterNav
        epub={epub}
        chapterIndex={0}
        onChapterIndexChange={() => {}}
        variant="panel"
      />,
    );

    expect(container.querySelectorAll('.mejiro-reader-chapter-subheads > span')).toHaveLength(2);
    expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
  });
});
