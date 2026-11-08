// @vitest-environment happy-dom

import { parseEditableEpub } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: defineComponent({
    name: 'FakeReader',
    setup(_props, { expose }) {
      expose({ goToAnchor: async () => {} });
      return () => h('div', { class: 'fake-reader' });
    },
  }),
}));

import { MejiroEditor } from '../src/MejiroEditor.js';

const CHAPTER_PATH = 'OPS/Text/chapter.xhtml';

// An element id, an inline svg and hidden text: the block model cannot write
// these back, so rebuilding this chapter would be rejected.
const CHAPTER_XHTML = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章</title></head><body><p id="anchor">本文</p><svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg><div hidden="">隠し</div></body></html>`;

async function buildEpub(chapterXhtml = CHAPTER_XHTML): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>',
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0"?><package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>検証</dc:title></metadata><manifest><item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="c1" /></spine></package>`,
  );
  zip.file(CHAPTER_PATH, chapterXhtml);
  return zip.generateAsync({ type: 'arraybuffer' });
}

afterEach(() => vi.restoreAllMocks());

describe('MejiroEditor (Vue) — watermark on a real EPUB', () => {
  it('exports a book that exports without a watermark, changing only the watermark paragraph', async () => {
    const source = await buildEpub();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(source));
    const { container, emitted } = render(MejiroEditor, {
      props: {
        epubUrl: '/book.epub',
        exportPolicy: { watermark: 'reader@example.com', download: false },
      },
    });
    await waitFor(() =>
      expect((container.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe(
        '本文',
      ),
    );

    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() =>
      expect((emitted().export?.length ?? 0) + (emitted().error?.length ?? 0)).toBe(1),
    );

    expect(emitted().error).toBeUndefined();
    const zip = await JSZip.loadAsync((emitted().export as [Uint8Array][])[0][0]);
    const exported = await zip.file(CHAPTER_PATH)?.async('string');
    expect(exported).toBe(
      CHAPTER_XHTML.replace('<body>', '<body><p>[mejiro-watermark] reader@example.com</p>'),
    );
  });

  it('watermarks an edited chapter on every export', async () => {
    const source = await buildEpub(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>章</title></head><body><p>本文</p></body></html>',
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(source));
    const { container, emitted } = render(MejiroEditor, {
      props: {
        epubUrl: '/book.epub',
        exportPolicy: { watermark: 'reader@example.com', download: false },
      },
    });
    const textarea = () => container.querySelector('textarea') as HTMLTextAreaElement | null;
    await waitFor(() => expect(textarea()?.value).toBe('本文'));
    await fireEvent.update(textarea() as HTMLTextAreaElement, '書き換えた本文');

    const exportButton = container.querySelector('.mejiro-editor-export') as HTMLButtonElement;
    await fireEvent.click(exportButton);
    await waitFor(() => expect(emitted().export?.length ?? 0).toBe(1));
    await fireEvent.click(exportButton);
    await waitFor(() => expect(emitted().export?.length ?? 0).toBe(2));

    for (const [bytes] of emitted().export as [Uint8Array][]) {
      const exported = await parseEditableEpub(bytes);
      const texts = exported.epub.chapters[0].blocks.flatMap((block) =>
        block.kind === 'paragraph' ? [block.text] : [],
      );
      expect(texts.filter((text) => text.startsWith('[mejiro-watermark]'))).toEqual([
        '[mejiro-watermark] reader@example.com',
      ]);
      expect(texts).toContain('書き換えた本文');
    }
  });
});
