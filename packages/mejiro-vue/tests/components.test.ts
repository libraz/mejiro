// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AnchorRect,
  estimateReadingTime,
  type InChapterAnchor,
  type PageResult,
  type SpreadResult,
} from '@libraz/mejiro/book';
import type { EpubBook, EpubChapter } from '@libraz/mejiro/epub';
import type { RenderPage } from '@libraz/mejiro/render';
import { render } from '@testing-library/vue';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import type {
  MejiroChapterNavProps,
  MejiroDropZoneProps,
  MejiroEditorProps,
  MejiroImageOverlayProps,
  MejiroManuscriptEditorProps,
  MejiroPageIndicatorProps,
  MejiroPageProps,
  MejiroPageViewProps,
  MejiroReaderProps,
  MejiroReaderSettingsSlot,
  MejiroScrollViewProps,
  MejiroSelectionLayerProps,
  MejiroSettingsPanelProps,
  MejiroShelfProps,
  MejiroSpreadProps,
  MejiroStatsProps,
  MejiroTocProps,
} from '../src/index.js';
import { MejiroChapterNav } from '../src/MejiroChapterNav.js';
import { MejiroDropZone } from '../src/MejiroDropZone.js';
import { MejiroImageOverlay } from '../src/MejiroImageOverlay.js';
import { MejiroNotationHighlighter } from '../src/MejiroNotationHighlighter.js';
import { MejiroPage } from '../src/MejiroPage.js';
import { MejiroPageIndicator } from '../src/MejiroPageIndicator.js';
import { MejiroSelectionLayer } from '../src/MejiroSelectionLayer.js';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';
import { MejiroShelf } from '../src/MejiroShelf.js';
import { MejiroSpread } from '../src/MejiroSpread.js';
import { MejiroStats } from '../src/MejiroStats.js';
import { MejiroToc } from '../src/MejiroToc.js';

describe('Vue public component prop types', () => {
  it('exports prop types for every public component', () => {
    expectTypeOf<MejiroChapterNavProps>().toHaveProperty('epub');
    expectTypeOf<MejiroDropZoneProps>().toHaveProperty('accept');
    expectTypeOf<MejiroEditorProps>().toHaveProperty('epubUrl');
    expectTypeOf<MejiroImageOverlayProps>().toHaveProperty('rect');
    expectTypeOf<MejiroManuscriptEditorProps>().toHaveProperty('previewProps');
    expectTypeOf<MejiroPageProps>().toHaveProperty('page');
    expectTypeOf<MejiroPageIndicatorProps>().toHaveProperty('current');
    expectTypeOf<MejiroPageViewProps>().toHaveProperty('result');
    expectTypeOf<MejiroReaderProps>().toHaveProperty('epubUrl');
    expectTypeOf<MejiroReaderSettingsSlot>().toHaveProperty('settings');
    expectTypeOf<MejiroScrollViewProps>().toHaveProperty('layout');
    expectTypeOf<MejiroSelectionLayerProps>().toHaveProperty('rects');
    expectTypeOf<MejiroSettingsPanelProps>().toHaveProperty('settings');
    expectTypeOf<MejiroShelfProps>().toHaveProperty('volumes');
    expectTypeOf<MejiroSpreadProps>().toHaveProperty('spread');
    expectTypeOf<MejiroStatsProps>().toHaveProperty('chapter');
    expectTypeOf<MejiroTocProps>().toHaveProperty('epub');
  });
});

