// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, PageResult, SpreadResult } from '@libraz/mejiro/book';
import type { EpubBook, EpubChapter } from '@libraz/mejiro/epub';
import type { RenderPage } from '@libraz/mejiro/render';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroChapterNav } from '../src/MejiroChapterNav.js';
import { MejiroDropZone } from '../src/MejiroDropZone.js';
import { MejiroImageOverlay } from '../src/MejiroImageOverlay.js';
import { MejiroPage } from '../src/MejiroPage.js';
import { MejiroPageIndicator } from '../src/MejiroPageIndicator.js';
import { MejiroScrollView } from '../src/MejiroScrollView.js';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';
import { MejiroShelf } from '../src/MejiroShelf.js';
import { MejiroSpread } from '../src/MejiroSpread.js';
import { MejiroStats } from '../src/MejiroStats.js';
import { MejiroToc } from '../src/MejiroToc.js';

describe('MejiroDropZone (React)', () => {
  it('calls onFile when a valid .epub is dropped', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    const dt = { files: [file] } as unknown as DataTransfer;

    fireEvent.drop(root, { dataTransfer: dt });

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('book.epub');
  });

  it('rejects non-.epub files via the default validator', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'notes.txt');
    const dt = { files: [file] } as unknown as DataTransfer;

    fireEvent.drop(root, { dataTransfer: dt });

    expect(onFile).not.toHaveBeenCalled();
  });

  it('honours a custom validateFile predicate', () => {
    const onFile = vi.fn();
    const { container } = render(
      <MejiroDropZone onFile={onFile} validateFile={(f) => f.name.endsWith('.zip')} />,
    );
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.zip');
    const dt = { files: [file] } as unknown as DataTransfer;
    fireEvent.drop(root, { dataTransfer: dt });

    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('toggles is-dragover on dragover/dragleave', () => {
    const { container } = render(<MejiroDropZone onFile={() => {}} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    fireEvent.dragOver(root);
    expect(root.classList.contains('is-dragover')).toBe(true);

    fireEvent.dragLeave(root);
    expect(root.classList.contains('is-dragover')).toBe(false);
  });

  it('uses the i18n catalog for default copy', () => {
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroDropZone onFile={() => {}} />
      </MejiroI18nProvider>,
    );
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
    expect(container.textContent).toContain(jaMessages.dropZoneHint);
  });

  it('merges partial provider message overrides', () => {
    const { container } = render(
      <MejiroI18nProvider messages={{ dropZoneTitle: 'Custom drop' }}>
        <MejiroDropZone onFile={() => {}} />
      </MejiroI18nProvider>,
    );

    expect(container.textContent).toContain('Custom drop');
    expect(container.textContent).toContain('epub files only');
  });

  it('supports provider locale without explicit message overrides', () => {
    const { container } = render(
      <MejiroI18nProvider locale="ja">
        <MejiroDropZone onFile={() => {}} />
      </MejiroI18nProvider>,
    );

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

describe('MejiroChapterNav (React)', () => {
  it("renders a <select> with one option per chapter ('select' variant)", () => {
    const { container } = render(
      <MejiroChapterNav epub={fakeEpub()} chapter={0} onChange={() => {}} />,
    );
    const options = container.querySelectorAll('select option');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toBe('C1');
    expect((options[0] as HTMLOptionElement).value).toBe('0');
  });

  it("calls onChange when the select changes ('select' variant)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MejiroChapterNav epub={fakeEpub()} chapter={0} onChange={onChange} />,
    );
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('keeps duplicate chapter titles selectable', () => {
    const epub = fakeEpub();
    epub.chapters = [
      { title: '同名', paragraphs: [] },
      { title: '同名', paragraphs: [] },
    ];

    const { container } = render(<MejiroChapterNav epub={epub} chapter={0} onChange={() => {}} />);

    expect(container.querySelectorAll('select option')).toHaveLength(2);
  });

  it("renders a list of chapter cards with the active card marked ('panel' variant)", () => {
    const { container } = render(
      <MejiroChapterNav epub={fakeEpub()} chapter={1} onChange={() => {}} variant="panel" />,
    );
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    expect(cards).toHaveLength(3);
    expect(cards[1].classList.contains('is-active')).toBe(true);
    expect(cards[1].getAttribute('aria-current')).toBe('true');
    expect(cards[0].getAttribute('aria-current')).toBeNull();
  });

  it("calls onChange when a panel card is clicked ('panel' variant)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MejiroChapterNav epub={fakeEpub()} chapter={0} onChange={onChange} variant="panel" />,
    );
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    (cards[2] as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('uses the i18n catalog for fallback chapter labels and panel title', () => {
    const epub = fakeEpub();
    epub.chapters[0] = { paragraphs: [{ text: 'untitled', inlineAnnotations: [] }] };
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroChapterNav epub={epub} chapter={0} onChange={() => {}} variant="panel" />
      </MejiroI18nProvider>,
    );
    expect(container.textContent).toContain(jaMessages.tocTitle);
    expect(container.textContent).toContain('第1章');
  });
});

describe('MejiroToc and MejiroShelf (React)', () => {
  it('uses the i18n catalog for default TOC and shelf copy', () => {
    const epub = fakeEpub();
    epub.chapters[0] = { paragraphs: [{ text: 'untitled', inlineAnnotations: [] }] };
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroToc epub={epub} searchable />
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

describe('MejiroImageOverlay (React)', () => {
  it('uses the i18n catalog for default labels', () => {
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroImageOverlay rect={{ x: 1, y: 2, w: 30, h: 40 }} />
      </MejiroI18nProvider>,
    );

    expect(container.textContent).toContain(jaMessages.imageButton);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      jaMessages.imageRemoveButton,
    );
  });
});

describe('MejiroPage (React)', () => {
  it('uses stable line-scoped keys for repeated ruby segments', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
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
          isHeading: false,
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
                  children: [{ type: 'ruby', base: '漢字', rubyText: 'かんじ' }],
                },
              ],
            },
          ],
          isHeading: false,
        },
      ],
    };

    const { container } = render(<MejiroPage page={page} />);

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

describe('MejiroSpread (React)', () => {
  it('uses slot rendering even for image-free pages to avoid native ruby flow reuse', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };

    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread spread={spread} pageWidth={320} pageHeight={460} contentHeight={360} />
      </MejiroI18nProvider>,
    );

    expect(container.querySelectorAll('.mejiro-page-slots')).toHaveLength(2);
    expect(container.querySelector('.mejiro-reader-page-content.mejiro-page')).toBeNull();
    expect(container.querySelector('br')).toBeNull();
  });

  it('prints each page number in its own running head and hides it when null', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      totalPages: 2,
    };

    // A null pageNumber is how `pageNumbers="right"` suppresses the left folio.
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread
          spread={spread}
          pageWidth={320}
          pageHeight={460}
          contentHeight={360}
          rightHeader={{ title: 'Book', pageNumber: 7 }}
          leftHeader={{ title: 'Chapter', pageNumber: null }}
        />
      </MejiroI18nProvider>,
    );

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

