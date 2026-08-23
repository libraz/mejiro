/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import {
  type AnnotatedParagraph,
  addEpubChapterImage,
  EditableEpub,
  parseEpub,
} from '../../src/epub/index.js';

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
    <dc:title>編集テスト</dc:title>
    <dc:creator>作者</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`;

describe('EditableEpub', () => {
  it('applies the same archive limits before eagerly materializing editable files', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': '<?xml version="1.0"?><html><body><p>本文</p></body></html>',
    });

    await expect(EditableEpub.load(data, { limits: { maxEntries: 1 } })).rejects.toThrow(
      /entry limit/,
    );
  });

  it('parses namespaced container and prefixed OPF manifest/spine entries', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`,
      'OPS/package.opf': `<?xml version="1.0"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <opf:metadata>
    <dc:title>名前空間</dc:title>
    <dc:creator>作者</dc:creator>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="c1" />
  </opf:spine>
</opf:package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章</h1><p>本文</p></body></html>`,
    });

    const parsed = await parseEpub(data);
    expect(parsed.title).toBe('名前空間');
    expect(parsed.chapters[0].paragraphs.map((p) => p.text)).toEqual(['第一章', '本文']);

    const editor = await EditableEpub.load(data);
    editor.addImage(0, {
      filename: 'inserted.png',
      mediaType: 'image/png',
      data: new Uint8Array([1]),
    });
    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');

    expect(opf).toContain('<opf:item id="img-inserted-png"');
    expect(opf).toContain('href="Images/inserted.png"');
  });

  it('loads chapter titles from prefixed XHTML heading elements', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:body><x:h1>見出し</x:h1><x:p>本文</x:p></x:body></x:html>`,
    });

    const editor = await EditableEpub.load(data);

    expect(editor.chapters[0].title).toBe('見出し');
    expect(editor.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '見出し',
      '本文',
    ]);
  });

  it('prefers an explicit hidden chapter-title element over the visible h1', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>本のタイトル</h1><span id="chapter-title" hidden="">章タイトル</span><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);

    expect(editor.chapters[0].title).toBe('章タイトル');
  });

  it('loads editable chapters with non-self-closing stylesheet links', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/style.css"></head><body><h1>見出し</h1><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);

    expect(editor.chapters[0].title).toBe('見出し');
    expect(editor.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '見出し',
      '本文',
    ]);
  });

  it('loads editable chapters with stylesheet links that use explicit closing tags', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/style.css"></link></head><body><h1>見出し</h1><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);

    expect(editor.chapters[0].title).toBe('見出し');
    expect(editor.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '見出し',
      '本文',
    ]);
  });

  it('rebuilds chapter XHTML from blocks (dropping non-structural source markup)', async () => {
    const data = await makeEpub({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="x" content="keep" /></head><body><section class="chapter"><h1 id="title">第一章</h1><p class="body" data-keep="yes"><span class="lead">本文</span></p><aside>注記</aside></section></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.updateParagraph(0, 1, {
      text: '校正本文',
      inlineAnnotations: [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'こうせい', type: 'group' },
      ],
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    // The serializer rebuilds the edited body from `blocks` while preserving
    // document-level metadata such as the head.
    expect(chapter).toContain('<h1>第一章</h1>');
    expect(chapter).toContain('<p><ruby>校正<rt>こうせい</rt></ruby>本文</p>');
    expect(chapter).toContain('<meta name="x" content="keep"');
    expect(chapter).not.toContain('data-keep');
  });

  it('preserves unedited chapter XHTML during export', async () => {
    const originalChapter = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/style.css"></link></head><body><ul><li><ruby>漢<rt>かん</rt></ruby>字</li></ul></body></html>`;
    const data = await makeEpub({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': originalChapter,
      'OPS/Styles/style.css': 'html { writing-mode: vertical-rl; }',
    });

    const editor = await EditableEpub.load(data);
    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);

    await expect(zip.file('OPS/Text/chapter.xhtml')?.async('string')).resolves.toBe(
      originalChapter,
    );
  });

  it('preserves untouched chapters and stylesheet links when one chapter is edited', async () => {
    const first = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/style.css"></link></head><body><p>第一章</p></body></html>`;
    const second = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/style.css"></link></head><body><ul><li>未編集</li></ul></body></html>`;
    const data = await makeEpub({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>二章</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="c2" href="Text/chapter-2.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
    <itemref idref="c2" />
  </spine>
</package>`,
      'OPS/Text/chapter-1.xhtml': first,
      'OPS/Text/chapter-2.xhtml': second,
      'OPS/Styles/style.css': 'html { writing-mode: vertical-rl; }',
    });

    const editor = await EditableEpub.load(data);
    editor.updateParagraph(0, 0, { text: '編集済み' });
    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const edited = await zip.file('OPS/Text/chapter-1.xhtml')?.async('string');

    expect(edited).toContain('<link rel="stylesheet" href="../Styles/style.css"');
    expect(edited).toContain('<p>編集済み</p>');
    await expect(zip.file('OPS/Text/chapter-2.xhtml')?.async('string')).resolves.toBe(second);
  });

  it('extracts list and description-list items as editable paragraphs', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>章</h1><ul><li>項目1</li><li>項目2</li></ul><dl><dt>用語</dt><dd>定義</dd></dl></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual([
      '章',
      '項目1',
      '項目2',
      '用語',
      '定義',
    ]);
  });

  it('writes proofreading and ruby edits back into an EPUB', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章</h1><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.updateParagraph(0, 1, {
      text: '漢字を校正した本文',
      inlineAnnotations: [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
      ],
    });

    const out = await editor.export();
    const reparsed = await parseEpub(out);

    expect(reparsed.chapters[0].paragraphs[1].text).toBe('漢字を校正した本文');
    expect(reparsed.chapters[0].paragraphs[1].inlineAnnotations[0]).toMatchObject({
      kind: 'ruby',
      startIndex: 0,
      endIndex: 2,
      rubyText: 'かんじ',
      type: 'group',
    });
  });

  it('writes non-ruby inline annotations back into chapter XHTML', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>ABCDEFG</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.setInlineAnnotations(0, 0, [
      { kind: 'emphasis', startIndex: 0, endIndex: 1, style: 'dot' },
      { kind: 'tcy', startIndex: 1, endIndex: 2 },
      { kind: 'em', startIndex: 2, endIndex: 3 },
      { kind: 'strong', startIndex: 3, endIndex: 4 },
      { kind: 'link', startIndex: 4, endIndex: 5, href: 'https://example.test', title: '例' },
      { kind: 'footnote', startIndex: 5, endIndex: 6, noteId: 'fn1' },
    ]);

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(chapter).toContain('<em class="mejiro-emphasis" data-style="dot">A</em>');
    expect(chapter).toContain('<span class="mejiro-tcy">B</span>');
    expect(chapter).toContain('<em>C</em>');
    expect(chapter).toContain('<strong>D</strong>');
    expect(chapter).toContain('<a href="https://example.test" title="例">E</a>');
    expect(chapter).toContain('<a class="mejiro-footnote-ref" href="#fn1">F</a>');
    expect(chapter).toContain('G</p>');
  });

  it('serializes contained inline annotations such as ruby inside links', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>漢字</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.setInlineAnnotations(0, 0, [
      { kind: 'link', startIndex: 0, endIndex: 2, href: 'https://example.test' },
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
    ]);

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(chapter).toContain(
      '<a href="https://example.test"><ruby>漢字<rt>かんじ</rt></ruby></a>',
    );
  });

  it('rejects exporting edited chapters with unsupported list structure', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>前</p><ul><li>項目</li></ul></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.updateParagraph(0, 0, { text: '編集' });

    await expect(editor.export()).rejects.toThrow(
      /Cannot export edited chapter with <ul> structure/u,
    );
  });

  it('preserves non-ruby inline annotations loaded from existing XHTML', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p><em class="mejiro-emphasis" data-style="circle">A</em><span class="mejiro-tcy">12</span><em>B</em><strong>C</strong><a href="https://example.test">D</a><a class="mejiro-footnote-ref" href="#fn1">E</a></p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].paragraphs[0].inlineAnnotations).toEqual([
      { kind: 'emphasis', startIndex: 0, endIndex: 1, style: 'circle' },
      { kind: 'tcy', startIndex: 1, endIndex: 3 },
      { kind: 'em', startIndex: 3, endIndex: 4 },
      { kind: 'strong', startIndex: 4, endIndex: 5 },
      { kind: 'link', startIndex: 5, endIndex: 6, href: 'https://example.test' },
      { kind: 'footnote', startIndex: 6, endIndex: 7, noteId: 'fn1' },
    ]);

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(chapter).toContain('<em class="mejiro-emphasis" data-style="circle">A</em>');
    expect(chapter).toContain('<span class="mejiro-tcy">12</span>');
    expect(chapter).toContain('<em>B</em>');
    expect(chapter).toContain('<strong>C</strong>');
    expect(chapter).toContain('<a href="https://example.test">D</a>');
    expect(chapter).toContain('<a class="mejiro-footnote-ref" href="#fn1">E</a>');
  });

  it('adds image assets to the EPUB package and chapter XHTML', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.addImage(0, {
      filename: 'inserted.png',
      mediaType: 'image/png',
      data: new Uint8Array([1, 2, 3]),
      alt: '挿絵',
      caption: 'キャプション',
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');
    const image = await zip.file('OPS/Images/inserted.png')?.async('uint8array');

    expect(opf).toContain('id="img-inserted-png"');
    expect(opf).toContain('href="Images/inserted.png"');
    expect(chapter).toContain('<img src="../Images/inserted.png" alt="挿絵"');
    expect(chapter).toContain('<figcaption>キャプション</figcaption>');
    expect(Array.from(image ?? [])).toEqual([1, 2, 3]);
  });

  it('preserves existing figure images when loading and exporting an EPUB', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>画像保持</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="fig1" href="Images/existing.png" media-type="image/png" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>前</p><figure data-placement="fullspread"><img src="../Images/existing.png" alt="既存" /><figcaption>説明</figcaption></figure><p>後</p></body></html>`,
      'OPS/Images/existing.png': new Uint8Array([9, 8, 7]),
    });

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'image',
      'paragraph',
    ]);
    const imageBlock = editor.chapters[0].blocks[1];
    expect(imageBlock).toMatchObject({
      kind: 'image',
      assetKey: 'existing.png',
      alt: '既存',
      caption: '説明',
      placement: 'fullspread',
    });
    expect(editor.chapters[0].imageAssets.get('existing.png')?.data).toEqual(
      new Uint8Array([9, 8, 7]),
    );

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');
    const image = await zip.file('OPS/Images/existing.png')?.async('uint8array');

    expect(chapter).toMatch(/<p>前<\/p>[\s\S]*<figure data-placement="fullspread">/u);
    expect(chapter).toContain('<img src="../Images/existing.png" alt="既存"');
    expect(chapter).toContain('<figcaption>説明</figcaption>');
    expect(chapter).toContain('<p>後</p>');
    expect(Array.from(image ?? [])).toEqual([9, 8, 7]);
  });

  it('preserves existing image media types from the OPF manifest', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>画像種別</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="fig1" href="Images/cover" media-type="image/avif" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><figure><img src="../Images/cover" alt="表紙" /></figure></body></html>`,
      'OPS/Images/cover': new Uint8Array([1, 1, 2, 3]),
    });

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].imageAssets.get('cover')?.mediaType).toBe('image/avif');

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');

    expect(opf).toContain('<item id="fig1" href="Images/cover" media-type="image/avif"/>');
    expect(opf).not.toContain('media-type="application/octet-stream"');
  });

  it('preserves existing image ZIP paths outside the default Images directory', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>画像パス</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="fig1" href="Media/existing.webp" media-type="image/webp" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><figure><img src="../Media/existing.webp" alt="既存" /></figure></body></html>`,
      'OPS/Media/existing.webp': new Uint8Array([5, 4, 3]),
    });

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].imageAssets.get('existing.webp')).toMatchObject({
      filename: 'existing.webp',
      href: 'OPS/Media/existing.webp',
      mediaType: 'image/webp',
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(zip.file('OPS/Media/existing.webp')).not.toBeNull();
    expect(zip.file('OPS/Images/existing.webp')).toBeNull();
    expect(opf).toContain('<item id="fig1" href="Media/existing.webp" media-type="image/webp"/>');
    expect(opf).not.toContain('href="Images/existing.webp"');
    expect(chapter).toContain('<img src="../Media/existing.webp" alt="既存"');
  });

  it('preserves percent-encoded OPF image hrefs without adding duplicate manifest items', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>encoded</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="fig1" href="Images/my%20pic.png" media-type="image/png" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><figure><img src="../Images/my%20pic.png" alt="encoded" /></figure></body></html>`,
      'OPS/Images/my pic.png': new Uint8Array([2, 4, 6]),
    });

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].imageAssets.get('my pic.png')).toMatchObject({
      filename: 'my pic.png',
      href: 'OPS/Images/my pic.png',
      manifestId: 'fig1',
      manifestHref: 'Images/my%20pic.png',
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(zip.file('OPS/Images/my pic.png')).not.toBeNull();
    expect(opf?.match(/media-type="image\/png"/gu)).toHaveLength(1);
    expect(opf).toContain('<item id="fig1" href="Images/my%20pic.png" media-type="image/png"/>');
    expect(opf).not.toContain('href="Images/my pic.png"');
    expect(chapter).toContain('<img src="../Images/my%20pic.png" alt="encoded"');
  });

  it('loads and exports chapters whose OPF hrefs are percent-encoded', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>encoded chapter</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter%201.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter 1.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].href).toBe('OPS/Text/chapter 1.xhtml');
    editor.updateParagraph(0, 0, { text: '更新本文' });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter 1.xhtml')?.async('string');

    expect(opf).toContain('href="Text/chapter%201.xhtml"');
    expect(zip.file('OPS/Text/chapter%201.xhtml')).toBeNull();
    expect(chapter).toContain('<p>更新本文</p>');
  });

  it('links added images correctly when a chapter sits directly under the OPF directory', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>直下章</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.addImage(0, {
      filename: 'inserted.png',
      mediaType: 'image/png',
      data: new Uint8Array([4, 5, 6]),
      alt: '挿絵',
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/chapter.xhtml')?.async('string');
    const image = await zip.file('OPS/Images/inserted.png')?.async('uint8array');

    expect(chapter).toContain('<img src="Images/inserted.png" alt="挿絵"');
    expect(chapter).not.toContain('../Images/inserted.png');
    expect(Array.from(image ?? [])).toEqual([4, 5, 6]);
  });

  it('keeps v0.5 image filenames inside the EPUB Images directory', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    const assetKey = editor.addImage(0, {
      filename: '../outside.png',
      mediaType: 'image/png',
      data: new Uint8Array([7, 8, 9]),
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(assetKey).toBe('outside.png');
    expect(zip.file('OPS/Images/outside.png')).not.toBeNull();
    expect(zip.file('OPS/outside.png')).toBeNull();
    expect(opf).toContain('href="Images/outside.png"');
    expect(chapter).toContain('<img src="../Images/outside.png" alt=""');
  });

  it('rejects empty image filenames without recording history', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    expect(() =>
      editor.addImage(0, {
        filename: '../',
        data: new Uint8Array([1]),
      }),
    ).toThrow(/Image filename must not be empty/);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.chapters[0].blocks).toHaveLength(1);
    expect(editor.chapters[0].imageAssets.size).toBe(0);

    expect(() =>
      editor.addImage(0, {
        href: 'OPS/Images/',
        mediaType: 'image/png',
        data: new Uint8Array([1]),
      }),
    ).toThrow(/Image filename must not be empty/);
    expect(editor.history.canUndo).toBe(false);
  });

  it('uniques repeated added image filenames so blocks do not overwrite assets', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    const firstKey = editor.addImage(0, {
      filename: 'dup.png',
      mediaType: 'image/png',
      data: new Uint8Array([1]),
      alt: '一枚目',
    });
    const secondKey = editor.addImage(0, {
      filename: 'dup.png',
      data: new Uint8Array([2]),
      alt: '二枚目',
    });

    expect(firstKey).toBe('dup.png');
    expect(secondKey).toBe('dup-2.png');

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');
    const firstImage = await zip.file('OPS/Images/dup.png')?.async('uint8array');
    const secondImage = await zip.file('OPS/Images/dup-2.png')?.async('uint8array');

    expect(Array.from(firstImage ?? [])).toEqual([1]);
    expect(Array.from(secondImage ?? [])).toEqual([2]);
    expect(opf).toContain('id="img-dup-png" href="Images/dup.png" media-type="image/png"');
    expect(opf).toContain('id="img-dup-2-png" href="Images/dup-2.png" media-type="image/png"');
    expect(chapter).toContain('<img src="../Images/dup.png" alt="一枚目"');
    expect(chapter).toContain('<img src="../Images/dup-2.png" alt="二枚目"');
  });

  it('uniques added image filenames against existing package files', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `${opfXml.replace(
        '</manifest>',
        '<item id="cover" href="Images/cover.png" media-type="image/png" /></manifest>',
      )}`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      'OPS/Images/cover.png': new Uint8Array([9]),
    });

    const editor = await EditableEpub.load(data);
    const key = editor.addImage(0, {
      filename: 'cover.png',
      data: new Uint8Array([1]),
      alt: '追加画像',
    });

    expect(key).toBe('cover-2.png');
    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    expect(Array.from((await zip.file('OPS/Images/cover.png')?.async('uint8array')) ?? [])).toEqual(
      [9],
    );
    expect(
      Array.from((await zip.file('OPS/Images/cover-2.png')?.async('uint8array')) ?? []),
    ).toEqual([1]);
  });

  it('uniques added image filenames across chapters so files do not overwrite', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>複数章画像</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="c2" href="Text/chapter-2.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
    <itemref idref="c2" />
  </spine>
</package>`,
      'OPS/Text/chapter-1.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>一章</p></body></html>`,
      'OPS/Text/chapter-2.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>二章</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    const firstKey = editor.addImage(0, {
      filename: 'dup.png',
      data: new Uint8Array([1]),
      alt: '一章画像',
    });
    const secondKey = editor.addImage(1, {
      filename: 'dup.png',
      data: new Uint8Array([2]),
      alt: '二章画像',
    });

    expect(firstKey).toBe('dup.png');
    expect(secondKey).toBe('dup-2.png');

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const firstImage = await zip.file('OPS/Images/dup.png')?.async('uint8array');
    const secondImage = await zip.file('OPS/Images/dup-2.png')?.async('uint8array');
    const firstChapter = await zip.file('OPS/Text/chapter-1.xhtml')?.async('string');
    const secondChapter = await zip.file('OPS/Text/chapter-2.xhtml')?.async('string');

    expect(Array.from(firstImage ?? [])).toEqual([1]);
    expect(Array.from(secondImage ?? [])).toEqual([2]);
    expect(firstChapter).toContain('<img src="../Images/dup.png" alt="一章画像"');
    expect(secondChapter).toContain('<img src="../Images/dup-2.png" alt="二章画像"');
  });

  it('adds a unique manifest id when an inserted image id collides with an existing item', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>manifest id collision</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="img-dup-png" href="Styles/style.css" media-type="text/css" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      'OPS/Styles/style.css': 'body { margin: 0; }',
    });

    const editor = await EditableEpub.load(data);
    editor.addImage(0, {
      filename: 'dup.png',
      data: new Uint8Array([1]),
      mediaType: 'image/png',
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');

    expect(opf).toContain('id="img-dup-png" href="Styles/style.css" media-type="text/css"');
    expect(opf).toContain('id="img-dup-png-2" href="Images/dup.png" media-type="image/png"');
  });

  it('supports the v0.4 addImage shape (filename inferred from href, afterParagraph index)', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文1</p><p>本文2</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    editor.addImage(0, {
      href: 'OPS/Images/legacy.png',
      mediaType: 'image/png',
      data: new Uint8Array([1, 2, 3]),
      alt: '挿絵',
      afterParagraph: 0,
    });

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    // The image block should sit between the two paragraphs.
    expect(chapter).toMatch(/<p>本文1<\/p>[\s\S]*<figure[\s\S]*<\/figure>[\s\S]*<p>本文2<\/p>/u);
  });

  it('inserts, splits, merges, moves, and deletes paragraph blocks', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>あいうえお</p><p>かきくけこ</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const chapter = editor.chapters[0];

    // Initial: [P(あいうえお), P(かきくけこ)]
    const firstId = chapter.blocks[0].id;

    // Split first paragraph after 'あい'.
    const [leftId, rightId] = editor.splitParagraph(0, firstId, 2);
    expect(chapter.blocks.length).toBe(3);
    expect(chapter.paragraphs.map((p) => p.text)).toEqual(['あい', 'うえお', 'かきくけこ']);

    // Merge them back.
    const mergedId = editor.mergeParagraphs(0, leftId, rightId);
    expect(chapter.blocks.length).toBe(2);
    expect(chapter.paragraphs[0].text).toBe('あいうえお');
    expect(mergedId).toBe(leftId);

    // Insert a new heading at the top.
    const headingId = editor.insertParagraph(0, 0, {
      text: 'タイトル',
      paragraphKind: 'heading',
      headingLevel: 1,
    });
    expect(chapter.blocks[0].id).toBe(headingId);
    expect(chapter.paragraphs[0].headingLevel).toBe(1);

    // Move the heading to the end, then delete it.
    editor.moveBlock(0, headingId, 99);
    expect(chapter.blocks[chapter.blocks.length - 1].id).toBe(headingId);
    editor.deleteBlock(0, headingId);
    expect(chapter.blocks.find((b) => b.id === headingId)).toBeUndefined();

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chap = await zip.file('OPS/Text/chapter.xhtml')?.async('string');
    expect(chap).toContain('<p>あいうえお</p>');
    expect(chap).toContain('<p>かきくけこ</p>');
  });

  it('preserves contained inline annotation offsets when splitting and merging paragraphs', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>あいうえおかきくけこ</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const chapter = editor.chapters[0];
    const firstId = chapter.blocks[0].id;
    editor.updateParagraph(0, 0, {
      inlineAnnotations: [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'あい', type: 'group' },
        { kind: 'strong', startIndex: 5, endIndex: 7 },
        { kind: 'em', startIndex: 3, endIndex: 6 },
      ],
    });

    const [leftId, rightId] = editor.splitParagraph(0, firstId, 4);
    expect(chapter.paragraphs.map((p) => p.text)).toEqual(['あいうえ', 'おかきくけこ']);
    expect(chapter.paragraphs[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'あい', type: 'group' },
    ]);
    expect(chapter.paragraphs[1].inlineAnnotations).toEqual([
      { kind: 'strong', startIndex: 1, endIndex: 3 },
    ]);

    editor.mergeParagraphs(0, leftId, rightId);
    expect(chapter.paragraphs[0].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'あい', type: 'group' },
      { kind: 'strong', startIndex: 5, endIndex: 7 },
    ]);
  });

  it('can clear a heading level with a partial paragraph update', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>見出し</h2></body></html>`,
    });
    const editor = await EditableEpub.load(data);

    expect(editor.chapters[0].paragraphs[0].headingLevel).toBe(2);
    editor.updateParagraph(0, 0, { headingLevel: undefined });
    expect(editor.chapters[0].paragraphs[0].headingLevel).toBeUndefined();

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');
    expect(chapter).toContain('<p>見出し</p>');
    expect(chapter).not.toContain('<h2>見出し</h2>');
  });

  it('updates image block alt, caption, and placement', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    editor.addImage(0, {
      filename: 'pic.png',
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
    const chapter = editor.chapters[0];
    const imgBlock = chapter.blocks.find((b) => b.kind === 'image');
    if (!imgBlock) throw new Error('missing image block');

    editor.updateImage(0, imgBlock.id, {
      alt: '更新後',
      placement: 'fullspread',
    });
    editor.setImageCaption(0, imgBlock.id, 'キャプション更新');

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const chap = await zip.file('OPS/Text/chapter.xhtml')?.async('string');
    expect(chap).toContain('alt="更新後"');
    expect(chap).toContain('data-placement="fullspread"');
    expect(chap).toContain('<figcaption>キャプション更新</figcaption>');
  });

  it('removes the asset when its last referencing block is deleted', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const assetKey = editor.addImage(0, {
      filename: 'orphan.png',
      data: new Uint8Array([1]),
      mediaType: 'image/png',
    });
    expect(editor.chapters[0].imageAssets.has(assetKey)).toBe(true);
    editor.removeImage(0, assetKey);
    expect(editor.chapters[0].imageAssets.has(assetKey)).toBe(false);
  });

  it('removes an image asset when deleteBlock deletes its last referencing image block', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const assetKey = editor.addImage(0, {
      filename: 'delete-block.png',
      data: new Uint8Array([1]),
      mediaType: 'image/png',
    });
    const imageBlock = editor.chapters[0].blocks.find((block) => block.kind === 'image');
    if (!imageBlock) throw new Error('missing image block');

    editor.deleteBlock(0, imageBlock.id);

    expect(editor.chapters[0].imageAssets.has(assetKey)).toBe(false);
    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(zip.file('OPS/Images/delete-block.png')).toBeNull();
    expect(opf).not.toContain('delete-block.png');
    expect(chapter).not.toContain('<figure');
  });

  it('removes existing image files and manifest entries when their block is deleted', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>画像削除</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="fig1" href="Media/existing.webp" media-type="image/webp" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p><figure><img src="../Media/existing.webp" alt="既存" /></figure></body></html>`,
      'OPS/Media/existing.webp': new Uint8Array([5, 4, 3]),
    });
    const editor = await EditableEpub.load(data);
    const imageBlock = editor.chapters[0].blocks.find((block) => block.kind === 'image');
    if (!imageBlock) throw new Error('missing image block');

    editor.removeImage(0, imageBlock.id);
    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

    expect(zip.file('OPS/Media/existing.webp')).toBeNull();
    expect(opf).not.toContain('Media/existing.webp');
    expect(chapter).not.toContain('<figure');
    expect(chapter).toContain('<p>本文</p>');
  });

  it('keeps a shared existing image when another chapter still references it', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>共有画像</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="c2" href="Text/chapter-2.xhtml" media-type="application/xhtml+xml" />
    <item id="fig1" href="Media/shared.webp" media-type="image/webp" />
  </manifest>
  <spine>
    <itemref idref="c1" />
    <itemref idref="c2" />
  </spine>
</package>`,
      'OPS/Text/chapter-1.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>一章</p><figure><img src="../Media/shared.webp" alt="共有1" /></figure></body></html>`,
      'OPS/Text/chapter-2.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>二章</p><figure><img src="../Media/shared.webp" alt="共有2" /></figure></body></html>`,
      'OPS/Media/shared.webp': new Uint8Array([5, 4, 3]),
    });
    const editor = await EditableEpub.load(data);
    const imageBlock = editor.chapters[0].blocks.find((block) => block.kind === 'image');
    if (!imageBlock) throw new Error('missing image block');

    editor.removeImage(0, imageBlock.id);
    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const firstChapter = await zip.file('OPS/Text/chapter-1.xhtml')?.async('string');
    const secondChapter = await zip.file('OPS/Text/chapter-2.xhtml')?.async('string');
    const sharedImage = await zip.file('OPS/Media/shared.webp')?.async('uint8array');

    expect(Array.from(sharedImage ?? [])).toEqual([5, 4, 3]);
    expect(opf).toContain('href="Media/shared.webp"');
    expect(opf).toContain('media-type="image/webp"');
    expect(firstChapter).not.toContain('<figure');
    expect(firstChapter).toContain('<p>一章</p>');
    expect(secondChapter).toContain('<img src="../Media/shared.webp" alt="共有2"');
  });

  it('records, undoes, and redoes paragraph edits via the history API', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    expect(editor.history.canUndo).toBe(false);

    editor.updateParagraph(0, 0, { text: '校正1' });
    editor.updateParagraph(0, 0, { text: '校正2' });
    expect(editor.history.depth).toBe(2);
    expect(editor.chapters[0].paragraphs[0].text).toBe('校正2');

    expect(editor.undo()).toBe(true);
    expect(editor.chapters[0].paragraphs[0].text).toBe('校正1');
    expect(editor.history.canRedo).toBe(true);

    expect(editor.redo()).toBe(true);
    expect(editor.chapters[0].paragraphs[0].text).toBe('校正2');

    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.chapters[0].paragraphs[0].text).toBe('本文');
    expect(editor.undo()).toBe(false);
  });

  it('folds nested edits into a single transaction entry', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文1</p><p>本文2</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const firstId = editor.chapters[0].blocks[0].id;

    editor.transaction(() => {
      editor.updateParagraph(0, 0, { text: '校正1' });
      editor.updateParagraph(0, 1, { text: '校正2' });
      editor.splitParagraph(0, firstId, 1);
    });
    expect(editor.history.depth).toBe(1);
    expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual(['校', '正1', '校正2']);

    editor.undo();
    expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual(['本文1', '本文2']);
  });

  it('keeps the outer history entry open after a successful nested transaction', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文1</p><p>本文2</p><p>本文3</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);

    editor.transaction(() => {
      editor.updateParagraph(0, 0, { text: '外側1' });
      editor.transaction(() => {
        editor.updateParagraph(0, 1, { text: '内側' });
      });
      editor.updateParagraph(0, 2, { text: '外側2' });
    });

    expect(editor.history.depth).toBe(1);
    expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual(['外側1', '内側', '外側2']);
    editor.undo();
    expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual(['本文1', '本文2', '本文3']);
  });

  it('rolls back a failing transaction', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    expect(() =>
      editor.transaction(() => {
        editor.updateParagraph(0, 0, { text: '校正中' });
        throw new Error('boom');
      }),
    ).toThrow(/boom/);

    expect(editor.chapters[0].paragraphs[0].text).toBe('本文');
    expect(editor.history.canUndo).toBe(false);
  });

  it('does not record history for failed paragraph and block operations', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文1</p><p>本文2</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const firstId = editor.chapters[0].blocks[0].id;

    expect(() => editor.updateParagraph(0, 99, { text: 'なし' })).toThrow(/Missing paragraph: 99/);
    expect(() => editor.setInlineAnnotations(0, 99, [])).toThrow(/Missing paragraph: 99/);
    expect(() => editor.insertParagraph(99, 0, { text: 'なし' })).toThrow(/Missing chapter: 99/);
    expect(() => editor.deleteBlock(0, 'missing')).toThrow(/Missing block: missing/);
    expect(() => editor.moveBlock(0, 'missing', 0)).toThrow(/Missing block: missing/);
    expect(() => editor.mergeParagraphs(0, firstId, 'missing')).toThrow(/Merge target missing/);

    expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual(['本文1', '本文2']);
    expect(editor.history.depth).toBe(0);
    expect(editor.history.canUndo).toBe(false);
  });

  it('does not record history for failed image operations', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>画像履歴</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="fig1" href="Media/existing.webp" media-type="image/webp" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p><figure><img src="../Media/existing.webp" alt="既存" /></figure></body></html>`,
      'OPS/Media/existing.webp': new Uint8Array([5, 4, 3]),
    });
    const editor = await EditableEpub.load(data);
    const imageBlock = editor.chapters[0].blocks.find((block) => block.kind === 'image');
    if (!imageBlock) throw new Error('missing image block');

    expect(() => editor.splitParagraph(0, imageBlock.id, 1)).toThrow(
      /Cannot split non-paragraph block/,
    );
    expect(() => editor.addImage(99, { filename: 'new.png', data: new Uint8Array([1]) })).toThrow(
      /Missing chapter: 99/,
    );
    expect(() =>
      editor.addImage(0, {
        filename: 'new.png',
        data: new Uint8Array([1]),
        afterBlockId: 'missing',
      }),
    ).toThrow(/Missing block: missing/);
    expect(() => editor.removeImage(0, 'missing')).toThrow(/Missing image block or asset/);
    expect(() => editor.updateImage(0, 'missing', { alt: 'なし' })).toThrow(
      /Missing image block: missing/,
    );

    expect(editor.chapters[0].blocks.map((block) => block.kind)).toEqual(['paragraph', 'image']);
    expect(editor.chapters[0].imageAssets.has('new.png')).toBe(false);
    expect(editor.history.depth).toBe(0);
    expect(editor.history.canUndo).toBe(false);
  });

  it('wraps non-ZIP buffers with a friendly "Not a valid EPUB file" error', async () => {
    const garbage = new TextEncoder().encode('not a zip file at all').buffer;
    await expect(EditableEpub.load(garbage)).rejects.toThrow(/Not a valid EPUB file/);
  });

  it('throws "Failed to parse chapter XHTML" with the failing href for malformed chapter content', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': '<html><body><p>unterminated',
    });
    await expect(EditableEpub.load(data)).rejects.toThrow(
      /Failed to parse chapter XHTML: OPS\/Text\/chapter\.xhtml/,
    );
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
    <item id="c1" href="Text/chapter%E0%A4%A.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
    });

    await expect(EditableEpub.load(data)).rejects.toThrow(
      'Invalid EPUB href: Text/chapter%E0%A4%A.xhtml',
    );
  });

  it('reports serialize and zip progress during export', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const events: Array<['serialize' | 'zip', number]> = [];
    await editor.export({
      onProgress: (phase, ratio) => events.push([phase, ratio]),
    });
    expect(events.some(([phase, ratio]) => phase === 'serialize' && ratio === 1)).toBe(true);
    expect(events.some(([phase]) => phase === 'zip')).toBe(true);
  });

  it('aborts export when the signal is already triggered', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });
    const editor = await EditableEpub.load(data);
    const controller = new AbortController();
    controller.abort();
    await expect(editor.export({ signal: controller.signal })).rejects.toThrow();
  });

  it('exports a spec-compatible OCF mimetype entry first and uncompressed', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
    });

    const editor = await EditableEpub.load(data);
    const out = await editor.export();
    const bytes = new Uint8Array(out);
    const view = new DataView(out);
    const fileNameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + fileNameLength));
    const contentsStart = 30 + fileNameLength + extraLength;
    const contents = new TextDecoder().decode(
      bytes.slice(contentsStart, contentsStart + 'application/epub+zip'.length),
    );

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(name).toBe('mimetype');
    expect(contents).toBe('application/epub+zip');
  });

  it('keeps a chapter clean when the low-level image helper rejects its target', async () => {
    const originalChapter = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="keep" content="yes" /></head><body><p>本文</p><aside>注記</aside></body></html>`;
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': originalChapter,
    });
    const editor = await EditableEpub.load(data);

    expect(() =>
      addEpubChapterImage(editor.book, 0, {
        filename: 'figure.png',
        data: new Uint8Array([1]),
        afterBlockId: 'missing',
      }),
    ).toThrow(/Missing block/);
    expect(editor.chapters[0].isDirty).toBeUndefined();

    const out = await editor.export();
    const zip = await JSZip.loadAsync(out);
    await expect(zip.file('OPS/Text/chapter.xhtml')?.async('string')).resolves.toBe(
      originalChapter,
    );
  });

  describe('assetResolver', () => {
    it('lazily resolves URL-only image assets via the provided resolver', async () => {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      });

      const editor = await EditableEpub.load(data);
      editor.addImage(0, {
        filename: 'remote.png',
        mediaType: 'image/png',
        url: 'https://cdn.example.com/cover/remote.png',
        alt: 'remote',
      });

      const calls: Array<{ assetKey: string; url: string }> = [];
      const out = await editor.export({
        assetResolver(request) {
          calls.push({ assetKey: request.assetKey, url: request.url });
          return new Uint8Array([42, 43, 44]);
        },
      });

      const zip = await JSZip.loadAsync(out);
      const stored = await zip.file('OPS/Images/remote.png')?.async('uint8array');
      expect(Array.from(stored ?? [])).toEqual([42, 43, 44]);
      expect(calls).toEqual([
        { assetKey: 'remote.png', url: 'https://cdn.example.com/cover/remote.png' },
      ]);
    });

    it('passes the export AbortSignal through to the resolver', async () => {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      });

      const editor = await EditableEpub.load(data);
      editor.addImage(0, {
        filename: 'remote.png',
        url: 'https://cdn.example.com/remote.png',
      });

      const controller = new AbortController();
      const seen: AbortSignal[] = [];
      await editor.export({
        signal: controller.signal,
        assetResolver(request) {
          if (request.signal) seen.push(request.signal);
          return new Uint8Array([1]);
        },
      });

      expect(seen).toEqual([controller.signal]);
    });

    it('prefers inline `data` over `url` when both are set', async () => {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      });

      const editor = await EditableEpub.load(data);
      editor.addImage(0, {
        filename: 'inline.png',
        data: new Uint8Array([7, 7, 7]),
      });
      // Manually attach a url to the stored asset; data must still win.
      const asset = editor.chapters[0].imageAssets.get('inline.png');
      if (asset) asset.url = 'https://example.com/should-be-ignored.png';

      let resolverCalled = false;
      const out = await editor.export({
        assetResolver() {
          resolverCalled = true;
          return new Uint8Array([0]);
        },
      });

      const zip = await JSZip.loadAsync(out);
      const stored = await zip.file('OPS/Images/inline.png')?.async('uint8array');
      expect(Array.from(stored ?? [])).toEqual([7, 7, 7]);
      expect(resolverCalled).toBe(false);
    });

    it('throws a descriptive error when an asset has neither `data` nor `url`', async () => {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      });

      const editor = await EditableEpub.load(data);
      editor.addImage(0, {
        filename: 'orphan.png',
        data: new Uint8Array([1]),
      });
      const asset = editor.chapters[0].imageAssets.get('orphan.png');
      // Force the invalid state to exercise the export-time guard.
      if (asset) asset.data = undefined;

      await expect(editor.export()).rejects.toThrow(/has neither `data` nor `url`/);
    });

    it('rejects addImage inputs that provide neither `data` nor `url`', async () => {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      });

      const editor = await EditableEpub.load(data);
      editor.updateParagraph(0, 0, { text: '編集済み' });
      expect(editor.undo()).toBe(true);
      expect(editor.history).toMatchObject({ depth: 0, redoDepth: 1, canRedo: true });

      // Cast required because the runtime check is the safety net under the
      // discriminated union; TypeScript already rejects this at compile time.
      expect(() =>
        editor.addImage(0, { filename: 'empty.png' } as Parameters<typeof editor.addImage>[1]),
      ).toThrow(/must include either `data` or `url`/);

      expect(editor.chapters[0].paragraphs[0].text).toBe('本文');
      expect(editor.chapters[0].imageAssets.has('empty.png')).toBe(false);
      expect(editor.history).toMatchObject({ depth: 0, redoDepth: 1, canRedo: true });
    });
  });

  describe('exported chapter XHTML', () => {
    it('writes exactly one XML declaration at the start of an edited chapter', async () => {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章</title></head><body><p>本文</p></body></html>`,
      });

      const editor = await EditableEpub.load(data);
      editor.updateParagraph(0, 0, { text: '編集済み' });
      const out = await editor.export();
      const zip = await JSZip.loadAsync(out);
      const chapter = (await zip.file('OPS/Text/chapter.xhtml')?.async('string')) ?? '';

      expect(chapter.match(/<\?xml/gu) ?? []).toHaveLength(1);
      expect(chapter.indexOf('<?xml')).toBe(0);

      const reparsed = new DOMParser().parseFromString(chapter, 'application/xml');
      expect(reparsed.getElementsByTagName('parsererror')).toHaveLength(0);
      expect(reparsed.getElementsByTagName('p')[0]?.textContent).toBe('編集済み');

      // The exported archive must survive a full re-import.
      const reloaded = await EditableEpub.load(out);
      expect(reloaded.chapters[0].paragraphs[0].text).toBe('編集済み');
    });

    it('writes exactly one XML declaration when the chapter shell is rebuilt from scratch', async () => {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文</p></body></html>`,
      });

      const editor = await EditableEpub.load(data);
      // Without a reusable source document the serializer builds the chapter
      // from its own skeleton, which carries its own declaration.
      editor.chapters[0].originalXhtml = '';
      editor.updateParagraph(0, 0, { text: '骨組み' });
      const out = await editor.export();
      const zip = await JSZip.loadAsync(out);
      const chapter = (await zip.file('OPS/Text/chapter.xhtml')?.async('string')) ?? '';

      expect(chapter.match(/<\?xml/gu) ?? []).toHaveLength(1);
      expect(chapter.indexOf('<?xml')).toBe(0);
      const reparsed = new DOMParser().parseFromString(chapter, 'application/xml');
      expect(reparsed.getElementsByTagName('parsererror')).toHaveLength(0);
    });
  });

  describe('inline annotation anchoring', () => {
    async function loadRubyChapter(): Promise<EditableEpub> {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': opfXml,
        'OPS/Text/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>むかしむかし<ruby>漢字<rt>かんじ</rt></ruby>がありました</p></body></html>`,
      });
      return EditableEpub.load(data);
    }

    function annotationBases(paragraph: AnnotatedParagraph): string[] {
      const chars = [...paragraph.text];
      return paragraph.inlineAnnotations.map((ann) =>
        chars.slice(ann.startIndex, ann.endIndex).join(''),
      );
    }

    function expectAnnotationsInRange(paragraph: AnnotatedParagraph): void {
      const length = [...paragraph.text].length;
      for (const ann of paragraph.inlineAnnotations) {
        expect(ann.startIndex).toBeGreaterThanOrEqual(0);
        expect(ann.endIndex).toBeGreaterThan(ann.startIndex);
        expect(ann.endIndex).toBeLessThanOrEqual(length);
      }
    }

    it('keeps annotations over the same base text when the prefix is shortened', async () => {
      const editor = await loadRubyChapter();
      const before = annotationBases(editor.chapters[0].paragraphs[0]);
      expect(before).toEqual(['漢字']);

      editor.updateParagraph(0, 0, { text: 'むかし漢字がありました' });

      const after = editor.chapters[0].paragraphs[0];
      expectAnnotationsInRange(after);
      expect(annotationBases(after)).toEqual(before);

      const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
      book.setPageSize({ pageWidth: 400, lineWidth: 200 });
      await expect(book.layoutChapter({ paragraphs: [after] })).resolves.toBeDefined();
    });

    it('keeps annotations over the same base text when the suffix is shortened', async () => {
      const editor = await loadRubyChapter();

      editor.updateParagraph(0, 0, { text: 'むかしむかし漢字が' });

      const after = editor.chapters[0].paragraphs[0];
      expectAnnotationsInRange(after);
      expect(annotationBases(after)).toEqual(['漢字']);
    });

    it('drops annotations whose base characters were edited away', async () => {
      const editor = await loadRubyChapter();

      editor.updateParagraph(0, 0, { text: 'むかしむかしがありました' });

      const after = editor.chapters[0].paragraphs[0];
      expect(after.inlineAnnotations).toEqual([]);
      expectAnnotationsInRange(after);

      const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
      book.setPageSize({ pageWidth: 400, lineWidth: 200 });
      await expect(book.layoutChapter({ paragraphs: [after] })).resolves.toBeDefined();
    });

    it('exports a text-only update without corrupting the ruby base', async () => {
      const editor = await loadRubyChapter();
      editor.updateParagraph(0, 0, { text: 'むかし漢字がありました' });

      const zip = await JSZip.loadAsync(await editor.export());
      const chapter = await zip.file('OPS/Text/chapter.xhtml')?.async('string');

      expect(chapter).toContain('<p>むかし<ruby>漢字<rt>かんじ</rt></ruby>がありました</p>');
    });

    it('drops explicitly supplied annotations that fall outside the paragraph text', async () => {
      const editor = await loadRubyChapter();

      editor.setInlineAnnotations(0, 0, [
        { kind: 'emphasis', startIndex: 0, endIndex: 2, style: 'dot' },
        { kind: 'ruby', startIndex: 90, endIndex: 99, rubyText: 'そと', type: 'group' },
        { kind: 'tcy', startIndex: 3, endIndex: 3 },
      ]);

      const after = editor.chapters[0].paragraphs[0];
      expect(after.inlineAnnotations).toEqual([
        { kind: 'emphasis', startIndex: 0, endIndex: 2, style: 'dot' },
      ]);
      expectAnnotationsInRange(after);
    });

    it('drops out-of-range annotations supplied alongside a text update', async () => {
      const editor = await loadRubyChapter();

      editor.updateParagraph(0, 0, {
        text: '短い',
        inlineAnnotations: [
          { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'みじか', type: 'group' },
          { kind: 'ruby', startIndex: 5, endIndex: 8, rubyText: 'なし', type: 'group' },
        ],
      });

      const after = editor.chapters[0].paragraphs[0];
      expect(after.inlineAnnotations).toHaveLength(1);
      expectAnnotationsInRange(after);
    });
  });

  describe('import parity with parseEpub', () => {
    async function makeMixedSpineEpub(): Promise<ArrayBuffer> {
      return makeEpub({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>取り込み</dc:title>
    <dc:creator>作者</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="cover-image" />
    <item id="css" href="Styles/style.css" media-type="text/css" />
    <item id="skip" href="Text/skip.xhtml" media-type="application/xhtml+xml" />
    <item id="missing" href="Text/missing.xhtml" media-type="application/xhtml+xml" />
    <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml" />
    <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="nav" />
    <itemref idref="cover" />
    <itemref idref="css" />
    <itemref idref="skip" linear="no" />
    <itemref idref="missing" />
    <itemref idref="c1" />
    <itemref idref="c2" />
  </spine>
</package>`,
        'OPS/nav.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc"><ol>
      <li><a href="Text/ch1.xhtml">第一章</a></li>
      <li><a href="Text/ch2.xhtml">目次側の題</a></li>
    </ol></nav>
  </body>
</html>`,
        'OPS/cover.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>表紙</p></body></html>`,
        'OPS/Styles/style.css': 'html { writing-mode: vertical-rl; }',
        'OPS/Text/skip.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>付録</p></body></html>`,
        // OPS/Text/missing.xhtml is intentionally absent from the archive.
        'OPS/Text/ch1.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本文一</p></body></html>`,
        'OPS/Text/ch2.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章</h1><p>本文二</p></body></html>`,
      });
    }

    it('selects the same chapters, titles, and page progression as the reader', async () => {
      const data = await makeMixedSpineEpub();

      const reader = await parseEpub(data);
      const editor = await EditableEpub.load(data);

      expect(editor.chapters.map((chapter) => chapter.href)).toEqual([
        'OPS/Text/ch1.xhtml',
        'OPS/Text/ch2.xhtml',
      ]);
      expect(editor.chapters.map((chapter) => chapter.title)).toEqual(
        reader.chapters.map((chapter) => chapter.title),
      );
      expect(editor.chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章']);
      expect(
        editor.chapters.map((chapter) => chapter.paragraphs.map((paragraph) => paragraph.text)),
      ).toEqual(reader.chapters.map((chapter) => chapter.paragraphs.map((p) => p.text)));
      expect(editor.book.pageProgressionDirection).toBe(reader.pageProgressionDirection);
      expect(editor.book.pageProgressionDirection).toBe('rtl');
      expect(editor.title).toBe(reader.title);
      expect(editor.author).toBe(reader.author);
    });

    it('keeps skipped spine documents in the package so export round-trips them', async () => {
      const data = await makeMixedSpineEpub();
      const editor = await EditableEpub.load(data);
      editor.updateParagraph(0, 0, { text: '編集済み' });

      const zip = await JSZip.loadAsync(await editor.export());

      for (const path of [
        'OPS/nav.xhtml',
        'OPS/cover.xhtml',
        'OPS/Styles/style.css',
        'OPS/Text/skip.xhtml',
      ]) {
        expect(zip.file(path)).not.toBeNull();
      }
      await expect(zip.file('OPS/Text/ch1.xhtml')?.async('string')).resolves.toContain('編集済み');
    });
  });

  describe('export snapshot', () => {
    const twoChapterOpf = `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>スナップショット</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="c2" href="Text/chapter-2.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
    <itemref idref="c2" />
  </spine>
</package>`;

    async function loadTwoChapterEditor(): Promise<EditableEpub> {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml,
        'OPS/package.opf': twoChapterOpf,
        'OPS/Text/chapter-1.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>第一章</p></body></html>`,
        'OPS/Text/chapter-2.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>第二章</p></body></html>`,
      });
      return EditableEpub.load(data);
    }

    async function readPackage(out: ArrayBuffer): Promise<Record<string, string | undefined>> {
      const zip = await JSZip.loadAsync(out);
      return {
        first: await zip.file('OPS/Text/chapter-1.xhtml')?.async('string'),
        second: await zip.file('OPS/Text/chapter-2.xhtml')?.async('string'),
        opf: await zip.file('OPS/package.opf')?.async('string'),
      };
    }

    it('ignores edits made while asset resolution is still pending', async () => {
      const editor = await loadTwoChapterEditor();
      editor.addImage(0, { filename: 'remote.png', url: 'https://example.com/remote.png' });

      // Reference output for the state the export is about to start from.
      const expected = await readPackage(
        await editor.export({ assetResolver: () => new Uint8Array([1, 2, 3]) }),
      );

      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const exporting = editor.export({
        async assetResolver() {
          await gate;
          return new Uint8Array([1, 2, 3]);
        },
      });

      // The export is now parked on the asset: chapter 1 is already serialized
      // and chapter 2 has not been reached yet. Edit both.
      editor.updateParagraph(0, 0, { text: '編集後一' });
      editor.updateParagraph(1, 0, { text: '編集後二' });
      release();

      await expect(readPackage(await exporting)).resolves.toEqual(expected);

      // The edits are not lost — they belong to the next export.
      expect(editor.chapters[0].paragraphs[0].text).toBe('編集後一');
      const later = await readPackage(
        await editor.export({ assetResolver: () => new Uint8Array([1, 2, 3]) }),
      );
      expect(later.first).toContain('編集後一');
      expect(later.second).toContain('編集後二');
    });

    it('keeps mid-export block insertions and deletions out of the running export', async () => {
      const editor = await loadTwoChapterEditor();
      editor.addImage(1, { filename: 'remote.png', url: 'https://example.com/remote.png' });

      const expected = await readPackage(
        await editor.export({ assetResolver: () => new Uint8Array([9]) }),
      );

      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const exporting = editor.export({
        async assetResolver() {
          await gate;
          return new Uint8Array([9]);
        },
      });

      editor.insertParagraph(0, 0, { text: '挿入' });
      editor.deleteBlock(1, editor.chapters[1].blocks[0].id);
      release();

      await expect(readPackage(await exporting)).resolves.toEqual(expected);
    });
  });
});