describe('MejiroNotationHighlighter (Vue)', () => {
  it('passes attrs and listeners through to the textarea', () => {
    const onFocus = vi.fn();
    const onInput = vi.fn();
    const { container } = render(MejiroNotationHighlighter, {
      props: { modelValue: '本文', textareaClass: 'inner' },
      attrs: {
        class: 'from-attrs',
        rows: 7,
        maxlength: 12,
        'aria-label': 'draft body',
        onFocus,
        onInput,
      },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    expect(textarea.classList.contains('inner')).toBe(true);
    expect(textarea.classList.contains('from-attrs')).toBe(true);
    expect(textarea.getAttribute('rows')).toBe('7');
    expect(textarea.maxLength).toBe(12);
    expect(textarea.getAttribute('aria-label')).toBe('draft body');

    textarea.dispatchEvent(new Event('focus', { bubbles: true }));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledTimes(1);
  });
});

describe('MejiroDropZone (Vue)', () => {
  it('emits file when a valid .epub is dropped', async () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, { attrs: { onFile } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    const dt = { files: [file] } as unknown as DataTransfer;

    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    root.dispatchEvent(event);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('book.epub');
  });

  it('rejects non-.epub files via the default validator', () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, { attrs: { onFile } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'notes.txt');
    const dt = { files: [file] } as unknown as DataTransfer;

    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    root.dispatchEvent(event);

    expect(onFile).not.toHaveBeenCalled();
  });

  it('honours a custom validateFile predicate', () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, {
      props: { validateFile: (f: File) => f.name.endsWith('.zip') },
      attrs: { onFile },
    });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.zip');
    const dt = { files: [file] } as unknown as DataTransfer;
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    root.dispatchEvent(event);

    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('exposes a focusable control as its root', () => {
    const { container } = render(MejiroDropZone, { attrs: { onFile: () => {} } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    expect(root.tagName).toBe('BUTTON');
    expect(root.getAttribute('type')).toBe('button');
    expect(root.tabIndex).toBe(0);
    root.focus();
    expect(document.activeElement).toBe(root);
  });

  it('opens a book from the keyboard via Enter and Space', () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, { attrs: { onFile } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    root.focus();

    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      root.dispatchEvent(event);
      // The native activation is cancelled so the picker opens exactly once.
      expect(event.defaultPrevented).toBe(true);
    }
    expect(openPicker).toHaveBeenCalledTimes(2);

    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('book.epub');
  });

  it('ignores other keys', () => {
    const { container } = render(MejiroDropZone, { attrs: { onFile: () => {} } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(openPicker).not.toHaveBeenCalled();
  });

  it('toggles is-dragover on dragover/dragleave', async () => {
    const { container } = render(MejiroDropZone, { attrs: { onFile: () => {} } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    root.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(root.classList.contains('is-dragover')).toBe(true);

    root.dispatchEvent(new Event('dragleave', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(root.classList.contains('is-dragover')).toBe(false);
  });

  it('uses the i18n catalog for default copy', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: jaMessages }, () =>
            h(MejiroDropZone, { onFile: () => {} }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
    expect(container.textContent).toContain(jaMessages.dropZoneHint);
  });

  it('merges partial provider message overrides', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: { dropZoneTitle: 'Custom drop' } }, () =>
            h(MejiroDropZone, { onFile: () => {} }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain('Custom drop');
    expect(container.textContent).toContain('epub files only');
  });

  it('supports provider locale without explicit message overrides', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { locale: 'ja' }, () => h(MejiroDropZone, { onFile: () => {} }));
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
    expect(container.textContent).toContain(jaMessages.dropZoneHint);
  });
});

function fakeEpub(): EpubBook {
  return {
    title: 'Book',
    author: 'A',
    chapters: [
      { title: 'C1', paragraphs: [{ text: 'a', inlineAnnotations: [] }] },
      { title: 'C2', paragraphs: [{ text: 'b', inlineAnnotations: [] }] },
      { title: 'C3', paragraphs: [{ text: 'c', inlineAnnotations: [] }] },
    ],
  };
}

describe('MejiroChapterNav (Vue)', () => {
  it("renders a <select> with one option per chapter ('select' variant)", () => {
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapter: 0 },
    });
    const options = container.querySelectorAll('select option');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toBe('C1');
    expect((options[0] as HTMLOptionElement).value).toBe('0');
  });

  it("emits update:chapter when the select changes ('select' variant)", async () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapter: 0 },
      attrs: { 'onUpdate:chapter': onUpdate },
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
      props: { epub, chapter: 0 },
      attrs: { 'onUpdate:chapter': onUpdate },
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
      props: { epub: fakeEpub(), chapter: 1, variant: 'panel' },
    });
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    expect(cards).toHaveLength(3);
    expect(cards[1].classList.contains('is-active')).toBe(true);
    expect(cards[1].getAttribute('aria-current')).toBe('true');
    expect(cards[0].getAttribute('aria-current')).toBeNull();
  });

  it("emits update:chapter when a panel card is clicked ('panel' variant)", () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapter: 0, variant: 'panel' },
      attrs: { 'onUpdate:chapter': onUpdate },
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
            h(MejiroChapterNav, { epub, chapter: 0, variant: 'panel' }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.tocTitle);
    expect(container.textContent).toContain('第1章');
  });
});

