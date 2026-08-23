/**
 * @vitest-environment node
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { EditableEpub, parseEpub } from '../../src/epub/index.js';

const containerXml = `<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/package.opf" />
  </rootfiles>
</container>`;

const opfXml = `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>SSR</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`;

async function makeEpub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', containerXml);
  zip.file('OPS/package.opf', opfXml);
  zip.file(
    'OPS/Text/chapter.xhtml',
    `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('EPUB parsing on a runtime without a DOM', () => {
  it('names the DOMParser requirement instead of throwing a ReferenceError', async () => {
    const data = await makeEpub();
    expect(globalThis.DOMParser).toBeUndefined();

    await expect(parseEpub(data)).rejects.toThrow(/DOMParser/);
    await expect(parseEpub(data)).rejects.not.toThrow(ReferenceError);
    await expect(EditableEpub.load(data)).rejects.toThrow(/DOMParser/);
    await expect(EditableEpub.load(data)).rejects.not.toThrow(ReferenceError);
  });

  it('parses once a DOM implementation is registered, as the SSR guide describes', async () => {
    const data = await makeEpub();
    const { Window } = await import('happy-dom');
    const window = new Window() as unknown as typeof globalThis;
    globalThis.DOMParser = window.DOMParser;
    globalThis.XMLSerializer = window.XMLSerializer;
    globalThis.Node = window.Node;

    try {
      const book = await parseEpub(data);
      expect(book.chapters[0].paragraphs[0].text).toBe('本文');

      const editor = await EditableEpub.load(data);
      expect(editor.chapters[0].paragraphs[0].text).toBe('本文');
    } finally {
      const globals = globalThis as Record<string, unknown>;
      globals.DOMParser = undefined;
      globals.XMLSerializer = undefined;
      globals.Node = undefined;
    }
  });
});
