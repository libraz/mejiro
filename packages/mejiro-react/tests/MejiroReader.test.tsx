// @vitest-environment happy-dom
/** @jsxImportSource react */

import { MejiroBook } from '@libraz/mejiro/book';
import { type EpubBook, EpubProject } from '@libraz/mejiro/epub';
import { act, render, waitFor } from '@testing-library/react';
import { createRef, type Ref, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { enMessages, jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import {
  MejiroReader,
  type MejiroReaderHandle,
  type MejiroReaderProps,
  type MejiroReaderSettingsSlot,
} from '../src/MejiroReader.js';

function fakeEpub(): EpubBook {
  return {
    title: 'Test Book',
    author: 'Author',
    chapters: [
      {
        title: 'Chapter 1',
        paragraphs: [{ text: 'a', inlineAnnotations: [] }],
      },
      {
        title: 'Chapter 2',
        paragraphs: [{ text: 'b', inlineAnnotations: [] }],
      },
    ],
  };
}

const breakCalls = vi.hoisted(() => ({ count: 0 }));

// Counts line-breaking passes; the layout engine itself is unchanged.
vi.mock('../../mejiro/src/layout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../mejiro/src/layout.js')>();
  return {
    ...actual,
    computeBreaks: (input: Parameters<typeof actual.computeBreaks>[0]) => {
      breakCalls.count++;
      return actual.computeBreaks(input);
    },
  };
});

function longEpub(): EpubBook {
  return {
    title: 'Long Book',
    author: 'Author',
    chapters: [
      {
        title: 'Long Chapter',
        paragraphs: Array.from({ length: 80 }, (_, i) => ({
          text: `段落${i}。`.repeat(80),
          inlineAnnotations: [],
        })),
      },
    ],
  };
}

describe('MejiroReader (React) — default props', () => {
  it('does not render the drop zone by default (SaaS-safe default)', () => {
    const { container } = render(<MejiroReader />);
    expect(container.querySelector('.mejiro-reader-drop-zone')).toBeNull();
  });

  it('does not render the Image overlay button by default', () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} />);
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Image'),
      ),
    ).toBe(false);
  });

  it('renders the default header logo with title and subtitle', () => {
    const { container } = render(<MejiroReader />);
    expect(container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe('mejiro');
    expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe('Vertical Reader');
  });

  it('reflects custom title and subtitle props', () => {
    const { container } = render(<MejiroReader title="My Lib" subtitle="Reader" />);
    expect(container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe('My Lib');
    expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe('Reader');
  });

  it('uses the i18n provider catalog when locale props are omitted', () => {
    const { container } = render(
      <MejiroI18nProvider locale="ja">
        <MejiroReader enableDropZone />
      </MejiroI18nProvider>,
    );

    expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe(
      jaMessages.logoSubtitle,
    );
    expect(container.textContent).toContain(jaMessages.openButton);
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
  });
});

describe('MejiroReader (React) — enable* toggles', () => {
  it('enableHeader=false hides the header bar', () => {
    const { container } = render(<MejiroReader enableHeader={false} />);
    expect(container.querySelector('.mejiro-reader-header')).toBeNull();
  });

  it('enableDropZone=true exposes the drop zone when no EPUB is loaded', () => {
    const { container } = render(<MejiroReader enableDropZone />);
    expect(container.querySelector('.mejiro-reader-drop-zone')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some(
        (b) => b.textContent?.trim() === 'Open',
      ),
    ).toBe(true);
  });

  it('enableDropZone=true hides the drop zone once an EPUB is supplied', () => {
    const { container } = render(<MejiroReader enableDropZone epub={fakeEpub()} />);
    expect(container.querySelector('.mejiro-reader-drop-zone')).toBeNull();
  });

  it('enableChapterNav=false hides the chapter selector', () => {
    const { container } = render(<MejiroReader enableChapterNav={false} epub={fakeEpub()} />);
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-panel')).toBeNull();
  });

  it('enableChapterNav=true (default) renders the chapter select', () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} />);
    expect(container.querySelector('.mejiro-reader-chapter-nav')).not.toBeNull();
  });

  it('enableSettings=false hides the settings panel and toggle', () => {
    const { container } = render(<MejiroReader enableSettings={false} />);
    expect(container.querySelector('.mejiro-reader-settings-panel')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Settings'),
      ),
    ).toBe(false);
  });

  it('enableSettings=true (default) renders the settings panel', () => {
    const { container } = render(<MejiroReader />);
    expect(container.querySelector('.mejiro-reader-settings-panel')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Settings'),
      ),
    ).toBe(true);
  });

  it('enableImageOverlay=true with an EPUB exposes the Image button', () => {
    const { container } = render(<MejiroReader enableImageOverlay epub={fakeEpub()} />);
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Image'),
      ),
    ).toBe(true);
  });

  it('enableStats=false removes the stats element', () => {
    const { container } = render(<MejiroReader enableStats={false} />);
    expect(container.querySelector('.mejiro-reader-stats')).toBeNull();
  });

  it('enableStats=true (default) renders the stats element', () => {
    const { container } = render(<MejiroReader />);
    expect(container.querySelector('.mejiro-reader-stats')).not.toBeNull();
  });

  it('keeps runtime option changes when the parent re-renders with an equal options literal', async () => {
    const setOptionsSpy = vi.spyOn(MejiroBook.prototype, 'setOptions');
    const ref = createRef<MejiroReaderHandle>();
    const epub = fakeEpub();
    const { container, rerender } = render(
      <MejiroReader
        ref={ref}
        epub={epub}
        options={{ fontFamily: 'serif', fontSize: 16 }}
        enableStats
      />,
    );

    await act(async () => {
      await ref.current?.setOptions({ fontSize: 20 });
    });
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 20px');
    const callsBeforeRerender = setOptionsSpy.mock.calls.length;

    // A new object with the same values — the shape a parent re-render produces.
    rerender(
      <MejiroReader
        ref={ref}
        epub={epub}
        options={{ fontFamily: 'serif', fontSize: 16 }}
        enableStats
      />,
    );

    expect(setOptionsSpy.mock.calls.length).toBe(callsBeforeRerender);
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 20px');
    const book = setOptionsSpy.mock.contexts[0] as MejiroBook;
    expect(book.getOptions().fontSize).toBe(20);
    setOptionsSpy.mockRestore();
  });

  it('treats an option or message passed as undefined like an omitted one', () => {
    const { container } = render(
      <MejiroReader
        epub={fakeEpub()}
        options={{ fontFamily: 'serif', fontSize: undefined }}
        messages={{ logoSubtitle: undefined }}
        enableStats
      />,
    );
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 16px');
    expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe(
      enMessages.logoSubtitle,
    );
  });

  it('reacts to options prop changes', async () => {
    const epub = fakeEpub();
    const { container, rerender } = render(
      <MejiroReader epub={epub} options={{ fontFamily: 'serif', fontSize: 16 }} enableStats />,
    );

    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 16px');

    rerender(
      <MejiroReader epub={epub} options={{ fontFamily: 'serif', fontSize: 22 }} enableStats />,
    );

    await waitFor(() =>
      expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 22px'),
    );
  });
});