describe('MejiroToc and MejiroShelf (Vue)', () => {
  it('uses the i18n catalog for default TOC and shelf copy', () => {
    const epub = fakeEpub();
    epub.chapters[0] = { paragraphs: [{ text: 'untitled', inlineAnnotations: [] }] };
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: jaMessages }, () => [
            h(MejiroToc, { epub, searchable: true }),
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

describe('MejiroImageOverlay (Vue)', () => {
  it('uses the i18n catalog for default labels', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: jaMessages }, () =>
            h(MejiroImageOverlay, { rect: { x: 1, y: 2, w: 30, h: 40 } }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.imageButton);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      jaMessages.imageRemoveButton,
    );
  });
});

describe('MejiroSettingsPanel (Vue)', () => {
  const baseSettings = {
    fontFamily: 'serif',
    fontSize: 16,
    lineSpacing: 1.8,
    mode: 'strict' as const,
    enableHanging: true,
  };

  it('adds is-open when open=true', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
    });
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(true);
  });

  it('omits is-open when open=false', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: { open: false, settings: baseSettings },
    });
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(false);
  });

  it('emits update:settings with the merged value when font size changes', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
      attrs: { 'onUpdate:settings': onUpdate },
    });
    const sizeInput = container.querySelector(
      'input[type="number"]:not(.mejiro-reader-control--wide)',
    ) as HTMLInputElement;
    sizeInput.value = '20';
    sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenCalledWith({ ...baseSettings, fontSize: 20 });
  });

  it('clamps invalid numeric settings instead of emitting zero or NaN', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
      attrs: { 'onUpdate:settings': onUpdate },
    });

    const sizeInput = container.querySelector(
      'input[type="number"]:not(.mejiro-reader-control--wide)',
    ) as HTMLInputElement;
    sizeInput.value = '';
    sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: baseSettings.fontSize });
    sizeInput.value = '999';
    sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });

    const spacingInput = container.querySelector(
      '.mejiro-reader-control--wide',
    ) as HTMLInputElement;
    spacingInput.value = '0';
    spacingInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 1 });
    spacingInput.value = '4';
    spacingInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 3 });
  });

  it('clamps the size stepper buttons to the declared range', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: { ...baseSettings, fontSize: 96 } },
      attrs: { 'onUpdate:settings': onUpdate },
    });
    const buttons = container.querySelectorAll('.mejiro-reader-btn--icon');
    (buttons[0] as HTMLButtonElement).click();
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });
    (buttons[1] as HTMLButtonElement).click();
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });
  });

  it('reflects min/max font size on the size input', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings, minFontSize: 12, maxFontSize: 28 },
    });
    const sizeInput = container.querySelector(
      'input[type="number"]:not(.mejiro-reader-control--wide)',
    ) as HTMLInputElement;
    expect(sizeInput.min).toBe('12');
    expect(sizeInput.max).toBe('28');
  });

  it('emits update:settings for the kinsoku and hanging toggles', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
      attrs: { 'onUpdate:settings': onUpdate },
    });
    const selects = container.querySelectorAll('select');
    const kinsoku = selects[1] as HTMLSelectElement;
    kinsoku.value = 'loose';
    kinsoku.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, mode: 'loose' });

    const hanging = selects[2] as HTMLSelectElement;
    hanging.value = 'false';
    hanging.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, enableHanging: false });
  });

  it('shows the active font even when it is not in the `fonts` list (no blank select)', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: {
        open: true,
        settings: { ...baseSettings, fontFamily: '"Noto Serif JP", serif' },
        // host passes no matching choice
        fonts: [{ value: 'sans-serif', label: 'System Sans' }],
      },
    });
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    // The select resolves to the active family instead of rendering blank.
    expect(fontSelect.value).toBe('"Noto Serif JP", serif');
    const option = Array.from(fontSelect.options).find((o) => o.value === '"Noto Serif JP", serif');
    expect(option).toBeTruthy();
    // Prettified label: first family, quotes stripped.
    expect(option?.textContent).toBe('Noto Serif JP');
  });

  it('does not duplicate the active font when it is already in the `fonts` list', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: {
        open: true,
        settings: { ...baseSettings, fontFamily: 'serif' },
        fonts: [{ value: 'serif', label: 'System Serif' }],
      },
    });
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    expect(fontSelect.options.length).toBe(1);
    expect(fontSelect.value).toBe('serif');
  });
});

describe('MejiroPageIndicator (Vue)', () => {
  it('renders "current / total"', () => {
    const { container } = render(MejiroPageIndicator, { props: { current: 3, total: 12 } });
    expect(container.querySelector('.mejiro-reader-page-indicator')?.textContent).toBe('3 / 12');
  });
});

