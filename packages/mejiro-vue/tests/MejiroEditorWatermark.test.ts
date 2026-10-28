// @vitest-environment happy-dom

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

async function buildEpub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>',
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0"?><package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>検証</dc:title></metadata><manifest><item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="c1" /></spine></package>`,
  );
  zip.file(CHAPTER_PATH, CHAPTER_XHTML);
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
        exportPolicy: { watermark: { text: 'reader@example.com' }, allowDownload: false },
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
    const zip = await JSZip.loadAsync((emitted().export as [ArrayBuffer][])[0][0]);
    const exported = await zip.file(CHAPTER_PATH)?.async('string');
    expect(exported).toBe(
      CHAPTER_XHTML.replace('<body>', '<body><p>[mejiro-watermark] reader@example.com</p>'),
    );
  });
});