describe('MejiroReader (React) — renderSettings injection', () => {
  it('replaces the built-in controls while keeping the panel chrome', () => {
    const { container } = render(
      <MejiroReader
        epub={fakeEpub()}
        renderSettings={() => <div className="custom-settings">Custom</div>}
      />,
    );
    const panel = container.querySelector('.mejiro-reader-settings-panel');
    expect(panel).not.toBeNull();
    // Custom content lives inside the standard chrome (clip box + content layer).
    expect(
      panel?.querySelector(
        '.mejiro-reader-settings-inner > .mejiro-reader-settings-content > .custom-settings',
      )?.textContent,
    ).toBe('Custom');
    // The built-in font-size control is gone.
    expect(container.querySelector('#mejiro-reader-font-size')).toBeNull();
  });

  it('passes a live slot (settings, update, open, toggle) to the render prop', () => {
    let captured: MejiroReaderSettingsSlot | null = null;
    render(
      <MejiroReader
        epub={fakeEpub()}
        renderSettings={(slot) => {
          captured = slot;
          return <div />;
        }}
      />,
    );
    expect(captured).not.toBeNull();
    const slot = captured as unknown as MejiroReaderSettingsSlot;
    expect(typeof slot.settings.fontSize).toBe('number');
    expect(typeof slot.update).toBe('function');
    expect(typeof slot.toggle).toBe('function');
    expect(slot.open).toBe(false);
  });

  it('header Settings button toggles the injected panel open', () => {
    const { container } = render(
      <MejiroReader epub={fakeEpub()} renderSettings={() => <div className="custom-settings" />} />,
    );
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(false);
    const settingsBtn = Array.from(container.querySelectorAll('.mejiro-reader-btn')).find((b) =>
      b.textContent?.includes('Settings'),
    ) as HTMLButtonElement;
    act(() => {
      settingsBtn.click();
    });
    expect(panel.classList.contains('is-open')).toBe(true);
  });

  it('renders the built-in panel when renderSettings is omitted', () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} />);
    expect(container.querySelector('#mejiro-reader-font-size')).not.toBeNull();
  });
});

describe('MejiroReader (React) — chapterNavMode', () => {
  it("'panel' renders the side panel, not the select", () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} chapterNavMode="panel" />);
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
    expect(
      container.querySelector('.mejiro-reader-body')?.classList.contains('has-chapter-panel'),
    ).toBe(true);
  });

  it("'both' renders the select and the side panel", () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} chapterNavMode="both" />);
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).not.toBeNull();
  });

  it("'none' renders neither chapter affordance", () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} chapterNavMode="none" />);
    expect(container.querySelector('.mejiro-reader-chapter-panel')).toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
  });
});

describe('MejiroReader (React) — events', () => {
  it('calls onLoad on initial mount when an epub prop is supplied', () => {
    const onLoad = vi.fn();
    render(<MejiroReader epub={fakeEpub()} onLoad={onLoad} />);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].title).toBe('Test Book');
  });

  it('calls onLoad again when the epub prop changes', () => {
    const onLoad = vi.fn();
    const { rerender } = render(<MejiroReader epub={null} onLoad={onLoad} />);
    expect(onLoad).not.toHaveBeenCalled();
    rerender(<MejiroReader epub={fakeEpub()} onLoad={onLoad} />);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoad again when only the controlled chapter changes', () => {
    const onLoad = vi.fn();
    const epub = fakeEpub();
    const { rerender } = render(<MejiroReader epub={epub} chapter={0} onLoad={onLoad} />);

    expect(onLoad).toHaveBeenCalledTimes(1);
    rerender(<MejiroReader epub={epub} chapter={1} onLoad={onLoad} />);

    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('calls onLoad once per switch into a manuscript source, like an epub swap', () => {
    const onLoad = vi.fn();
    const manuscript = [{ id: 'c1', title: '原稿章', body: '本文' }];
    const { container, rerender } = render(
      <MejiroReader manuscript={manuscript} chapterNavMode="panel" onLoad={onLoad} />,
    );
    expect(onLoad).toHaveBeenCalledTimes(1);

    rerender(<MejiroReader epub={fakeEpub()} chapterNavMode="panel" onLoad={onLoad} />);
    expect(onLoad).toHaveBeenCalledTimes(2);

    rerender(<MejiroReader manuscript={[...manuscript]} chapterNavMode="panel" onLoad={onLoad} />);
    expect(onLoad).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain('原稿章');
  });

  it('calls onChapterChange when a chapter is selected via the panel', () => {
    const onChapterChange = vi.fn();
    const { container } = render(
      <MejiroReader epub={fakeEpub()} chapterNavMode="panel" onChapterChange={onChapterChange} />,
    );
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    (cards[1] as HTMLButtonElement).click();
    expect(onChapterChange).toHaveBeenCalledWith(1);
  });

  it('calls onError when URL loading fails', async () => {
    const onError = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    render(<MejiroReader epubUrl="/missing.epub" onError={onError} />);

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('offline');
    fetchSpy.mockRestore();
  });
});

describe('MejiroReader (React) — bare shorthand', () => {
  it('bare hides header, settings, stats, page indicator, chapter nav', () => {
    const { container } = render(<MejiroReader bare epub={fakeEpub()} />);
    expect(container.querySelector('.mejiro-reader-header')).toBeNull();
    expect(container.querySelector('.mejiro-reader-settings-panel')).toBeNull();
    expect(container.querySelector('.mejiro-reader-stats')).toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
    expect(container.querySelector('.mejiro-reader-page-indicator')).toBeNull();
  });

  it('explicit enable* props override bare', () => {
    const { container } = render(<MejiroReader bare enableHeader epub={fakeEpub()} />);
    expect(container.querySelector('.mejiro-reader-header')).not.toBeNull();
  });
});

