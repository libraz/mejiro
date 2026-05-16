// @vitest-environment happy-dom

import type { PageResult, SpreadResult } from '@libraz/mejiro/book';
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
import { MejiroPage } from '../src/MejiroPage.js';
import { MejiroPageIndicator } from '../src/MejiroPageIndicator.js';
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
    expectTypeOf<MejiroScrollViewProps>().toHaveProperty('layout');
    expectTypeOf<MejiroSelectionLayerProps>().toHaveProperty('rects');
    expectTypeOf<MejiroSettingsPanelProps>().toHaveProperty('settings');
    expectTypeOf<MejiroShelfProps>().toHaveProperty('volumes');
    expectTypeOf<MejiroSpreadProps>().toHaveProperty('spread');
    expectTypeOf<MejiroStatsProps>().toHaveProperty('chapter');
    expectTypeOf<MejiroTocProps>().toHaveProperty('epub');
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
  it('uses slot rendering even for image-free pages to avoid native ruby flow reuse', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };

    const { container } = render(MejiroSpread, {
      props: { spread, pageWidth: 320, pageHeight: 460, contentHeight: 360 },
    });

    expect(container.querySelectorAll('.mejiro-page-slots')).toHaveLength(2);
    expect(container.querySelector('.mejiro-reader-page-content.mejiro-page')).toBeNull();
    expect(container.querySelector('br')).toBeNull();
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
