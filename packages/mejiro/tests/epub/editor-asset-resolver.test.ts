/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { AssetResolverRequest } from '../../src/epub/editor.js';
import { EpubProject, parseEditableEpub } from '../../src/epub/index.js';

async function makeEpub(files: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
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

const opfXml = `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>解決テスト</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`;

const chapterXhtml = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`;

describe('AssetResolverRequest across both export paths', () => {
  it('hands the editable path the URL and the ZIP path the bytes are written to', async () => {
    const editor = await parseEditableEpub(
      await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': chapterXhtml,
      }),
    );
    editor.addImage(0, {
      filename: 'remote.png',
      mediaType: 'image/png',
      url: 'https://cdn.example.com/remote.png',
    });

    const seen: AssetResolverRequest[] = [];
    const out = await editor.export({
      assetResolver(request) {
        seen.push(request);
        return new Uint8Array([1, 2, 3]);
      },
    });

    expect(seen).toEqual([
      {
        url: 'https://cdn.example.com/remote.png',
        href: 'OPS/Images/remote.png',
        mediaType: 'image/png',
      },
    ]);
    const zip = await JSZip.loadAsync(out);
    expect(zip.file(seen[0].href)).not.toBeNull();
  });

  it('hands the project path a request of the same shape', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '遠隔素材', identifier: 'urn:uuid:asset-union' },
      chapters: [{ title: '一', body: '本文' }],
    });
    project.addAsset({
      href: 'OPS/Images/remote.png',
      mediaType: 'image/png',
      url: 'https://cdn.example.com/project.png',
    });

    const seen: AssetResolverRequest[] = [];
    await project.export({
      assetResolver(request) {
        seen.push(request);
        return new Uint8Array([4, 5, 6]);
      },
    });

    expect(seen).toEqual([
      {
        url: 'https://cdn.example.com/project.png',
        href: 'OPS/Images/remote.png',
        mediaType: 'image/png',
      },
    ]);
  });

  it('accepts one resolver written against the request on both paths', async () => {
    const hrefs: string[] = [];
    const resolver = (request: AssetResolverRequest): Uint8Array => {
      hrefs.push(request.href);
      return new Uint8Array([9]);
    };

    const editor = await parseEditableEpub(
      await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': chapterXhtml,
      }),
    );
    editor.addImage(0, { filename: 'shared.png', url: 'https://cdn.example.com/shared.png' });
    await editor.export({ assetResolver: resolver });

    const project = EpubProject.fromManuscript({
      metadata: { title: '共有', identifier: 'urn:uuid:shared-resolver' },
      chapters: [{ title: '一', body: '本文' }],
    });
    project.addAsset({ href: 'OPS/Images/shared.png', url: 'https://cdn.example.com/shared.png' });
    await project.export({ assetResolver: resolver });

    expect(hrefs).toEqual(['OPS/Images/shared.png', 'OPS/Images/shared.png']);
  });
});
