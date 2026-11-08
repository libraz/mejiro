// @vitest-environment happy-dom
/** @jsxImportSource react */

import { parseEditableEpub } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: forwardRef(function FakeReader(_props, ref) {
    useImperativeHandle(ref, () => ({ goToAnchor: async () => {} }), []);
    return <div className="fake-reader" />;
  }),
}));

import { MejiroEditor } from '../src/MejiroEditor.js';

const EDITED_PATH = 'OPS/Text/edited.xhtml';
const UNTOUCHED_PATH = 'OPS/Text/untouched.xhtml';

const EDITED_XHTML = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>一</title></head><body><p>本文</p></body></html>`;

// An element id, an inline svg and hidden text: the block model cannot write
// these back, so rebuilding this chapter would be rejected.
const UNTOUCHED_XHTML = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>二</title></head><body><p id="anchor">続き</p><svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg><div hidden="">隠し</div></body></html>`;

async function buildEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>',
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0"?><package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>検証</dc:title></metadata><manifest><item id="c1" href="Text/edited.xhtml" media-type="application/xhtml+xml" /><item id="c2" href="Text/untouched.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="c1" /><itemref idref="c2" /></spine></package>`,
  );
  zip.file(EDITED_PATH, EDITED_XHTML);
  zip.file(UNTOUCHED_PATH, UNTOUCHED_XHTML);
  return zip.generateAsync({ type: 'uint8array' });
}

afterEach(() => vi.restoreAllMocks());

describe('MejiroEditor (React) — watermark on a real EPUB', () => {
  it('watermarks an edited and an untouched chapter of the export, leaving the document unmarked', async () => {
    const source = await buildEpub();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(source.slice()));
    const onExport = vi.fn();
    const onError = vi.fn();
    const { container } = render(
      <MejiroEditor
        epubUrl="/book.epub"
        onExport={onExport}
        onError={onError}
        exportPolicy={{ watermark: 'reader@example.com', download: false }}
      />,
    );
    const textarea = () => container.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea()?.value).toBe('本文'));

    fireEvent.change(textarea(), { target: { value: '直した本文' } });
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(onExport.mock.calls.length + onError.mock.calls.length).toBe(1));
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(onExport.mock.calls.length + onError.mock.calls.length).toBe(2));

    expect(onError).not.toHaveBeenCalled();
    const bytes = onExport.mock.calls[1][0] as Uint8Array;
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file(UNTOUCHED_PATH)?.async('string')).toBe(
      UNTOUCHED_XHTML.replace('<body>', '<body><p>[mejiro-watermark] reader@example.com</p>'),
    );
    const exported = await parseEditableEpub(bytes);
    const texts = (chapterIndex: number) =>
      exported.epub.chapters[chapterIndex].blocks.flatMap((block) =>
        block.kind === 'paragraph' ? [block.text] : [],
      );
    // One watermark per export of the same document, not one per run.
    expect(texts(0)).toEqual(['[mejiro-watermark] reader@example.com', '直した本文']);
    expect(texts(1)[0]).toBe('[mejiro-watermark] reader@example.com');
  });
});