describe('MejiroScrollView (React)', () => {
  it('re-observes page elements when the page list changes', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const OriginalIntersectionObserver = globalThis.IntersectionObserver;
    class MockIntersectionObserver {
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const layoutA = fakeScrollLayout(2);
    const layoutB = fakeScrollLayout(3);

    try {
      const { rerender } = render(
        <MejiroScrollView layout={layoutA} pageWidth={320} pageHeight={460} contentHeight={360} />,
      );
      expect(observe).toHaveBeenCalledTimes(2);

      rerender(
        <MejiroScrollView layout={layoutB} pageWidth={320} pageHeight={460} contentHeight={360} />,
      );

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(5);
    } finally {
      vi.stubGlobal('IntersectionObserver', OriginalIntersectionObserver);
    }
  });
});

function fakeScrollLayout(totalPages: number): ChapterLayout {
  return {
    totalPages,
    getPage: (index: number) => pageResult(`頁${index + 1}`),
  } as unknown as ChapterLayout;
}

describe('MejiroSettingsPanel (React)', () => {
  const baseSettings = {
    fontFamily: 'serif',
    fontSize: 16,
    lineSpacing: 1.8,
    mode: 'strict' as const,
    enableHanging: true,
  };

  it('adds is-open when open=true', () => {
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onChange={() => {}} />,
    );
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(true);
  });

  it('omits is-open when open=false', () => {
    const { container } = render(
      <MejiroSettingsPanel open={false} settings={baseSettings} onChange={() => {}} />,
    );
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(false);
  });

  it('wraps controls in the accordion clip box + padded content layer', () => {
    // The `0fr → 1fr` accordion requires `.settings-inner` to be a bare clip box
    // and the padding/flex to live on a nested `.settings-content`; otherwise a
    // closed panel reserves a permanent band (looks "always open").
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onChange={() => {}} />,
    );
    const content = container.querySelector(
      '.mejiro-reader-settings-inner > .mejiro-reader-settings-content',
    );
    expect(content).not.toBeNull();
    // The controls live inside the content layer, not directly in the clip box.
    expect(content?.querySelector('.mejiro-reader-settings-group')).not.toBeNull();
  });

  it('calls onChange with the merged value when font size changes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onChange={onChange} />,
    );
    const sizeInput = container.querySelector('#mejiro-reader-font-size') as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseSettings, fontSize: 20 });
  });

  it('clamps invalid numeric settings instead of emitting zero or NaN', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onChange={onChange} />,
    );

    const sizeInput = container.querySelector('#mejiro-reader-font-size') as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: baseSettings.fontSize });
    fireEvent.change(sizeInput, { target: { value: '999' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });

    const spacingInput = container.querySelector('#mejiro-reader-line-spacing') as HTMLInputElement;
    fireEvent.change(spacingInput, { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 1 });
    fireEvent.change(spacingInput, { target: { value: '4' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 3 });
  });

  it('reflects min/max font size on the size input', () => {
    const { container } = render(
      <MejiroSettingsPanel
        open
        settings={baseSettings}
        onChange={() => {}}
        minFontSize={12}
        maxFontSize={28}
      />,
    );
    const sizeInput = container.querySelector('#mejiro-reader-font-size') as HTMLInputElement;
    expect(sizeInput.min).toBe('12');
    expect(sizeInput.max).toBe('28');
  });

  it('calls onChange for the kinsoku and hanging toggles', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onChange={onChange} />,
    );
    const kinsoku = container.querySelector('#mejiro-reader-kinsoku') as HTMLSelectElement;
    fireEvent.change(kinsoku, { target: { value: 'loose' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...baseSettings, mode: 'loose' });

    const hanging = container.querySelector('#mejiro-reader-hanging') as HTMLSelectElement;
    fireEvent.change(hanging, { target: { value: 'false' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...baseSettings, enableHanging: false });
  });

  it('shows the active font even when it is not in the `fonts` list (no blank select)', () => {
    const { container } = render(
      <MejiroSettingsPanel
        open
        settings={{ ...baseSettings, fontFamily: '"Noto Serif JP", serif' }}
        onChange={() => {}}
        fonts={[{ value: 'sans-serif', label: 'System Sans' }]}
      />,
    );
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    expect(fontSelect.value).toBe('"Noto Serif JP", serif');
    const option = Array.from(fontSelect.options).find((o) => o.value === '"Noto Serif JP", serif');
    expect(option).toBeTruthy();
    // Prettified label: first family, quotes stripped.
    expect(option?.textContent).toBe('Noto Serif JP');
  });

  it('does not duplicate the active font when it is already in the `fonts` list', () => {
    const { container } = render(
      <MejiroSettingsPanel
        open
        settings={{ ...baseSettings, fontFamily: 'serif' }}
        onChange={() => {}}
        fonts={[{ value: 'serif', label: 'System Serif' }]}
      />,
    );
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    expect(fontSelect.options.length).toBe(1);
    expect(fontSelect.value).toBe('serif');
  });
});

describe('MejiroPageIndicator (React)', () => {
  it('renders "current / total"', () => {
    const { container } = render(<MejiroPageIndicator current={3} total={12} />);
    expect(container.querySelector('.mejiro-reader-page-indicator')?.textContent).toBe('3 / 12');
  });
});

describe('MejiroStats (React)', () => {
  it('renders an empty span when chapter is null', () => {
    const { container } = render(<MejiroStats chapter={null} totalPages={0} elapsedMs={0} />);
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
    const { container } = render(<MejiroStats chapter={chapter} totalPages={4} elapsedMs={12.7} />);
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
    const { container } = render(<MejiroStats chapter={withRuby} totalPages={1} elapsedMs={0} />);
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('1ruby');
  });

  it('includes the fontLabel when provided', () => {
    const chapter: EpubChapter = { title: 'C', paragraphs: [{ text: 'a', inlineAnnotations: [] }] };
    const { container } = render(
      <MejiroStats chapter={chapter} totalPages={1} elapsedMs={0} fontLabel="Noto Serif 16px" />,
    );
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain(
      'Noto Serif 16px',
    );
  });
});
