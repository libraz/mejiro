/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  assetSourceOf,
  chapterStateOf,
  cloneEditableEpubBook,
  packageDataOf,
} from '../../src/epub/clone.js';
import { parseEditableEpub } from '../../src/epub/editor.js';

describe('cloneEditableEpubBook export state', () => {
  it('copies the export state of a parsed book with it', async () => {
    const zip = new JSZip();
    zip.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>',
    );
    zip.file(
      'OPS/package.opf',
      `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>t</dc:title></metadata>
<manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml" /><item id="fig" href="a.png" media-type="image/png" /></manifest>
<spine><itemref idref="c" /></spine></package>`,
    );
    zip.file(
      'OPS/c.xhtml',
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p><figure><img src="a.png" /></figure></body></html>',
    );
    zip.file('OPS/a.png', new Uint8Array([1]));
    const editor = await parseEditableEpub(await zip.generateAsync({ type: 'uint8array' }));
    editor.updateParagraph(0, editor.chapters[0].blocks[0].id, { text: '編集' });

    const copy = cloneEditableEpubBook(editor.epub);

    const data = packageDataOf(editor.epub);
    expect(packageDataOf(copy)).toEqual(data);
    expect(packageDataOf(copy).files).not.toBe(data.files);
    expect(chapterStateOf(copy.chapters[0])).toEqual({
      dirty: true,
      originalImageHrefs: ['OPS/a.png'],
    });
    const asset = copy.chapters[0].imageAssets.get('a.png');
    if (!asset) throw new Error('fixture must carry an image asset');
    expect(assetSourceOf(asset)).toEqual({ manifestId: 'fig', manifestHref: 'a.png' });

    chapterStateOf(copy.chapters[0]).dirty = false;
    expect(chapterStateOf(editor.chapters[0]).dirty).toBe(true);
  });
});
