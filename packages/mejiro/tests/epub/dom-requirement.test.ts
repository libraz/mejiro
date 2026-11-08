/**
 * @vitest-environment node
 */
import { extractRubyContent, MejiroError, parseEditableEpub, parseEpub } from '@libraz/mejiro/epub';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

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
    await expect(parseEditableEpub(data)).rejects.toThrow(/DOMParser/);
    await expect(parseEditableEpub(data)).rejects.not.toThrow(ReferenceError);
  });

  it('reports the missing DOM as a dom-unavailable error from every entry point', async () => {
    const data = await makeEpub();
    expect(globalThis.DOMParser).toBeUndefined();

    const failures: unknown[] = [];
    try {
      extractRubyContent(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>',
      );
    } catch (error) {
      failures.push(error);
    }
    try {
      await parseEpub(data);
    } catch (error) {
      failures.push(error);
    }

    expect(failures).toHaveLength(2);
    for (const error of failures) {
      expect(error).toBeInstanceOf(MejiroError);
      expect(error).not.toBeInstanceOf(ReferenceError);
      expect((error as MejiroError).code).toBe('dom-unavailable');
    }
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

      const editor = await parseEditableEpub(data);
      expect(editor.chapters[0].blocks[0]).toMatchObject({ text: '本文' });
    } finally {
      const globals = globalThis as Record<string, unknown>;
      globals.DOMParser = undefined;
      globals.XMLSerializer = undefined;
      globals.Node = undefined;
    }
  });
});
