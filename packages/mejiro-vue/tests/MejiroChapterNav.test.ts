// @vitest-environment happy-dom

import type { EpubBook } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroChapterNav } from '../src/MejiroChapterNav.js';
import { fakeEpub } from './helpers/fixtures.js';

describe('MejiroChapterNav (Vue) — identical chapters', () => {
  it('keeps one panel entry per chapter when chapters share title and text', async () => {
    const twin = { title: '同題', paragraphs: [{ text: '同文', inlineAnnotations: [] }] };
    const epub: EpubBook = { title: 'B', author: '', chapters: [twin, { ...twin }, { ...twin }] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { container, rerender } = render(MejiroChapterNav, {
        props: { epub, chapterIndex: 0, variant: 'panel' },
      });
      await rerender({ epub, chapterIndex: 2, variant: 'panel' });

      const items = container.querySelectorAll('.mejiro-reader-chapter-list-item');
      expect(items).toHaveLength(3);
      expect(items[2].querySelector('.is-active')).not.toBeNull();
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Duplicate keys/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('MejiroChapterNav (Vue)', () => {
  it("renders a <select> with one option per chapter ('select' variant)", () => {
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapterIndex: 0 },
    });
    const options = container.querySelectorAll('select option');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toBe('C1');
    expect((options[0] as HTMLOptionElement).value).toBe('0');
  });

  it("emits update:chapterIndex when the select changes ('select' variant)", async () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapterIndex: 0 },
      attrs: { 'onUpdate:chapterIndex': onUpdate },
    });
    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenCalledWith(2);
  });

  it('keeps duplicate chapter titles individually selectable', () => {
    const epub = fakeEpub();
    epub.chapters = [
      { title: '同名', paragraphs: [] },
      { title: '同名', paragraphs: [] },
      { title: '同名', paragraphs: [] },
    ];
    const onUpdate = vi.fn();

    const { container } = render(MejiroChapterNav, {
      props: { epub, chapterIndex: 0 },
      attrs: { 'onUpdate:chapterIndex': onUpdate },
    });
    const options = Array.from(container.querySelectorAll<HTMLOptionElement>('select option'));

    expect(options).toHaveLength(3);
    // Titles collide, so only the value distinguishes the chapters.
    expect(options.map((option) => option.value)).toEqual(['0', '1', '2']);

    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenCalledWith(2);
  });

  it("renders a list of chapter cards with the active card marked ('panel' variant)", () => {
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapterIndex: 1, variant: 'panel' },
    });
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    expect(cards).toHaveLength(3);
    expect(cards[1].classList.contains('is-active')).toBe(true);
    expect(cards[1].getAttribute('aria-current')).toBe('true');
    expect(cards[0].getAttribute('aria-current')).toBeNull();
  });

  it("emits update:chapterIndex when a panel card is clicked ('panel' variant)", () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapterIndex: 0, variant: 'panel' },
      attrs: { 'onUpdate:chapterIndex': onUpdate },
    });
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    (cards[2] as HTMLButtonElement).click();
    expect(onUpdate).toHaveBeenCalledWith(2);
  });

  it('uses the i18n catalog for fallback chapter labels and panel title', () => {
    const epub = fakeEpub();
    epub.chapters[0] = { paragraphs: [{ text: 'untitled', inlineAnnotations: [] }] };
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: jaMessages }, () =>
            h(MejiroChapterNav, { epub, chapterIndex: 0, variant: 'panel' }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.tocTitle);
    expect(container.textContent).toContain('第1章');
  });
});
