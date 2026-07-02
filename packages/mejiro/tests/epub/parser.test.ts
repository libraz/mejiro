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

  it('uses nav titles when chapter XHTML has no heading and exposes page progression', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Nav Titles</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/nav.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="Text/ch1.xhtml">第一話</a></li></ol></nav></body>
</html>`,
      'OPS/Text/ch1.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const book = await parseEpub(data);

    expect(book.pageProgressionDirection).toBe('rtl');
    expect(book.chapters[0].title).toBe('第一話');
  });

  it('falls back to nav titles when auxiliary chapter title parsing fails', async () => {
    const OriginalDOMParser = globalThis.DOMParser;
    class FailingTitleDOMParser extends OriginalDOMParser {
      override parseFromString(
        string: string,
        type: Parameters<DOMParser['parseFromString']>[1],
      ): Document {
        if (type === 'application/xml' && string.includes('chapter-title-probe')) {
          return super.parseFromString('<parsererror>forced</parsererror>', 'application/xml');
        }
        return super.parseFromString(string, type);
      }
    }

    globalThis.DOMParser = FailingTitleDOMParser;
    try {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Nav Fallback</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
        'OPS/nav.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><nav><ol><li><a href="Text/ch1.xhtml">Nav Chapter</a></li></ol></nav></body>
</html>`,
        'OPS/Text/ch1.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>chapter-title-probe</h1><p>本文</p></body></html>`,
      });

      const book = await parseEpub(data);

      expect(book.chapters[0].title).toBe('Nav Chapter');
      expect(book.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
        'chapter-title-probe',
        '本文',
      ]);
    } finally {
      globalThis.DOMParser = OriginalDOMParser;
    }
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

  it('skips missing spine chapter files and keeps readable chapters', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>x</dc:title>
  </metadata>
  <manifest>
    <item id="missing" href="missing.xhtml" media-type="application/xhtml+xml" />
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="missing" />
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/ch1.xhtml': '<?xml version="1.0"?><html><body><p>本文</p></body></html>',
    });

    const book = await parseEpub(data);

    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].paragraphs[0].text).toBe('本文');
  });

  it('skips nav, cover, non-xhtml, and linear=no spine items', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>x</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="cover-image" />
    <item id="css" href="style.css" media-type="text/css" />
    <item id="skip" href="skip.xhtml" media-type="application/xhtml+xml" />
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="nav" />
    <itemref idref="cover" />
    <itemref idref="css" />
    <itemref idref="skip" linear="no" />
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/nav.xhtml': '<?xml version="1.0"?><html><body><p>nav</p></body></html>',
      'OPS/cover.xhtml': '<?xml version="1.0"?><html><body><p>cover</p></body></html>',
      'OPS/skip.xhtml': '<?xml version="1.0"?><html><body><p>skip</p></body></html>',
      'OPS/ch1.xhtml': '<?xml version="1.0"?><html><body><p>本文</p></body></html>',
    });

    const book = await parseEpub(data);

    expect(book.chapters.map((chapter) => chapter.paragraphs[0].text)).toEqual(['本文']);
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
