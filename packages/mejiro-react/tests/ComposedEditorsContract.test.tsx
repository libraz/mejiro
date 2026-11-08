// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ManuscriptChapter } from '@libraz/mejiro';
import { fireEvent, render, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MejiroEditor, MejiroManuscriptEditor } from '../src/index.js';

/** A one-chapter EPUB holding the paragraph `本文`. */
async function epubBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>',
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0"?><package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>題</dc:title></metadata><manifest><item id="c1" href="Text/c.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="c1" /></spine></package>`,
  );
  zip.file(
    'OPS/Text/c.xhtml',
    '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body><p>本文</p></body></html>',
  );
  return zip.generateAsync({ type: 'uint8array' });
}

afterEach(() => vi.restoreAllMocks());

describe('MejiroEditor loading and preview', () => {
  it('loads epubUrl through fetchEpub with a signal, and aborts it on unmount', async () => {
    const bytes = await epubBytes();
    const signals: AbortSignal[] = [];
    const onLoad = vi.fn();
    const { unmount } = render(
      <MejiroEditor
        epubUrl="/b.epub"
        onLoad={onLoad}
        fetchEpub={async (url, options) => {
          expect(url).toBe('/b.epub');
          signals.push(options.signal);
          return bytes;
        }}
      />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onLoad.mock.calls[0][0].title).toBe('題');

    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it('merges fetchOptions into the default fetch', async () => {
    const bytes = await epubBytes();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(bytes.slice()));
    const onLoad = vi.fn();
    render(
      <MejiroEditor epubUrl="/b.epub" fetchOptions={{ credentials: 'include' }} onLoad={onLoad} />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalled());

    expect(fetchSpy).toHaveBeenCalledWith(
      '/b.epub',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
  });

  it('forwards previewProps to the preview reader', async () => {
    const bytes = await epubBytes();
    const { container } = render(
      <MejiroEditor
        epubUrl="/b.epub"
        fetchEpub={async () => bytes}
        previewProps={{ theme: 'dark', title: 'Preview', showStats: true }}
      />,
    );
    await waitFor(() => expect(container.querySelector('.mejiro-reader')).not.toBeNull());

    const reader = container.querySelector('.mejiro-reader') as HTMLElement;
    expect(reader.getAttribute('data-mejiro-theme')).toBe('dark');
    expect(reader.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe('Preview');
    expect(reader.querySelector('.mejiro-reader-stats')).not.toBeNull();
  });
});

describe('editor preview header', () => {
  it('titles the MejiroEditor preview with the edited book unless previewProps sets one', async () => {
    const bytes = await epubBytes();
    const shown = render(<MejiroEditor epubUrl="/b.epub" fetchEpub={async () => bytes} />);
    await waitFor(() =>
      expect(shown.container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe('題'),
    );
    shown.unmount();

    const overridden = render(
      <MejiroEditor
        epubUrl="/b.epub"
        fetchEpub={async () => bytes}
        previewProps={{ title: 'Host' }}
      />,
    );
    await waitFor(() =>
      expect(overridden.container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe(
        'Host',
      ),
    );
  });

  it('titles the MejiroManuscriptEditor preview with the draft title unless previewProps sets one', () => {
    const shown = render(<MejiroManuscriptEditor title="原稿題" />);
    expect(shown.container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe('原稿題');
    shown.unmount();

    const overridden = render(
      <MejiroManuscriptEditor title="原稿題" previewProps={{ title: 'Host' }} />,
    );
    expect(overridden.container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe(
      'Host',
    );
  });
});

describe('MejiroManuscriptEditor chapters', () => {
  const chapters: readonly ManuscriptChapter[] = [{ id: 'c1', title: '一', body: '本文' }];
  const titleInput = (container: HTMLElement) =>
    container.querySelectorAll<HTMLInputElement>('.mejiro-editor-section input')[3];

  it('reports each chapter edit and shows the chapters the host passes back', async () => {
    const reports: (readonly ManuscriptChapter[])[] = [];
    function Host() {
      const [value, setValue] = useState(chapters);
      return (
        <MejiroManuscriptEditor
          chapters={value}
          onChaptersChange={(next) => {
            reports.push(next);
            setValue(next);
          }}
        />
      );
    }
    const { container } = render(<Host />);
    fireEvent.change(titleInput(container), { target: { value: '改題' } });

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual([{ id: 'c1', title: '改題', body: '本文' }]);
    expect(titleInput(container).value).toBe('改題');
  });

  it('returns to the host chapters when the host keeps them', async () => {
    const onChaptersChange = vi.fn();
    const { container } = render(
      <MejiroManuscriptEditor chapters={chapters} onChaptersChange={onChaptersChange} />,
    );
    fireEvent.change(titleInput(container), { target: { value: '改題' } });

    await waitFor(() => expect(onChaptersChange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(titleInput(container).value).toBe('一'));
  });

  it('treats chapters without onChaptersChange as the initial chapters', () => {
    const { container, rerender } = render(<MejiroManuscriptEditor chapters={chapters} />);
    fireEvent.change(titleInput(container), { target: { value: '改題' } });
    rerender(<MejiroManuscriptEditor chapters={[{ id: 'c1', title: '別', body: '' }]} />);

    expect(titleInput(container).value).toBe('改題');
  });
});
