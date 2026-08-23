// @vitest-environment happy-dom
/** @jsxImportSource react */

import { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { act, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import {
  MejiroReader,
  type MejiroReaderHandle,
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

  it('goToAnchor supersedes the previous in-flight call (prior promise resolves)', async () => {
    const ref = createRef<MejiroReaderHandle>();
    const { unmount } = render(<MejiroReader ref={ref} epub={fakeEpub()} />);
    // Point at an out-of-range chapter so it cannot apply on its own.
    const firstPromise = ref.current?.goToAnchor({
      chapter: 99,
      paragraph: 0,
      charIndex: 0,
    });
    // Second call supersedes the first.
    void ref.current?.goToAnchor({ chapter: 99, paragraph: 1, charIndex: 0 });
    await expect(firstPromise).resolves.toBeUndefined();
    unmount();
  });

  it('goToAnchor resolves on unmount even if the layout never settles', async () => {
    const ref = createRef<MejiroReaderHandle>();
    const { unmount } = render(<MejiroReader ref={ref} epub={fakeEpub()} />);
    const promise = ref.current?.goToAnchor({ chapter: 99, paragraph: 0, charIndex: 0 });
    unmount();
    await expect(promise).resolves.toBeUndefined();
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
