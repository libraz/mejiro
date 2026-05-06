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

  it('throws a clear error for malformed XML', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': '<container><rootfiles>',
    });

    await expect(parseEpub(data)).rejects.toThrow('Failed to parse XML document');
  });
});