describe('MejiroPage (Vue)', () => {
  it('uses stable line-scoped keys for repeated ruby segments', () => {
    const page: RenderPage = {
      paragraphs: [
        {
          lines: [
            { segments: [{ type: 'ruby', base: '漢', rubyText: 'かん' }] },
            { segments: [{ type: 'ruby', base: '字', rubyText: 'じ' }] },
          ],
          isHeading: false,
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
          isHeading: false,
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
                  children: [{ type: 'ruby', base: '漢字', rubyText: 'かんじ' }],
                },
              ],
            },
          ],
          isHeading: false,
        },
      ],
    };

    const { container } = render(MejiroPage, { props: { page } });

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.test');
    expect(anchor?.querySelector('ruby')?.textContent).toBe('漢字かんじ');
  });
});

function pageResult(text: string): PageResult {
  return {
    page: {
      paragraphs: [
        {
          lines: [{ segments: [{ type: 'text', text }] }],
          isHeading: false,
        },
      ],
    },
    lines: [{ segments: [{ type: 'text', text }], fontSize: 16 }],
    slots: [{ xPos: 0, yStart: 0, height: 240 }],
    hasImages: false,
  };
}

describe('MejiroSpread (Vue)', () => {
  it('leaves image-free pages in normal mode when slotMode is not given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };

    const { container } = render(MejiroSpread, {
      props: { spread, pageWidth: 320, pageHeight: 460, contentHeight: 360 },
    });

    expect(container.querySelectorAll('.mejiro-page-slots')).toHaveLength(0);
    expect(container.querySelectorAll('.mejiro-reader-page-content.mejiro-page')).toHaveLength(2);
  });

  it('forces slot rendering on both pages when slotMode is given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };

    const { container } = render(MejiroSpread, {
      props: { spread, pageWidth: 320, pageHeight: 460, contentHeight: 360, slotMode: true },
    });

    expect(container.querySelectorAll('.mejiro-page-slots')).toHaveLength(2);
    expect(container.querySelector('.mejiro-reader-page-content.mejiro-page')).toBeNull();
    expect(container.querySelector('br')).toBeNull();
  });

  it('paints only the selection rectangles that belong to the rendered spread', async () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };
    const selectionRects = [
      selectionRect({ spreadIdx: 0 }),
      selectionRect({ spreadIdx: 3, y: 60 }),
    ];

    const { container, rerender } = render(MejiroSpread, {
      props: {
        spread,
        pageWidth: 320,
        pageHeight: 460,
        contentHeight: 360,
        spreadIdx: 3,
        selectionRects,
      },
    });

    const onSpread3 = [...container.querySelectorAll<HTMLElement>('.mejiro-selection-rect')];
    expect(onSpread3).toHaveLength(1);
    expect(onSpread3[0]?.style.top).toBe('60px');

    await rerender({ spreadIdx: 0 });

    const onSpread0 = [...container.querySelectorAll<HTMLElement>('.mejiro-selection-rect')];
    expect(onSpread0).toHaveLength(1);
    expect(onSpread0[0]?.style.top).toBe('20px');
  });

  it('still slot-renders a page that carries images without slotMode', () => {
    const withImages = { ...pageResult('右頁'), hasImages: true };
    const spread: SpreadResult = {
      right: withImages,
      left: pageResult('左頁'),
      totalPages: 2,
    };

    const { container } = render(MejiroSpread, {
      props: { spread, pageWidth: 320, pageHeight: 460, contentHeight: 360 },
    });

    expect(
      container.querySelectorAll('.mejiro-reader-page--right .mejiro-page-slots'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '.mejiro-reader-page--left .mejiro-reader-page-content.mejiro-page',
      ),
    ).toHaveLength(1);
  });

  it('keeps native text selection when only anchorAtCoord is given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };
    const anchorAtCoord = vi.fn(() => ({ paragraph: 0, charIndex: 0 }));

    const { container } = render(MejiroSpread, {
      props: { spread, pageWidth: 320, pageHeight: 460, contentHeight: 360, anchorAtCoord },
    });
    const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
    const setPointerCapture = vi.fn();
    spreadEl.setPointerCapture = setPointerCapture;
    const content = container.querySelector('.mejiro-reader-page-content') as HTMLElement;

    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it('drag-selects when anchorAtCoord and a selection-change handler are both given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };
    const anchors: InChapterAnchor[] = [
      { paragraph: 0, charIndex: 0 },
      { paragraph: 0, charIndex: 5 },
    ];
    let call = 0;
    const anchorAtCoord = vi.fn(() => anchors[Math.min(call++, anchors.length - 1)]);
    const onSelectionChange = vi.fn();

    const { container } = render(MejiroSpread, {
      props: {
        spread,
        pageWidth: 320,
        pageHeight: 460,
        contentHeight: 360,
        anchorAtCoord,
        onSelectionChange,
      },
    });
    const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
    spreadEl.setPointerCapture = vi.fn();
    spreadEl.hasPointerCapture = vi.fn(() => false);
    const content = container.querySelector('.mejiro-reader-page-content') as HTMLElement;

    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    content.dispatchEvent(down);
    content.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));

    expect(down.defaultPrevented).toBe(true);
    expect(spreadEl.setPointerCapture).toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenNthCalledWith(1, null);
    expect(onSelectionChange).toHaveBeenNthCalledWith(2, { start: anchors[0], end: anchors[1] });
  });

  it('prints each page number in its own running head and hides it when null', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };

    // A null pageNumber is how `pageNumbers="right"` suppresses the left folio.
    const { container } = render(MejiroSpread, {
      props: {
        spread,
        pageWidth: 320,
        pageHeight: 460,
        contentHeight: 360,
        rightHeader: { title: 'Book', pageNumber: 7 },
        leftHeader: { title: 'Chapter', pageNumber: null },
      },
    });

    const rightNum = container.querySelector(
      '.mejiro-reader-page--right .mejiro-reader-page-header-num',
    );
    const leftNum = container.querySelector(
      '.mejiro-reader-page--left .mejiro-reader-page-header-num',
    );
    expect(rightNum?.textContent).toBe('7');
    expect(leftNum?.textContent).toBe('');
  });
});

const readerCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../mejiro/src/render/mejiro-reader.css'),
  'utf8',
);

function selectionRect(overrides: Partial<AnchorRect & { color: string }> = {}): AnchorRect & {
  color?: string;
} {
  return {
    spreadIdx: 0,
    pageIdx: 0,
    side: 'right',
    x: 10,
    y: 20,
    width: 24,
    height: 18,
    ...overrides,
  };
}

describe('MejiroSelectionLayer (Vue)', () => {
  it('fills each rectangle with its own colour', () => {
    const { container } = render(MejiroSelectionLayer, {
      props: {
        side: 'right',
        rects: [
          selectionRect({ color: 'rgb(255, 255, 0)' }),
          selectionRect({ y: 60, color: 'rgb(0, 128, 255)' }),
        ],
      },
    });

    const rects = [...container.querySelectorAll<HTMLElement>('.mejiro-selection-rect')];
    expect(rects).toHaveLength(2);
    expect(getComputedStyle(rects[0] as HTMLElement).backgroundColor).toBe('rgb(255, 255, 0)');
    expect(getComputedStyle(rects[1] as HTMLElement).backgroundColor).toBe('rgb(0, 128, 255)');
  });

  it('leaves uncoloured rectangles to the shipped stylesheet rule', () => {
    const { container } = render(MejiroSelectionLayer, {
      props: { side: 'right', rects: [selectionRect()] },
    });

    const rect = container.querySelector<HTMLElement>('.mejiro-selection-rect');
    expect(rect?.style.backgroundColor).toBe('');
    // The auto-imported reader stylesheet is the only fill for such rectangles.
    expect(readerCss).toMatch(/\.mejiro-selection-rect\s*\{[^}]*background-color:/u);
    expect(readerCss).toContain('--mejiro-selection-bg');
  });
});

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
      props: { chapter, totalPages: 4, elapsedMs: 12.7 },
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
            { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
          ],
        },
      ],
    };
    const { container } = render(MejiroStats, { props: { chapter: withRuby, totalPages: 1 } });
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
    const cpm = 60;
    const { container } = render(MejiroStats, {
      props: { chapter, totalPages: 1, showReadingTime: true, cpm },
    });

    const text = container.querySelector('.mejiro-reader-stats')?.textContent ?? '';
    const charsBehindTheEstimate = (estimateReadingTime(chapter, { cpm }) / 60_000) * cpm;
    expect(charsBehindTheEstimate).toBe(3);
    expect(text).toContain(`${charsBehindTheEstimate}ch`);
  });

  it('includes the fontLabel when provided', () => {
    const chapter: EpubChapter = { title: 'C', paragraphs: [{ text: 'a', inlineAnnotations: [] }] };
    const { container } = render(MejiroStats, {
      props: { chapter, totalPages: 1, fontLabel: 'Noto Serif 16px' },
    });
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain(
      'Noto Serif 16px',
    );
  });
});
