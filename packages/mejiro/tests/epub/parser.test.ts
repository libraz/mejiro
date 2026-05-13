/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseEpub } from '../../src/epub/parser.js';

async function makeEpub(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) {
    zip.file(path, contents);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

const containerXml = `<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/package.opf" />
  </rootfiles>
</container>`;

describe('parseEpub', () => {
  it('resolves manifest hrefs relative to the OPF path', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>テスト</dc:title>
    <dc:creator>作者</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="../Text/chapter%201.xhtml#frag" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'Text/chapter 1.xhtml': `<?xml version="1.0"?>
<html><body><p>本文</p></body></html>`,
    });

    const book = await parseEpub(data);

    expect(book.title).toBe('テスト');
    expect(book.author).toBe('作者');
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].paragraphs[0].text).toBe('本文');
  });

  it('extracts chapter titles from prefixed XHTML heading elements', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Prefixed</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="chapter.xhtml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/chapter.xhtml': `<?xml version="1.0"?>
<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:body><x:h1>見出し</x:h1><x:p>本文</x:p></x:body></x:html>`,
    });

    const book = await parseEpub(data);

    expect(book.chapters[0].title).toBe('見出し');
    expect(book.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '見出し',
      '本文',
    ]);
  });

  it('parses chapters with stylesheet links that use explicit closing tags', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Stylesheet</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="chapter.xhtml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"></link></head><body><h1>見出し</h1><p>本文</p></body></html>`,
    });

    const book = await parseEpub(data);

    expect(book.chapters[0].title).toBe('見出し');
    expect(book.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '見出し',
      '本文',
    ]);
  });

  it('throws a clear error for malformed XML', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': '<container><rootfiles>',
    });

    await expect(parseEpub(data)).rejects.toThrow('Failed to parse XML document');
  });

  it('wraps non-ZIP buffers with a friendly "Not a valid EPUB file" error', async () => {
    const garbage = new TextEncoder().encode('not a zip file at all').buffer;
    await expect(parseEpub(garbage)).rejects.toThrow(/Not a valid EPUB file/);
  });

  it('throws when container.xml is missing', async () => {
    const data = await makeEpub({
      'OPS/package.opf': '<package />',
    });
    await expect(parseEpub(data)).rejects.toThrow('Missing file in EPUB: META-INF/container.xml');
  });

  it('throws when the OPF file referenced by container.xml is missing', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      // OPS/package.opf intentionally absent
    });
    await expect(parseEpub(data)).rejects.toThrow('Missing file in EPUB: OPS/package.opf');
  });

  it('throws when a spine chapter file is missing', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>x</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="missing.xhtml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
    });
    await expect(parseEpub(data)).rejects.toThrow('Missing file in EPUB: OPS/missing.xhtml');
  });

  it('throws a clear error for malformed manifest href encoding', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>x</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="chapter%E0%A4%A.xhtml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
    });

    await expect(parseEpub(data)).rejects.toThrow('Invalid EPUB href: chapter%E0%A4%A.xhtml');
  });

  it('throws "Failed to parse chapter XHTML" for malformed chapter content', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>x</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/ch1.xhtml': '<html><body><p>unterminated',
    });
    await expect(parseEpub(data)).rejects.toThrow(/Failed to parse chapter XHTML: OPS\/ch1\.xhtml/);
  });

  it('throws when every spine chapter yields zero paragraphs', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>x</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/ch1.xhtml': '<?xml version="1.0"?><html><body></body></html>',
    });
    await expect(parseEpub(data)).rejects.toThrow('EPUB has no readable chapters');
  });
});