describe('MejiroReader (React) — source variants', () => {
  it('skips the URL fetch when an epub prop is supplied (controlled source)', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    render(<MejiroReader epub={fakeEpub()} />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fetches when only epubUrl is supplied (URL source)', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    render(<MejiroReader epubUrl="/test.epub" />);
    expect(fetchSpy).toHaveBeenCalledWith('/test.epub');
    fetchSpy.mockRestore();
  });

  it('passes fetchOptions through to the global fetch', () => {
    const fetchOptions = { headers: { authorization: 'Bearer token' }, credentials: 'include' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    render(<MejiroReader epubUrl="/private.epub" fetchOptions={fetchOptions} />);

    expect(fetchSpy).toHaveBeenCalledWith('/private.epub', fetchOptions);
    fetchSpy.mockRestore();
  });

  it('uses the latest fetchOptions when epubUrl changes', async () => {
    const firstOptions = { headers: { authorization: 'Bearer one' } };
    const secondOptions = { headers: { authorization: 'Bearer two' } };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { rerender } = render(<MejiroReader epubUrl="/one.epub" fetchOptions={firstOptions} />);
    expect(fetchSpy).toHaveBeenCalledWith('/one.epub', firstOptions);

    rerender(<MejiroReader epubUrl="/two.epub" fetchOptions={secondOptions} />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/two.epub', secondOptions);
    });
    fetchSpy.mockRestore();
  });

  it('takes the EPUB bytes from fetchEpub instead of the global fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const bytes = new ArrayBuffer(8);
    const fetchEpub = vi.fn().mockResolvedValue(bytes);
    const onError = vi.fn();

    render(<MejiroReader epubUrl="/private.epub" fetchEpub={fetchEpub} onError={onError} />);

    await waitFor(() => {
      expect(fetchEpub).toHaveBeenCalledWith('/private.epub');
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    // The 8 zero bytes are not a ZIP, so the loader must surface the failure
    // rather than fall back to the global fetch.
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    fetchSpy.mockRestore();
  });

  it('renders dropzone-eligible reader when neither epub nor epubUrl is supplied (file source)', () => {
    const { container } = render(<MejiroReader enableDropZone />);
    expect(container.querySelector('.mejiro-reader-drop-zone')).not.toBeNull();
  });

  it('renders manuscript chapters without an EPUB round-trip (manuscript source)', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { container } = render(
      <MejiroReader
        manuscript={[
          { id: 'c1', title: '第一話', body: '本文一。' },
          { id: 'c2', title: '第二話', body: '本文二。' },
        ]}
      />,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const options = container.querySelectorAll('.mejiro-reader-chapter-nav option');
    expect(options.length).toBe(2);
    expect(options[0]?.textContent).toContain('第一話');
    expect(options[1]?.textContent).toContain('第二話');
    fetchSpy.mockRestore();
  });

  it('honors the dialect prop when synthesizing the manuscript book', async () => {
    // Both dialects read ｜base《ruby》, but only 'mejiro' reads 《《...》》 as
    // emphasis — under 'narou' those characters stay literal body text.
    const body = '｜漢字《かんじ》と《《傍点》》です';
    const pageOf = async (dialect: 'mejiro' | 'narou'): Promise<HTMLElement> => {
      const { container } = render(
        <MejiroReader dialect={dialect} manuscript={[{ id: 'c1', title: 'タイトル', body }]} />,
      );
      return waitFor(() => {
        const page = container.querySelector<HTMLElement>('.mejiro-reader-page-content');
        if (!page?.textContent) throw new Error('page not laid out yet');
        return page;
      });
    };

    const narou = await pageOf('narou');
    expect(narou.querySelector('ruby rt')?.textContent).toBe('かんじ');
    expect(narou.querySelector('.mejiro-emphasis')).toBeNull();
    expect(narou.textContent).toContain('《《傍点》》');

    const mejiro = await pageOf('mejiro');
    expect(mejiro.querySelector('ruby rt')?.textContent).toBe('かんじ');
    expect(mejiro.querySelector('.mejiro-emphasis')?.textContent).toBe('傍点');
    expect(mejiro.textContent).not.toContain('《《');
  });

  it('lays out the book text when an annotations prop is supplied', async () => {
    const { container } = render(
      <MejiroReader
        epub={fakeEpub()}
        annotations={[
          {
            chapter: 0,
            start: { paragraph: 0, charIndex: 0 },
            end: { paragraph: 0, charIndex: 1 },
            color: 'yellow',
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.mejiro-reader-page-content')?.textContent).toContain('a');
    });
  });

  it('paints annotation highlights in the color the annotation asked for', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <MejiroReader
          epub={longEpub()}
          annotations={[
            {
              chapter: 0,
              start: { paragraph: 0, charIndex: 0 },
              end: { paragraph: 0, charIndex: 8 },
              color: 'rgb(255, 235, 59)',
            },
          ]}
        />,
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const rects = Array.from(container.querySelectorAll<HTMLElement>('.mejiro-selection-rect'));
      expect(rects.length).toBeGreaterThan(0);
      for (const rect of rects) {
        expect(rect.style.backgroundColor).toBe('rgb(255, 235, 59)');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('paints annotation highlights only on the spread they belong to', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const { container } = render(
        <MejiroReader
          ref={ref}
          epub={longEpub()}
          annotations={[
            {
              chapter: 0,
              start: { paragraph: 0, charIndex: 0 },
              end: { paragraph: 0, charIndex: 8 },
            },
          ]}
        />,
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(ref.current?.getReadingPosition().totalSpreads).toBeGreaterThan(3);
      expect(container.querySelectorAll('.mejiro-selection-rect').length).toBeGreaterThan(0);

      await act(async () => {
        ref.current?.goToSpread(3);
        await vi.runAllTimersAsync();
      });
      expect(ref.current?.getReadingPosition().spreadIdx).toBe(3);
      expect(container.querySelectorAll('.mejiro-selection-rect').length).toBe(0);

      await act(async () => {
        ref.current?.goToSpread(0);
        await vi.runAllTimersAsync();
      });
      expect(container.querySelectorAll('.mejiro-selection-rect').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed option application through onError instead of rejecting', async () => {
    const failure = new Error('font unavailable');
    const spy = vi.spyOn(MejiroBook.prototype, 'setOptions').mockRejectedValue(failure);
    const onError = vi.fn();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={fakeEpub()} onError={onError} />);

      let settled: unknown = 'not-settled';
      await act(async () => {
        settled = await ref.current?.setOptions({ fontFamily: '"Missing Font"' });
      });

      expect(settled).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(failure);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('MejiroReader (React) — controlled spreadIdx', () => {
  it('applies the initial controlled spreadIdx after the layout is ready', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={longEpub()} spreadIdx={1} />);
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(ref.current?.getReadingPosition().spreadIdx).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to the prop value when the host ignores onSpreadIdxChange', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      // The host records the request but leaves the prop where it was.
      const onSpreadIdxChange = vi.fn();
      render(
        <MejiroReader
          ref={ref}
          epub={longEpub()}
          spreadIdx={0}
          onSpreadIdxChange={onSpreadIdxChange}
        />,
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(ref.current?.getReadingPosition().totalSpreads).toBeGreaterThan(1);

      await act(async () => {
        ref.current?.next();
        await vi.runAllTimersAsync();
      });

      expect(onSpreadIdxChange).toHaveBeenCalled();
      expect(ref.current?.getReadingPosition().spreadIdx).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit a synthetic onSpreadIdxChange on initial mount', async () => {
    const onSpreadIdxChange = vi.fn();
    render(<MejiroReader epub={fakeEpub()} onSpreadIdxChange={onSpreadIdxChange} />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSpreadIdxChange).not.toHaveBeenCalled();
  });
});

describe('MejiroReader (React) — imperative handle', () => {
  it('exposes goToSpread / next / prev / goToChapter / getReadingPosition', () => {
    const ref = createRef<MejiroReaderHandle>();
    render(<MejiroReader ref={ref} epub={fakeEpub()} />);
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.goToSpread).toBe('function');
    expect(typeof ref.current?.next).toBe('function');
    expect(typeof ref.current?.prev).toBe('function');
    expect(typeof ref.current?.goToChapter).toBe('function');
    const pos = ref.current?.getReadingPosition();
    expect(pos).toEqual({
      chapter: 0,
      spreadIdx: 0,
      totalPages: expect.any(Number),
      totalSpreads: expect.any(Number),
    });
  });

  it('goToChapter calls onChapterChange and updates getReadingPosition', () => {
    const onChapterChange = vi.fn();
    const ref = createRef<MejiroReaderHandle>();
    render(<MejiroReader ref={ref} epub={fakeEpub()} onChapterChange={onChapterChange} />);
    act(() => {
      ref.current?.goToChapter(1);
    });
    expect(onChapterChange).toHaveBeenCalledWith(1);
    expect(ref.current?.getReadingPosition().chapter).toBe(1);
  });

  it('goToAnchor returns a Promise', () => {
    const ref = createRef<MejiroReaderHandle>();
    render(<MejiroReader ref={ref} epub={fakeEpub()} />);
    const result = ref.current?.goToAnchor({ chapter: 0, paragraph: 0, charIndex: 0 });
    expect(result).toBeInstanceOf(Promise);
    // Swallow the rejection-free promise to avoid noisy unhandled-rejection warnings.
    void result?.catch(() => {});
  });
});

describe('MejiroReader (React) — logo prop', () => {
  it('logo prop replaces the default logo block', () => {
    const { container } = render(<MejiroReader logo={<div className="custom-logo">Custom</div>} />);
    expect(container.querySelector('.custom-logo')?.textContent).toBe('Custom');
    expect(container.querySelector('.mejiro-reader-logo')).toBeNull();
  });

  it('logo={null} hides the logo but keeps the rest of the header', () => {
    const { container } = render(<MejiroReader logo={null} />);
    expect(container.querySelector('.mejiro-reader-logo')).toBeNull();
    expect(container.querySelector('.mejiro-reader-header')).not.toBeNull();
  });
});

/**
 * Runs `step`, then drains timers across separate `act` scopes so effects
 * scheduled by one round (debounced re-flows, turn animations) run too.
 */
async function settle(step?: () => void): Promise<void> {
  await act(async () => {
    step?.();
    await vi.runAllTimersAsync();
  });
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  }
}

/** Long chapter 0 (several spreads) followed by a one-spread chapter 1. */
function twoChapterEpub(): EpubBook {
  return {
    title: 'Two Chapters',
    author: 'Author',
    chapters: [
      longEpub().chapters[0],
      { title: 'Short', paragraphs: [{ text: 'b', inlineAnnotations: [] }] },
    ],
  };
}

/** Two long chapters whose text differs, so one anchor lands on different spreads in each. */
function unevenChaptersEpub(): EpubBook {
  return {
    title: 'Uneven',
    author: 'Author',
    chapters: [
      {
        title: 'Sparse',
        paragraphs: Array.from({ length: 80 }, () => ({ text: 'あ', inlineAnnotations: [] })),
      },
      longEpub().chapters[0],
    ],
  };
}

/** Whether `anchor` lies in the half-open range `[start, end)`. */
function inRange(
  anchor: { paragraph: number; charIndex: number },
  range: {
    start: { paragraph: number; charIndex: number };
    end: { paragraph: number; charIndex: number };
  },
): boolean {
  const cmp = (a: typeof anchor, b: typeof anchor) =>
    a.paragraph - b.paragraph || a.charIndex - b.charIndex;
  return cmp(range.start, anchor) <= 0 && cmp(anchor, range.end) < 0;
}

describe('MejiroReader (React) — lifecycle event parity', () => {
  // The Vue suite drives the identical scenario and asserts the identical log.
  it('emits one event set per spread change and none for mount or a same-spread re-layout', async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      const ref = createRef<MejiroReaderHandle>();
      render(
        <MejiroReader
          ref={ref}
          epub={twoChapterEpub()}
          onPageRead={(anchor) => log.push(`pageRead:${anchor.chapter}`)}
          onChapterCompleted={(ch) => log.push(`chapterCompleted:${ch}`)}
        />,
      );
      await settle();
      // Read through the ref each time: the handle object is rebuilt per render.
      const handle = () => ref.current as MejiroReaderHandle;
      handle().subscribe('spreadChanged', (p) =>
        log.push(`spreadChanged:${p.chapter}:${p.spreadIdx}`),
      );
      handle().subscribe('chapterFinished', (p) => log.push(`chapterFinished:${p.chapter}`));
      const totalBefore = handle().getReadingPosition().totalSpreads;
      expect(totalBefore).toBeGreaterThan(2);
      expect(log).toEqual([]);

      await settle(() => handle().next());
      expect(log.splice(0)).toEqual(['pageRead:0', 'spreadChanged:0:1']);

      await settle(() => handle().prev());
      expect(log.splice(0)).toEqual(['pageRead:0', 'spreadChanged:0:0']);

      // A re-layout that keeps the reader on spread 0 emits nothing.
      await settle(() => void handle().setOptions({ lineSpacing: 3 }));
      expect(handle().getReadingPosition().totalSpreads).not.toBe(totalBefore);
      expect(handle().getReadingPosition().spreadIdx).toBe(0);
      expect(log).toEqual([]);

      const last = handle().getReadingPosition().totalSpreads - 1;
      await settle(() => handle().goToSpread(last));
      expect(log.splice(0)).toEqual([
        'pageRead:0',
        `spreadChanged:0:${last}`,
        'chapterFinished:0',
        'chapterCompleted:0',
      ]);

      await settle(() => handle().goToChapter(1));
      expect(log.splice(0)).toEqual([
        'pageRead:0',
        'spreadChanged:1:0',
        'chapterFinished:1',
        'chapterCompleted:1',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (React) — reading position', () => {
  it('keeps the visible anchor on screen across an option-driven re-layout', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={longEpub()} />);
      await settle();
      // Read through the ref each time: the handle object is rebuilt per render.
      const handle = () => ref.current as MejiroReaderHandle;
      await settle(() => handle().goToSpread(3));
      const anchor = handle().getAnchor();
      const totalBefore = handle().getReadingPosition().totalSpreads;
      expect(anchor).not.toBeNull();

      await settle(() => void handle().setOptions({ lineSpacing: 3 }));

      expect(handle().getReadingPosition().totalSpreads).not.toBe(totalBefore);
      const range = handle().getVisibleRange();
      expect(range).not.toBeNull();
      expect(
        inRange(anchor as NonNullable<typeof anchor>, range as NonNullable<typeof range>),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('breaks each paragraph once across an option-driven re-layout', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={longEpub()} />);
      await settle();
      const handle = () => ref.current as MejiroReaderHandle;
      breakCalls.count = 0;

      await settle(() => void handle().setOptions({ mode: 'loose' }));

      expect(handle().getReadingPosition().totalSpreads).toBeGreaterThan(0);
      expect(breakCalls.count).toBe(longEpub().chapters[0].paragraphs.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves goToAnchor to another chapter against that chapter layout', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={unevenChaptersEpub()} />);
      await settle();
      const target = { chapter: 1, paragraph: 40, charIndex: 0 };
      let done = false;
      await settle(() => {
        void ref.current?.goToAnchor(target).then(() => {
          done = true;
        });
      });

      expect(done).toBe(true);
      // Read through the ref each time: the handle object is rebuilt per render.
      const handle = () => ref.current as MejiroReaderHandle;
      expect(handle().getReadingPosition().chapter).toBe(1);
      expect(handle().getReadingPosition().spreadIdx).toBeGreaterThan(0);
      const range = handle().getVisibleRange();
      expect(range?.start.chapter).toBe(1);
      expect(inRange(target, range as NonNullable<typeof range>)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (React) — limits', () => {
  it('accepts a partial limits override and applies it to the reader-loaded EPUB', async () => {
    const onError = vi.fn();
    const fetchEpub = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const limits: MejiroReaderProps['limits'] = { maxInputBytes: 4 };
    render(
      <MejiroReader epubUrl="/book.epub" fetchEpub={fetchEpub} limits={limits} onError={onError} />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0].message).toBe(
      'EPUB exceeds the compressed input limit (4 bytes)',
    );
  });
});

/** Makes glyph widths follow the canvas font size, so heading styles move line breaks. */
function measureByFontSize(): () => void {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => unknown };
  const original = proto.getContext;
  const context = {
    font: '',
    measureText(text: string) {
      return { width: text.length * Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10) };
    },
  };
  proto.getContext = () => context;
  return () => {
    proto.getContext = original;
  };
}

describe('MejiroReader (React) — heading option re-flow', () => {
  it('re-paginates the displayed chapter after a heading style change', async () => {
    vi.useFakeTimers();
    const restoreMeasure = measureByFontSize();
    try {
      const epub: EpubBook = {
        title: 'Headings',
        author: 'Author',
        chapters: [
          {
            title: 'Headings',
            paragraphs: Array.from({ length: 60 }, (_, i) => ({
              text: `見出し${i}`.repeat(8),
              inlineAnnotations: [],
              headingLevel: 1,
            })),
          },
        ],
      };
      const ref = createRef<MejiroReaderHandle>();
      const { container } = render(<MejiroReader ref={ref} epub={epub} />);
      await settle();
      const pageText = () => container.querySelector('.mejiro-reader-page-content')?.textContent;
      const before = { total: ref.current?.getReadingPosition().totalPages, text: pageText() };

      await settle(() => void ref.current?.setOptions({ headingStyles: { 1: { scale: 3 } } }));

      expect(ref.current?.getReadingPosition().totalPages).toBeGreaterThan(before.total ?? 0);
      expect(pageText()?.length).toBeLessThan(before.text?.length ?? 0);
    } finally {
      restoreMeasure();
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (React) — manuscript source identity', () => {
  // The Vue suite drives the identical scenario.
  it('keeps chapter, spread and layout when a new array with equal content arrives', async () => {
    vi.useFakeTimers();
    const layoutSpy = vi.spyOn(MejiroBook.prototype, 'layoutChapter');
    try {
      const body = Array.from({ length: 40 }, (_, i) => `段落${i}。`.repeat(60)).join('\n\n');
      const chapters = () => [
        { id: 'c1', title: '一', body },
        { id: 'c2', title: '二', body },
      ];
      const onLoad = vi.fn();
      const ref = createRef<MejiroReaderHandle>();
      const { rerender } = render(
        <MejiroReader ref={ref} manuscript={chapters()} onLoad={onLoad} />,
      );
      await settle();
      await settle(() => ref.current?.goToChapter(1));
      await settle(() => ref.current?.goToSpread(2));
      const layoutsBefore = layoutSpy.mock.calls.length;
      expect(ref.current?.getReadingPosition()).toMatchObject({ chapter: 1, spreadIdx: 2 });

      await settle(() =>
        rerender(<MejiroReader ref={ref} manuscript={chapters()} onLoad={onLoad} />),
      );

      expect(ref.current?.getReadingPosition()).toMatchObject({ chapter: 1, spreadIdx: 2 });
      expect(layoutSpy.mock.calls.length).toBe(layoutsBefore);
      expect(onLoad).toHaveBeenCalledTimes(1);

      // A real content edit re-lays out the chapter but keeps the chapter selection.
      const edited = chapters();
      edited[1] = { ...edited[1], body: `${body}\n\n追記` };
      await settle(() => rerender(<MejiroReader ref={ref} manuscript={edited} onLoad={onLoad} />));

      expect(layoutSpy.mock.calls.length).toBeGreaterThan(layoutsBefore);
      expect(ref.current?.getReadingPosition().chapter).toBe(1);
      expect(onLoad).toHaveBeenCalledTimes(1);
    } finally {
      layoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

/** One chapter of `pages` paragraphs, each filling exactly one page in the test DOM. */
function pagedEpub(pages: number): EpubBook {
  return {
    title: 'Paged',
    author: 'Author',
    chapters: [
      {
        title: 'Paged Chapter',
        paragraphs: Array.from({ length: pages }, (_, i) => ({
          text: `段落${i}。`.repeat(40),
          inlineAnnotations: [],
        })),
      },
    ],
  };
}

/** Header page numbers of the rendered pages, in DOM order (right page first). */
function shownPageNumbers(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('.mejiro-reader-page .mejiro-reader-page-header-num'),
    (el) => el.textContent ?? '',
  );
}

/**
 * Stubs the reading surface's box and `ResizeObserver`. `client` also drives
 * `clientWidth` / `clientHeight`, so page size (and pagination) follow the box.
 */
function stubSurface(
  width: number,
  height: number,
  client: boolean,
): { resize: (width: number, height: number) => void; restore: () => void } {
  const box = { width, height };
  const observers = new Set<ResizeObserverCallback>();
  class MockResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(): void {
      observers.add(this.cb);
    }
    unobserve(): void {}
    disconnect(): void {
      observers.delete(this.cb);
    }
  }
  const originalResizeObserver = globalThis.ResizeObserver;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        ...box,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: box.width,
        bottom: box.height,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  const clientSpies = client
    ? [
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => box.width),
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => box.height),
      ]
    : [];
  return {
    resize(w, h) {
      box.width = w;
      box.height = h;
      for (const cb of [...observers]) cb([], {} as ResizeObserver);
    },
    restore() {
      rectSpy.mockRestore();
      for (const spy of clientSpies) spy.mockRestore();
      vi.stubGlobal('ResizeObserver', originalResizeObserver);
    },
  };
}

describe('MejiroReader (React) — single-page mode', () => {
  // The Vue suite drives the identical scenarios.
  it.each([7, 6])(
    'next() from page 0 shows each page of a %i-page chapter once, in order',
    async (n) => {
      vi.useFakeTimers();
      try {
        const ref = createRef<MejiroReaderHandle>();
        const idxChanges: number[] = [];
        const { container } = render(
          <MejiroReader
            ref={ref}
            epub={pagedEpub(n)}
            spreadMode="single"
            onSpreadIdxChange={(i) => idxChanges.push(i)}
          />,
        );
        await settle();
        const handle = () => ref.current as MejiroReaderHandle;
        const events: number[] = [];
        handle().subscribe('spreadChanged', (p) => events.push(p.spreadIdx));
        expect(handle().getReadingPosition()).toMatchObject({ totalPages: n, totalSpreads: n });

        const shown: string[] = [];
        for (let i = 0; i < n; i++) {
          expect(handle().getReadingPosition().spreadIdx).toBe(i);
          shown.push(...shownPageNumbers(container));
          await settle(() => handle().next());
        }
        expect(shown).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
        expect(handle().getReadingPosition().spreadIdx).toBe(n - 1);
        const steps = Array.from({ length: n - 1 }, (_, i) => i + 1);
        expect(events).toEqual(steps);
        expect(idxChanges).toEqual(steps);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('goToSpread(n) shows page n', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const { container } = render(
        <MejiroReader ref={ref} epub={pagedEpub(7)} spreadMode="single" />,
      );
      await settle();
      await settle(() => ref.current?.goToSpread(5));
      expect(shownPageNumbers(container)).toEqual(['6']);
      await settle(() => ref.current?.goToSpread(2));
      expect(shownPageNumbers(container)).toEqual(['3']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the page on screen when auto flips between double and single', async () => {
    const surface = stubSurface(1200, 800, false);
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const { container } = render(
        <MejiroReader ref={ref} epub={pagedEpub(7)} spreadMode="auto" />,
      );
      await settle();
      const handle = () => ref.current as MejiroReaderHandle;
      await settle(() => handle().goToSpread(1));
      expect(shownPageNumbers(container)).toEqual(['3', '4']);
      const spreadStart = handle().getAnchor();

      // Double → single: the spread's first page in reading order.
      await settle(() => surface.resize(600, 900));
      expect(handle().getReadingPosition().spreadIdx).toBe(2);
      expect(shownPageNumbers(container)).toEqual(['3']);
      expect(handle().getAnchor()).toEqual(spreadStart);

      // Single on a left page → double: the spread containing it.
      await settle(() => handle().next());
      expect(shownPageNumbers(container)).toEqual(['4']);
      const leftStart = handle().getAnchor();
      await settle(() => surface.resize(1200, 800));
      expect(handle().getReadingPosition().spreadIdx).toBe(1);
      expect(shownPageNumbers(container)).toEqual(['3', '4']);
      const range = handle().getVisibleRange();
      expect(
        inRange(leftStart as NonNullable<typeof leftStart>, range as NonNullable<typeof range>),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
      surface.restore();
    }
  });
  it('keeps the passage on screen when an auto flip also re-paginates the chapter', async () => {
    const surface = stubSurface(1600, 900, true);
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={pagedEpub(120)} spreadMode="auto" />);
      const handle = () => ref.current as MejiroReaderHandle;
      await settle();
      // The first observer callback reports the real box, as a browser does on mount.
      await settle(() => surface.resize(1600, 900));
      await settle(() => handle().goToSpread(3));
      const spreadStart = handle().getAnchor() as NonNullable<
        ReturnType<MejiroReaderHandle['getAnchor']>
      >;

      await settle(() => surface.resize(700, 1000));
      const inSingle = handle().getReadingPosition();
      expect(inSingle.totalSpreads).toBe(inSingle.totalPages);
      expect(
        inRange(
          spreadStart,
          handle().getVisibleRange() as NonNullable<
            ReturnType<MejiroReaderHandle['getVisibleRange']>
          >,
        ),
      ).toBe(true);

      // Land on a left page, then flip back.
      if (handle().getReadingPosition().spreadIdx % 2 === 0) await settle(() => handle().next());
      await settle(() => handle().next());
      await settle(() => handle().next());
      const pageStart = handle().getAnchor() as NonNullable<
        ReturnType<MejiroReaderHandle['getAnchor']>
      >;
      await settle(() => surface.resize(1600, 900));
      const inDouble = handle().getReadingPosition();
      expect(inDouble.totalSpreads).toBe(Math.ceil(inDouble.totalPages / 2));
      expect(
        inRange(
          pageStart,
          handle().getVisibleRange() as NonNullable<
            ReturnType<MejiroReaderHandle['getVisibleRange']>
          >,
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
      surface.restore();
    }
  });
});

describe('MejiroReader (React) — image overlays', () => {
  function imageButton(container: HTMLElement): HTMLButtonElement {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('.mejiro-reader-btn')).find(
      (b) => b.textContent === enMessages.imageButton,
    ) as HTMLButtonElement;
  }
  const rectStyles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('.mejiro-selection-rect'), (el) =>
      el.getAttribute('style'),
    );

  it('re-derives annotation highlights when an image reflows the text', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <MejiroReader
          epub={longEpub()}
          enableImageOverlay
          annotations={[
            {
              chapter: 0,
              start: { paragraph: 0, charIndex: 0 },
              end: { paragraph: 0, charIndex: 320 },
            },
          ]}
        />,
      );
      await settle();
      const before = rectStyles(container);
      expect(before.length).toBeGreaterThan(0);

      await settle(() => imageButton(container).click());
      expect(container.querySelector('.mejiro-reader-image-overlay')).not.toBeNull();
      expect(rectStyles(container)).not.toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the scroll-mode pages when an image reflows the text', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <MejiroReader epub={longEpub()} enableImageOverlay mode="scroll" />,
      );
      await settle();
      const firstPage = () =>
        container.querySelector('[data-page-idx="0"] .mejiro-reader-page-content')?.innerHTML;
      const before = firstPage();
      expect(before).toBeTruthy();

      await settle(() => imageButton(container).click());
      expect(container.querySelector('.mejiro-reader-image-overlay')).not.toBeNull();
      expect(firstPage()).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('places a new image on the single page shown', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const { container } = render(
        <MejiroReader ref={ref} epub={pagedEpub(6)} enableImageOverlay spreadMode="single" />,
      );
      await settle();
      await settle(() => ref.current?.goToSpread(1));
      expect(container.querySelector('.mejiro-reader-page--left')).not.toBeNull();

      await settle(() => imageButton(container).click());
      const overlay = container.querySelector<HTMLElement>(
        '.mejiro-reader-page--left .mejiro-reader-image-overlay',
      );
      const pageWidth = Number.parseFloat(
        container.querySelector<HTMLElement>('.mejiro-reader-page--left')?.style.width ?? '',
      );
      const left = Number.parseFloat(overlay?.style.left ?? '');
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThan(pageWidth);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the images when the chapter changes', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const { container } = render(
        <MejiroReader ref={ref} epub={twoChapterEpub()} enableImageOverlay />,
      );
      await settle();
      await settle(() => imageButton(container).click());
      expect(imageButton(container).classList.contains('is-active')).toBe(true);

      await settle(() => ref.current?.goToChapter(1));
      expect(imageButton(container).classList.contains('is-active')).toBe(false);
      await settle(() => ref.current?.goToChapter(0));
      expect(container.querySelector('.mejiro-reader-image-overlay')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the images when the reader loads another book itself', async () => {
    const bytes = async (title: string) =>
      new EpubProject({
        metadata: { title },
        chapters: [{ title, body: `${title}の本文。` }],
        includeTitlePage: false,
      }).export();
    const books: Record<string, ArrayBuffer> = {
      '/a.epub': await bytes('甲'),
      '/b.epub': await bytes('乙'),
    };
    const fetchEpub = vi.fn(async (url: string) => books[url]);
    const onLoad = vi.fn();
    const { container, rerender } = render(
      <MejiroReader epubUrl="/a.epub" fetchEpub={fetchEpub} enableImageOverlay onLoad={onLoad} />,
    );
    await waitFor(() => expect(imageButton(container)).toBeTruthy());
    await waitFor(() =>
      expect(container.querySelector('.mejiro-reader-page-content')).not.toBeNull(),
    );
    act(() => imageButton(container).click());
    expect(imageButton(container).classList.contains('is-active')).toBe(true);

    rerender(
      <MejiroReader epubUrl="/b.epub" fetchEpub={fetchEpub} enableImageOverlay onLoad={onLoad} />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    expect(imageButton(container).classList.contains('is-active')).toBe(false);
  });

  it('ends the visible range of the last spread at the NFC end of the chapter', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const decomposed: EpubBook = {
        title: 'NFC',
        author: 'Author',
        chapters: [
          {
            title: 'Only',
            // Decomposed: three characters, six code points.
            paragraphs: [{ text: 'か\u3099'.repeat(3), inlineAnnotations: [] }],
          },
        ],
      };
      render(<MejiroReader ref={ref} epub={decomposed} />);
      await settle();
      expect(ref.current?.getVisibleRange()?.end).toEqual({
        chapter: 0,
        paragraph: 0,
        charIndex: 3,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

/** EPUB bytes of a short chapter 0 and a long chapter 1, as a URL-mode reader fetches them. */
async function twoChapterBytes(): Promise<ArrayBuffer> {
  return new EpubProject({
    metadata: { title: '二章' },
    chapters: [
      { title: '一', body: '短い。' },
      {
        title: '二',
        body: Array.from({ length: 80 }, (_, i) => `段落${i}。`.repeat(80)).join('\n\n'),
      },
    ],
    includeTitlePage: false,
  }).export();
}

/** A promise with its resolve / reject handles exposed. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Records whether `promise` has settled. */
function track(promise: Promise<void> | undefined): { settled: boolean } {
  const state = { settled: false };
  void promise?.then(() => {
    state.settled = true;
  });
  return state;
}

describe('MejiroReader (React) — goToAnchor settles on every path', () => {
  it('settles without moving when the anchor position does not exist', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={longEpub()} />);
      await settle();
      let state = { settled: false };
      await settle(() => {
        state = track(ref.current?.goToAnchor({ chapter: 0, paragraph: 9999, charIndex: 0 }));
      });
      expect(state.settled).toBe(true);
      expect(ref.current?.getReadingPosition()).toMatchObject({ chapter: 0, spreadIdx: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles without moving when the anchor chapter does not exist', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const onChapterChange = vi.fn();
      render(<MejiroReader ref={ref} epub={fakeEpub()} onChapterChange={onChapterChange} />);
      await settle();
      let state = { settled: false };
      await settle(() => {
        state = track(ref.current?.goToAnchor({ chapter: 99, paragraph: 0, charIndex: 0 }));
      });
      expect(state.settled).toBe(true);
      expect(ref.current?.getReadingPosition().chapter).toBe(0);
      expect(onChapterChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles a pending call once a newer one supersedes it', async () => {
    const pending = deferred<ArrayBuffer>();
    const ref = createRef<MejiroReaderHandle>();
    const { unmount } = render(
      <MejiroReader ref={ref} epubUrl="/book.epub" fetchEpub={() => pending.promise} />,
    );
    const first = track(ref.current?.goToAnchor({ chapter: 1, paragraph: 0, charIndex: 0 }));
    await Promise.resolve();
    expect(first.settled).toBe(false);

    void ref.current?.goToAnchor({ chapter: 1, paragraph: 1, charIndex: 0 });
    await waitFor(() => expect(first.settled).toBe(true));
    unmount();
  });

  it('settles a pending call on unmount', async () => {
    const pending = deferred<ArrayBuffer>();
    const ref = createRef<MejiroReaderHandle>();
    const { unmount } = render(
      <MejiroReader ref={ref} epubUrl="/book.epub" fetchEpub={() => pending.promise} />,
    );
    const state = track(ref.current?.goToAnchor({ chapter: 1, paragraph: 0, charIndex: 0 }));
    await Promise.resolve();
    expect(state.settled).toBe(false);

    unmount();
    await waitFor(() => expect(state.settled).toBe(true));
  });

  it('applies a call made before the book loads once it has loaded', async () => {
    const bytes = await twoChapterBytes();
    const pending = deferred<ArrayBuffer>();
    const ref = createRef<MejiroReaderHandle>();
    render(<MejiroReader ref={ref} epubUrl="/book.epub" fetchEpub={() => pending.promise} />);
    const target = { chapter: 1, paragraph: 40, charIndex: 0 };
    const state = track(ref.current?.goToAnchor(target));

    pending.resolve(bytes);

    await waitFor(() => expect(state.settled).toBe(true), { timeout: 3000 });
    await waitFor(() => expect(ref.current?.getReadingPosition().spreadIdx).toBeGreaterThan(0));
    expect(ref.current?.getReadingPosition().chapter).toBe(1);
    const range = ref.current?.getVisibleRange();
    expect(range?.start.chapter).toBe(1);
    expect(inRange(target, range as NonNullable<typeof range>)).toBe(true);
  });
});

describe('MejiroReader (React) — chapter index range', () => {
  it('clamps goToChapter into the book chapters', () => {
    const ref = createRef<MejiroReaderHandle>();
    const onChapterChange = vi.fn();
    render(<MejiroReader ref={ref} epub={fakeEpub()} onChapterChange={onChapterChange} />);

    act(() => ref.current?.goToChapter(99));
    expect(ref.current?.getReadingPosition().chapter).toBe(1);
    expect(onChapterChange).toHaveBeenLastCalledWith(1);

    act(() => ref.current?.goToChapter(-3));
    expect(ref.current?.getReadingPosition().chapter).toBe(0);
    expect(onChapterChange).toHaveBeenLastCalledWith(0);
  });

  it('clamps an out-of-range controlled chapter', () => {
    const ref = createRef<MejiroReaderHandle>();
    const { container } = render(<MejiroReader ref={ref} epub={fakeEpub()} chapter={5} />);
    expect(ref.current?.getReadingPosition().chapter).toBe(1);
    expect(container.querySelector('.mejiro-reader-surface')).not.toBeNull();
  });
});

describe('MejiroReader (React) — book swap baseline', () => {
  it('fires no lifecycle event for the first position of a newly loaded book', async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      const ref = createRef<MejiroReaderHandle>();
      const props = {
        ref,
        onPageRead: (anchor: { chapter: number }) => log.push(`pageRead:${anchor.chapter}`),
        onChapterCompleted: (ch: number) => log.push(`chapterCompleted:${ch}`),
      };
      const { rerender } = render(<MejiroReader {...props} epub={twoChapterEpub()} />);
      await settle();
      const handle = () => ref.current as MejiroReaderHandle;
      handle().subscribe('spreadChanged', (p) =>
        log.push(`spreadChanged:${p.chapter}:${p.spreadIdx}`),
      );
      await settle(() => handle().goToSpread(2));
      log.splice(0);

      rerender(<MejiroReader {...props} epub={longEpub()} />);
      await settle();
      expect(handle().getReadingPosition()).toMatchObject({ chapter: 0, spreadIdx: 0 });
      expect(log).toEqual([]);

      await settle(() => handle().next());
      expect(log).toEqual(['pageRead:0', 'spreadChanged:0:1']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (React) — controlled spreadIdx with a following host', () => {
  it('turns once and rests on the requested index when the host mirrors every change', async () => {
    vi.useFakeTimers();
    try {
      const book = longEpub();
      const reports: number[] = [];
      const ref = createRef<MejiroReaderHandle>();
      function Host({ readerRef }: { readerRef: Ref<MejiroReaderHandle> }) {
        const [idx, setIdx] = useState(0);
        return (
          <MejiroReader
            ref={readerRef}
            epub={book}
            spreadIdx={idx}
            onSpreadIdxChange={(i) => {
              reports.push(i);
              setIdx(i);
            }}
          />
        );
      }
      render(<Host readerRef={ref} />);
      await settle();
      const turns = vi.fn();
      ref.current?.subscribe('turnStart', turns);

      // Its own act: the turn renders before its timer ends it.
      await act(async () => ref.current?.next());
      await settle();

      expect(reports).toEqual([1]);
      expect(turns).toHaveBeenCalledTimes(1);
      expect(ref.current?.getReadingPosition().spreadIdx).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (React) — file picker with a controlled source', () => {
  /** Header "Open" button, if rendered. */
  const openButton = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.mejiro-reader-btn')).find(
      (b) => b.textContent?.trim() === enMessages.openButton,
    );

  it('offers neither the drop zone nor the Open button for a controlled epub', () => {
    const { container, rerender } = render(<MejiroReader enableDropZone epub={null} />);
    expect(container.querySelector('.mejiro-reader-drop-zone')).toBeNull();
    expect(openButton(container)).toBeUndefined();

    rerender(<MejiroReader enableDropZone epub={fakeEpub()} />);
    expect(openButton(container)).toBeUndefined();
  });

  it('offers neither for a manuscript source', () => {
    const { container } = render(
      <MejiroReader enableDropZone manuscript={[{ title: '章', body: '本文' }]} />,
    );
    expect(container.querySelector('.mejiro-reader-drop-zone')).toBeNull();
    expect(openButton(container)).toBeUndefined();
  });
});

describe('MejiroReader (React) — rejected option change', () => {
  it('rolls the settings back to the applied font and reports the rejection once', async () => {
    vi.useFakeTimers();
    const original = MejiroBook.prototype.setOptions;
    const sent: Array<string | undefined> = [];
    const spy = vi.spyOn(MejiroBook.prototype, 'setOptions').mockImplementation(function (
      this: MejiroBook,
      partial,
    ) {
      sent.push(partial.fontFamily);
      if (partial.fontFamily === 'Rejected') return Promise.reject(new Error('fallback font'));
      return original.call(this, partial);
    });
    try {
      const onError = vi.fn();
      const ref = createRef<MejiroReaderHandle>();
      let settings: MejiroReaderSettingsSlot['settings'] | undefined;
      render(
        <MejiroReader
          ref={ref}
          epub={fakeEpub()}
          onError={onError}
          renderSettings={(slot) => {
            settings = slot.settings;
            return null;
          }}
        />,
      );
      await settle();
      const applied = settings?.fontFamily;

      await settle(() => void ref.current?.setOptions({ fontFamily: 'Rejected' }));
      expect(onError).toHaveBeenCalledTimes(1);
      expect(settings?.fontFamily).toBe(applied);

      await settle(() => void ref.current?.setOptions({ lineSpacing: 2.5 }));
      expect(onError).toHaveBeenCalledTimes(1);
      expect(sent.filter((f) => f === 'Rejected')).toHaveLength(1);
      expect(settings?.lineSpacing).toBe(2.5);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (React) — documented interaction parity', () => {
  /** Dispatches a primary-button press and release at the same point. */
  function tap(target: HTMLElement): void {
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: 100 },
        clientY: { value: 100 },
        pointerType: { value: 'touch' },
      });
      act(() => {
        target.dispatchEvent(event);
      });
    }
  }

  it('enableSurfaceTap=true toggles chrome visibility from the spread surface', async () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} />);
    await waitFor(() => expect(container.querySelector('.mejiro-reader-spread')).not.toBeNull());
    const root = container.querySelector('.mejiro-reader') as HTMLElement;

    tap(container.querySelector('.mejiro-reader-spread') as HTMLElement);
    expect(root.classList.contains('mejiro-reader--chrome-hidden')).toBe(true);
  });

  it('enableSurfaceTap=false leaves the chrome alone', async () => {
    const { container } = render(<MejiroReader epub={fakeEpub()} enableSurfaceTap={false} />);
    await waitFor(() => expect(container.querySelector('.mejiro-reader-spread')).not.toBeNull());
    const root = container.querySelector('.mejiro-reader') as HTMLElement;

    tap(container.querySelector('.mejiro-reader-spread') as HTMLElement);
    expect(root.classList.contains('mejiro-reader--chrome-hidden')).toBe(false);
  });

  it('binds and releases the arrow keys when enableKeyboard changes at runtime', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      const book = longEpub();
      const { rerender } = render(<MejiroReader ref={ref} epub={book} enableKeyboard={false} />);
      await settle();
      const press = () =>
        settle(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        });

      await press();
      expect(ref.current?.getReadingPosition().spreadIdx).toBe(0);

      rerender(<MejiroReader ref={ref} epub={book} enableKeyboard />);
      await press();
      expect(ref.current?.getReadingPosition().spreadIdx).toBe(1);

      rerender(<MejiroReader ref={ref} epub={book} enableKeyboard={false} />);
      await press();
      expect(ref.current?.getReadingPosition().spreadIdx).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits turnStart then turnEnd around a page turn', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={longEpub()} />);
      await settle();
      const log: string[] = [];
      ref.current?.subscribe('turnStart', (p) => log.push(`turnStart:${p.from}`));
      ref.current?.subscribe('turnEnd', (p) => log.push(`turnEnd:${p.to}`));

      // Its own act: the turn renders before its timer ends it.
      await act(async () => ref.current?.next());
      await settle();

      expect(log).toEqual(['turnStart:0', 'turnEnd:1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a non-2xx epubUrl response through onError once', async () => {
    const onError = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404 }));
    try {
      render(<MejiroReader epubUrl="/missing.epub" onError={onError} />);

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe('Failed to load EPUB: 404');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
