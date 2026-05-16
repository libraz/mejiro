// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EpubBook } from '@libraz/mejiro/epub';
import { act, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroReader, type MejiroReaderHandle } from '../src/MejiroReader.js';

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

  it('renders dropzone-eligible reader when neither epub nor epubUrl is supplied (file source)', () => {
    const { container } = render(<MejiroReader enableDropZone />);
    expect(container.querySelector('.mejiro-reader-drop-zone')).not.toBeNull();
  });
});

describe('MejiroReader (React) — controlled spreadIdx', () => {
  it('accepts spreadIdx + onSpreadIdxChange without throwing', () => {
    const onSpreadIdxChange = vi.fn();
    expect(() =>
      render(
        <MejiroReader epub={fakeEpub()} spreadIdx={0} onSpreadIdxChange={onSpreadIdxChange} />,
      ),
    ).not.toThrow();
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
