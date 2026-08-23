/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EpubProject,
  manuscriptToEpubBook,
  parseEpub,
  parseManuscript,
  parseManuscriptRuby,
} from '../../src/epub/index.js';
import { manuscriptParagraphs } from '../../src/epub/manuscript-source.js';
import { stripStylesheetLinks } from '../../src/epub/xml-utils.js';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 200 })),
  );
});

/**
 * Reports whether a string carries a character XML 1.0 forbids: a C0 control
 * other than tab / line feed / carriage return, a lone surrogate, or one of the
 * two BMP non-characters.
 */
function hasXmlIllegalChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
    if (code >= 0xd800 && code <= 0xdfff) return true;
    if (code === 0xfffe || code === 0xffff) return true;
  }
  return false;
}

describe('EpubProject', () => {
  it('parses emphasis, tcy, em, strong, links, and footnote refs under the mejiro dialect', () => {
    const result = parseManuscript(
      '普通の《《重要》》文字と〔ABC〕と**強調**と*イタリック*と[リンク](https://example.test "例")と[[#fn1]]',
    );
    expect(result.text).toBe('普通の重要文字とABCと強調とイタリックとリンクと*fn1');
    const kinds = result.inlineAnnotations.map((ann) => ann.kind).sort();
    expect(kinds).toEqual(['em', 'emphasis', 'footnote', 'link', 'strong', 'tcy']);
    expect(result.inlineAnnotations.find((ann) => ann.kind === 'link')).toMatchObject({
      kind: 'link',
      href: 'https://example.test',
      title: '例',
    });
  });

  it('leaves malformed markdown links as plain text', () => {
    const result = parseManuscript('これは[リンク](https://example.test bad title)です');
    expect(result.text).toBe('これは[リンク](https://example.test bad title)です');
    expect(result.inlineAnnotations.some((ann) => ann.kind === 'link')).toBe(false);
  });

  it('narou dialect only emits ruby, leaving other markers as plain text', () => {
    const result = parseManuscript('《《これは強調じゃない》》漢字《かんじ》*not-em*', {
      dialect: 'narou',
    });
    expect(result.inlineAnnotations.map((ann) => ann.kind)).toEqual(['ruby']);
    expect(result.text).toContain('《《これは強調じゃない》》');
    expect(result.text).toContain('*not-em*');
  });

  it('parses common manuscript ruby notation', () => {
    expect(parseManuscriptRuby('これは｜漢字《かんじ》です')).toEqual({
      text: 'これは漢字です',
      inlineAnnotations: [
        { kind: 'ruby', startIndex: 3, endIndex: 5, rubyText: 'かんじ', type: 'group' },
      ],
    });

    expect(parseManuscriptRuby('山田《やまだ》太郎')).toEqual({
      text: '山田太郎',
      inlineAnnotations: [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'やまだ', type: 'group' },
      ],
    });
  });

  it('exports manuscript chapters as a parseable EPUB with ruby', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '投稿小説',
        author: '作者',
        identifier: 'urn:uuid:test-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      chapters: [
        {
          title: '第一話',
          body: 'これは｜漢字《かんじ》です。\n\n次の段落です。',
        },
      ],
    });

    const out = await project.export();
    const parsed = await parseEpub(out);

    expect(parsed.title).toBe('投稿小説');
    expect(parsed.author).toBe('作者');
    expect(parsed.chapters[0].title).toBe('投稿小説');
    expect(parsed.chapters[0].paragraphs.map((p) => p.text)).toContain('作者');
    expect(parsed.chapters[1].title).toBe('第一話');
    expect(parsed.chapters[1].paragraphs[1].text).toBe('これは漢字です。');
    expect(parsed.chapters[1].paragraphs[1].inlineAnnotations[0]).toMatchObject({
      kind: 'ruby',
      startIndex: 3,
      endIndex: 5,
      rubyText: 'かんじ',
      type: 'group',
    });
  });

  it('falls back to a generated identifier when metadata identifier is undefined or blank', () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'No identifier', identifier: undefined },
      chapters: [{ title: '一', body: '本文' }],
    });
    const blank = EpubProject.fromManuscript({
      metadata: { title: 'Blank identifier', identifier: '  ' },
      chapters: [{ title: '一', body: '本文' }],
    });

    expect(project.metadata.identifier).toMatch(/^urn:uuid:/u);
    expect(blank.metadata.identifier).toMatch(/^urn:uuid:/u);
    expect(project.metadata.identifier).not.toBe(blank.metadata.identifier);
  });

  it('rejects exporting a project without manuscript chapters', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'Empty', identifier: 'urn:uuid:empty' },
      chapters: [],
    });

    await expect(project.export()).rejects.toThrow(/without at least one chapter/);
  });

  it('threads manuscript dialect through project export', async () => {
    const chapters = [
      {
        title: '第一話',
        body: '《《これは強調じゃない》》漢字《かんじ》*not-em*',
      },
    ];
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '方言',
        identifier: 'urn:uuid:dialect-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      chapters,
      dialect: 'narou',
      includeTitlePage: false,
    });

    const parsed = await parseEpub(await project.export());
    const preview = manuscriptToEpubBook(chapters, { dialect: 'narou', title: '方言' });

    expect(parsed.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual(
      preview.chapters[0].paragraphs.map((paragraph) => paragraph.text),
    );
    expect(parsed.chapters[0].paragraphs[1].text).toBe('《《これは強調じゃない》》漢字*not-em*');
    expect(parsed.chapters[0].paragraphs[1].inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 13, endIndex: 15, rubyText: 'かんじ', type: 'group' },
    ]);
  });

  it('uses metadata language in chapter XHTML as well as package metadata', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: 'Language',
        language: 'en',
        identifier: 'urn:uuid:language-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      chapters: [{ title: 'One', body: 'Body.' }],
    });

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const xhtml = await zip.file('OPS/Text/chapter-001.xhtml')?.async('string');

    expect(opf).toContain('<dc:language>en</dc:language>');
    expect(xhtml).toContain('xml:lang="en" lang="en"');
  });

  it('emits rtl page progression by default and allows overrides', async () => {
    const rtlProject = new EpubProject({
      metadata: { title: 'rtl', identifier: 'urn:uuid:rtl-book' },
      chapters: [{ title: '一', body: '本文' }],
    });
    const rtlZip = await JSZip.loadAsync(await rtlProject.export());
    const rtlOpf = await rtlZip.file('OPS/package.opf')?.async('string');
    expect(rtlOpf).toContain('<spine page-progression-direction="rtl">');

    const ltrProject = new EpubProject({
      metadata: { title: 'ltr', identifier: 'urn:uuid:ltr-book' },
      chapters: [{ title: 'One', body: 'Body' }],
      pageProgressionDirection: 'ltr',
    });
    const ltrZip = await JSZip.loadAsync(await ltrProject.export());
    const ltrOpf = await ltrZip.file('OPS/package.opf')?.async('string');
    expect(ltrOpf).toContain('<spine page-progression-direction="ltr">');
  });

  it('treats a blank line as a paragraph boundary and a single newline as a line break', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '改行',
        identifier: 'urn:uuid:line-break-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      chapters: [
        {
          title: '本文',
          body: '一行目です。\n続きです。\n\n次の段落です。',
        },
      ],
    });

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const xhtml = await zip.file('OPS/Text/chapter-001.xhtml')?.async('string');
    const parsed = await parseEpub(out);
    const bodyParagraphs = parsed.chapters[1].paragraphs.map((paragraph) => paragraph.text);

    expect(xhtml).toContain('一行目です。<br />続きです。');
    expect(bodyParagraphs).toEqual(['本文', '一行目です。\n続きです。', '次の段落です。']);
  });

  it('exports paragraph indentation and scene dividers written with ideographic spaces', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '字下げ',
        identifier: 'urn:uuid:ideographic-space-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      includeTitlePage: false,
      chapters: [{ title: '一', body: '　一段落目です。\n\n　\n\n　二段落目です。' }],
    });

    const zip = await JSZip.loadAsync(await project.export());
    const xhtml = (await zip.file('OPS/Text/chapter-001.xhtml')?.async('string')) ?? '';

    expect(xhtml).toContain('<p>　一段落目です。</p>');
    expect(xhtml).toContain('<p>　</p>');
    expect(xhtml).toContain('<p>　二段落目です。</p>');
    expect(xhtml.match(/<p>/gu) ?? []).toHaveLength(3);
  });

  it('can place the book title at the beginning of the first chapter', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '吾輩は猫である',
        author: '夏目漱石',
        identifier: 'urn:uuid:first-chapter-title-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      includeTitlePage: false,
      includeTitleInFirstChapter: true,
      chapters: [{ title: '一', body: '吾輩は猫である。' }],
    });

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const xhtml = await zip.file('OPS/Text/chapter-001.xhtml')?.async('string');
    const parsed = await parseEpub(out);

    expect(opf).not.toContain('titlepage.xhtml');
    expect(xhtml).toContain('<h1>吾輩は猫である</h1>');
    expect(xhtml).toContain('<span id="chapter-title" hidden="">一</span>');
    expect(parsed.chapters[0].title).toBe('一');
    expect(parsed.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '吾輩は猫である',
      '吾輩は猫である。',
    ]);
  });

  it('supports updateChapter / removeChapter / reorderChapters', () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'ops', identifier: 'urn:uuid:chapter-ops-book' },
      chapters: [
        { title: '一', body: '本文1' },
        { title: '二', body: '本文2' },
        { title: '三', body: '本文3' },
      ],
    });

    project.updateChapter(1, { title: '二改', body: '改稿' });
    expect(project.chapters[1]).toMatchObject({ title: '二改', body: '改稿' });

    project.reorderChapters(0, 2);
    expect(project.chapters.map((c) => c.title)).toEqual(['二改', '三', '一']);

    project.removeChapter(0);
    expect(project.chapters.map((c) => c.title)).toEqual(['三', '一']);
  });

  it('leaves the chapter list untouched when reorderChapters gets an out-of-range from', () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'reorder bounds', identifier: 'urn:uuid:reorder-bounds' },
      chapters: [
        { title: '一', body: '本文1' },
        { title: '二', body: '本文2' },
      ],
    });

    expect(() => project.reorderChapters(5, 0)).not.toThrow();
    expect(() => project.reorderChapters(-1, 1)).not.toThrow();
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(['一', '二']);
  });

  it('clamps an out-of-range to in reorderChapters', () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'reorder clamp', identifier: 'urn:uuid:reorder-clamp' },
      chapters: [
        { title: '一', body: '本文1' },
        { title: '二', body: '本文2' },
        { title: '三', body: '本文3' },
      ],
    });

    project.reorderChapters(0, 99);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(['二', '三', '一']);

    project.reorderChapters(2, -5);
    expect(project.chapters.map((chapter) => chapter.title)).toEqual(['一', '二', '三']);
  });

  it('removes assets that were referenced only by a deleted chapter', () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'asset cleanup', identifier: 'urn:uuid:asset-cleanup' },
      chapters: [
        { title: '一', body: '本文1' },
        { title: '二', body: '本文2' },
      ],
    });
    project.addInlineImage(0, 1, {
      href: 'OPS/Images/only-first.png',
      data: new Uint8Array([1]),
    });
    project.addInlineImage(0, 2, {
      href: 'OPS/Images/shared.png',
      data: new Uint8Array([2]),
    });
    project.addInlineImage(1, 1, {
      href: 'OPS/Images/shared.png',
      data: new Uint8Array([3]),
    });
    project.addAsset({ href: 'OPS/Data/kept.bin', data: new Uint8Array([4]) });

    project.removeChapter(0);

    expect(project.assets.map((asset) => asset.href)).toEqual([
      'OPS/Images/shared-2.png',
      'OPS/Data/kept.bin',
    ]);
  });

  it('removes assets whose marker a chapter update deleted', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '差し替え', identifier: 'urn:uuid:update-chapter-cleanup' },
      cover: { href: 'OPS/Images/cover.png', data: new Uint8Array([9]) },
      chapters: [
        { title: '一', body: '本文1' },
        { title: '二', body: '本文2' },
      ],
    });
    project.addInlineImage(0, 1, { href: 'OPS/Images/dropped.png', data: new Uint8Array([1]) });
    project.addInlineImage(0, 2, { href: 'OPS/Images/kept.png', data: new Uint8Array([2]) });
    project.addInlineImage(1, 1, { href: 'OPS/Images/shared.png', data: new Uint8Array([3]) });
    project.addAsset({ href: 'OPS/Data/manual.bin', data: new Uint8Array([4]) });
    const keptMarker = manuscriptParagraphs(project.chapters[0].body)[2];
    const sharedMarker = manuscriptParagraphs(project.chapters[1].body)[1];

    project.updateChapter(0, { body: `改稿\n\n${keptMarker}\n\n${sharedMarker}` });

    expect(project.assets.map((asset) => asset.href)).toEqual([
      'OPS/Images/cover.png',
      'OPS/Images/kept.png',
      'OPS/Images/shared.png',
      'OPS/Data/manual.bin',
    ]);

    const zip = await JSZip.loadAsync(await project.export());
    const opf = (await zip.file('OPS/package.opf')?.async('string')) ?? '';

    expect(zip.file('OPS/Images/dropped.png')).toBeNull();
    expect(opf).not.toContain('dropped.png');
    expect(opf).toContain('href="Images/kept.png"');
    expect(opf).toContain('href="Images/shared.png"');
    expect(opf).toContain('href="Data/manual.bin"');
    expect(opf).toContain('href="Images/cover.png"');
  });

  it('keeps chapter assets when an update only changes the title', () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '改題', identifier: 'urn:uuid:update-chapter-title-only' },
      chapters: [{ title: '一', body: '本文' }],
    });
    project.addInlineImage(0, 1, { href: 'OPS/Images/figure.png', data: new Uint8Array([1]) });

    project.updateChapter(0, { title: '一改' });

    expect(project.chapters[0].title).toBe('一改');
    expect(project.assets.map((asset) => asset.href)).toEqual(['OPS/Images/figure.png']);
  });

  it('normalizes chapter and asset IDs used by OPF manifest and spine', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'ID', identifier: 'urn:uuid:id-book' },
      cover: {
        id: '123 cover',
        href: 'OPS/Images/cover.png',
        data: new Uint8Array([0]),
      },
      chapters: [
        { id: '第一 章', title: '一', body: '本文1' },
        { id: '第一 章', title: '二', body: '本文2' },
      ],
    });
    project.addAsset({
      id: '123 asset',
      href: 'OPS/Data/data.bin',
      data: new Uint8Array([1]),
    });

    expect(project.chapters.map((chapter) => chapter.id)).toEqual(['chapter-1', 'chapter-2']);
    expect(project.assets.map((asset) => asset.id)).toEqual(['id-123-cover', 'id-123-asset']);

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');

    expect(opf).toContain('<item id="chapter-1" href="Text/chapter-001.xhtml"');
    expect(opf).toContain('<item id="chapter-2" href="Text/chapter-002.xhtml"');
    expect(opf).toMatch(/<itemref idref="title-page" \/>[\s\S]*<itemref idref="chapter-1" \/>/u);
    expect(opf).toContain('<itemref idref="chapter-2" />');
    expect(opf).toContain('<item id="id-123-cover" href="Images/cover.png"');
    expect(opf).toContain('<meta name="cover" content="id-123-cover" />');
    expect(opf).toContain('<item id="id-123-asset" href="Data/data.bin"');
  });

  it('avoids reserved and cross-kind OPF manifest id collisions', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: 'Collision',
        identifier: 'urn:uuid:manifest-collision-book',
        creators: [{ name: '作者' }],
        contributors: [{ name: '編集者' }],
        collections: [{ name: 'シリーズ' }],
      },
      chapters: [
        { id: 'nav', title: '一', body: '本文1' },
        { id: 'creator-1', title: '二', body: '本文2' },
      ],
    });
    project.addAsset({
      id: 'contributor-1',
      href: 'OPS/Data/data.bin',
      data: new Uint8Array([1]),
    });
    project.setCover({
      id: 'title-page',
      href: 'OPS/Images/cover.png',
      data: new Uint8Array([2]),
    });

    expect(project.chapters.map((chapter) => chapter.id)).toEqual(['nav-2', 'creator-1-2']);
    expect(project.assets.map((asset) => asset.id)).toEqual(['contributor-1-2', 'title-page-2']);

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const ids = Array.from(opf?.matchAll(/\bid="([^"]+)"/gu) ?? []).map((match) => match[1]);

    expect(ids.filter((id) => id === 'nav')).toHaveLength(1);
    expect(ids.filter((id) => id === 'title-page')).toHaveLength(1);
    expect(ids.filter((id) => id === 'creator-1')).toHaveLength(1);
    expect(ids.filter((id) => id === 'contributor-1')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(opf).toContain('<itemref idref="nav-2" />');
    expect(opf).toContain('<itemref idref="creator-1-2" />');
    expect(opf).toContain('<meta name="cover" content="title-page-2" />');
  });

  it('replaces an existing cover instead of keeping stale cover-image assets', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'Cover replace', identifier: 'urn:uuid:cover-replace-book' },
      cover: {
        id: 'old-cover',
        href: 'OPS/Images/old.png',
        data: new Uint8Array([1]),
      },
      chapters: [{ title: '一', body: '本文' }],
    });
    project.addAsset({
      id: 'data',
      href: 'OPS/Data/data.bin',
      data: new Uint8Array([9]),
    });

    project.setCover({
      id: 'new-cover',
      href: 'OPS/Images/new.png',
      data: new Uint8Array([2]),
    });

    expect(project.assets.map((asset) => asset.id)).toEqual(['data', 'new-cover']);
    expect(project.assets.filter((asset) => asset.properties === 'cover-image')).toHaveLength(1);

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');

    expect(zip.file('OPS/Images/old.png')).toBeNull();
    expect(Array.from((await zip.file('OPS/Images/new.png')?.async('uint8array')) ?? [])).toEqual([
      2,
    ]);
    expect(opf).not.toContain('old-cover');
    expect(opf).not.toContain('Images/old.png');
    expect(opf).toContain('<item id="new-cover" href="Images/new.png"');
    expect(opf).toContain('<meta name="cover" content="new-cover" />');
    expect(opf).toContain('<item id="data" href="Data/data.bin"');
  });

  it('inserts an inline image and renders it as a figure in chapter XHTML', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '画像入り', identifier: 'urn:uuid:inline-image-book' },
      chapters: [{ title: '一', body: '段落1\n\n段落2' }],
    });

    project.addInlineImage(0, 1, {
      href: 'OPS/Images/figure.png',
      data: new Uint8Array([1, 2, 3]),
      alt: '挿絵',
    });

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const xhtml = await zip.file('OPS/Text/chapter-001.xhtml')?.async('string');
    expect(xhtml).toMatch(
      /<p>段落1<\/p>[\s\S]*<figure><img src="\.\.\/Images\/figure\.png" alt="挿絵"[\s\S]*<\/figure>[\s\S]*<p>段落2<\/p>/u,
    );
    const image = await zip.file('OPS/Images/figure.png')?.async('uint8array');
    expect(Array.from(image ?? [])).toEqual([1, 2, 3]);
  });

  it('counts inline image paragraph indices in the exported paragraph space', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '前置き空行', identifier: 'urn:uuid:inline-image-index-book' },
      chapters: [{ title: '一', body: '\n\n段落1\n\n段落2' }],
    });

    project.addInlineImage(0, 1, {
      href: 'OPS/Images/figure.png',
      data: new Uint8Array([1]),
      alt: '挿絵',
    });

    expect(manuscriptParagraphs(project.chapters[0].body)[1]).toMatch(/^\[\[mejiro-image:/u);

    const zip = await JSZip.loadAsync(await project.export());
    const xhtml = (await zip.file('OPS/Text/chapter-001.xhtml')?.async('string')) ?? '';
    expect(xhtml).toMatch(
      /<p>段落1<\/p>\s*<figure><img src="\.\.\/Images\/figure\.png"[^>]*\/><\/figure>\s*<p>段落2<\/p>/u,
    );
  });

  it('escapes inline image markers so special filename and alt characters survive export', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '特殊画像', identifier: 'urn:uuid:inline-image-special-book' },
      chapters: [{ title: '一', body: '段落' }],
    });

    project.addInlineImage(0, 1, {
      href: 'OPS/Images/fig]x|y.png',
      data: new Uint8Array([4, 5, 6]),
      alt: '挿絵] | "説明"',
    });

    expect(project.chapters[0].body).toContain(
      '[[mejiro-image:..%2FImages%2Ffig%5Dx%7Cy.png|%E6%8C%BF%E7%B5%B5%5D%20%7C%20%22%E8%AA%AC%E6%98%8E%22]]',
    );

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const xhtml = await zip.file('OPS/Text/chapter-001.xhtml')?.async('string');
    expect(xhtml).toContain('src="../Images/fig]x|y.png"');
    expect(xhtml).toContain('alt="挿絵] | &quot;説明&quot;"');
    const image = await zip.file('OPS/Images/fig]x|y.png')?.async('uint8array');
    expect(Array.from(image ?? [])).toEqual([4, 5, 6]);
  });

  it('links inline images to the actual asset href instead of assuming OPS/Images', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '画像配置', identifier: 'urn:uuid:inline-image-path-book' },
      chapters: [{ title: '一', body: '段落' }],
    });

    project.addInlineImage(0, 1, {
      href: 'OPS/Media/figure.webp',
      data: new Uint8Array([7, 8, 9]),
      alt: '別ディレクトリ',
    });

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const xhtml = await zip.file('OPS/Text/chapter-001.xhtml')?.async('string');
    expect(xhtml).toContain('src="../Media/figure.webp"');
    const image = await zip.file('OPS/Media/figure.webp')?.async('uint8array');
    expect(Array.from(image ?? [])).toEqual([7, 8, 9]);
  });

  it('uniques duplicate project asset hrefs so ZIP files are not overwritten', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '重複画像', identifier: 'urn:uuid:duplicate-project-assets' },
      chapters: [{ title: '一', body: '段落1\n\n段落2' }],
    });

    project.addInlineImage(0, 1, {
      href: 'OPS/Images/figure.png',
      data: new Uint8Array([1]),
      alt: '一枚目',
    });
    project.addInlineImage(0, 2, {
      href: 'OPS/Images/figure.png',
      data: new Uint8Array([2]),
      alt: '二枚目',
    });
    const stored = project.addAsset({
      href: 'OPS/Images/figure.png',
      data: new Uint8Array([3]),
    });

    expect(project.assets.map((asset) => asset.href)).toEqual([
      'OPS/Images/figure.png',
      'OPS/Images/figure-2.png',
      'OPS/Images/figure-3.png',
    ]);
    expect(stored.href).toBe('OPS/Images/figure-3.png');

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const xhtml = await zip.file('OPS/Text/chapter-001.xhtml')?.async('string');
    const firstImage = await zip.file('OPS/Images/figure.png')?.async('uint8array');
    const secondImage = await zip.file('OPS/Images/figure-2.png')?.async('uint8array');
    const thirdImage = await zip.file('OPS/Images/figure-3.png')?.async('uint8array');

    expect(Array.from(firstImage ?? [])).toEqual([1]);
    expect(Array.from(secondImage ?? [])).toEqual([2]);
    expect(Array.from(thirdImage ?? [])).toEqual([3]);
    expect(opf).toContain('href="Images/figure.png"');
    expect(opf).toContain('href="Images/figure-2.png"');
    expect(opf).toContain('href="Images/figure-3.png"');
    expect(xhtml).toContain('src="../Images/figure.png" alt="一枚目"');
    expect(xhtml).toContain('src="../Images/figure-2.png" alt="二枚目"');
  });

  it('moves asset hrefs off generated package paths so every ZIP entry is written once', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '予約パス', identifier: 'urn:uuid:reserved-path-book' },
      chapters: [{ title: '一', body: '段落' }],
    });

    const opfAsset = project.addAsset({ href: 'OPS/package.opf', data: new Uint8Array([1]) });
    const mimetypeAsset = project.addAsset({ href: 'mimetype', data: new Uint8Array([2]) });
    const containerAsset = project.addAsset({
      href: 'META-INF/container.xml',
      data: new Uint8Array([3]),
    });
    const chapterAsset = project.addAsset({
      href: 'OPS/Text/chapter-001.xhtml',
      data: new Uint8Array([4]),
    });
    project.setCover({ href: 'OPS/nav.xhtml', data: new Uint8Array([5]) });
    project.addInlineImage(0, 1, { href: 'OPS/Styles/style.css', data: new Uint8Array([6]) });

    expect(opfAsset.href).toBe('OPS/package-2.opf');
    expect(mimetypeAsset.href).toBe('mimetype-2');
    expect(containerAsset.href).toBe('META-INF/container-2.xml');
    expect(chapterAsset.href).toBe('OPS/Text/chapter-001-2.xhtml');
    expect(project.assets.map((asset) => asset.href)).toEqual([
      'OPS/package-2.opf',
      'mimetype-2',
      'META-INF/container-2.xml',
      'OPS/Text/chapter-001-2.xhtml',
      'OPS/nav-2.xhtml',
      'OPS/Styles/style-2.css',
    ]);

    const zip = await JSZip.loadAsync(await project.export());
    const opf = (await zip.file('OPS/package.opf')?.async('string')) ?? '';
    const nav = (await zip.file('OPS/nav.xhtml')?.async('string')) ?? '';
    const css = (await zip.file('OPS/Styles/style.css')?.async('string')) ?? '';
    const chapter = (await zip.file('OPS/Text/chapter-001.xhtml')?.async('string')) ?? '';

    expect(await zip.file('mimetype')?.async('string')).toBe('application/epub+zip');
    expect(await zip.file('META-INF/container.xml')?.async('string')).toContain('<rootfiles>');
    expect(opf).toContain('<package');
    expect(nav).toContain('epub:type="toc"');
    expect(css).toContain('writing-mode: vertical-rl');
    expect(chapter).toContain('<figure>');
    expect(Array.from((await zip.file('OPS/package-2.opf')?.async('uint8array')) ?? [])).toEqual([
      1,
    ]);
    expect(Array.from((await zip.file('OPS/nav-2.xhtml')?.async('uint8array')) ?? [])).toEqual([5]);
    expect(
      Array.from((await zip.file('OPS/Styles/style-2.css')?.async('uint8array')) ?? []),
    ).toEqual([6]);

    const manifestHrefs = Array.from(opf.matchAll(/<item\b[^>]*\bhref="([^"]*)"/gu)).map(
      (match) => match[1],
    );
    expect(new Set(manifestHrefs).size).toBe(manifestHrefs.length);
  });

  it('rejects invalid project asset hrefs before exporting broken ZIP paths', () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'Invalid asset hrefs', identifier: 'urn:uuid:invalid-assets' },
      chapters: [{ title: '一', body: '本文' }],
    });

    expect(() => project.addAsset({ href: '', data: new Uint8Array([1]) })).toThrow(
      /Asset href must point to a file/,
    );
    expect(() => project.addAsset({ href: 'OPS/Images/', data: new Uint8Array([1]) })).toThrow(
      /Asset href must point to a file/,
    );
    expect(() => project.addAsset({ href: '../outside.png', data: new Uint8Array([1]) })).toThrow(
      /must not contain parent directory/,
    );
    expect(() =>
      project.addAsset({ href: 'OPS/Images/%2e%2e/outside.png', data: new Uint8Array([1]) }),
    ).toThrow(/must not contain parent directory/);
    expect(() =>
      project.addAsset({ href: '%2FOPS/Images/cover.png', data: new Uint8Array([1]) }),
    ).toThrow(/must be a relative EPUB path/);
    expect(() =>
      project.addAsset({ href: 'OPS/Images/cover.png#frag', data: new Uint8Array([1]) }),
    ).toThrow(/clean EPUB file path/);
    expect(() =>
      project.addAsset({ href: 'OPS\\Images\\cover.png', data: new Uint8Array([1]) }),
    ).toThrow(/clean EPUB file path/);
    expect(() =>
      project.addAsset({ href: 'OPS/Images/%E0%A4%A', data: new Uint8Array([1]) }),
    ).toThrow(/valid URI path/);
    expect(() =>
      project.addAsset({ href: 'https://example.test/x.png', data: new Uint8Array([1]) }),
    ).toThrow(/must be a relative EPUB path/);
    expect(() =>
      project.setCover({ href: '/OPS/Images/cover.png', data: new Uint8Array([1]) }),
    ).toThrow(/must be a relative EPUB path/);
    expect(project.assets).toHaveLength(0);
  });

  it('emits EPUB3 metadata for creators, contributors, subjects, series, and rights', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '群像',
        subtitle: '副題',
        description: '長いあらすじ',
        rights: '© 2026 著作者',
        identifier: 'urn:uuid:rich-metadata-book',
        modified: new Date('2026-05-20T00:00:00Z'),
        date: new Date('2026-05-20T00:00:00Z'),
        creators: [
          { name: '夏目漱石', role: 'aut', fileAs: 'なつめ そうせき' },
          { name: '森鴎外', role: 'aut' },
        ],
        contributors: [{ name: '挿絵担当', role: 'ill' }],
        subjects: ['歴史小説', '純文学'],
        series: { name: '近代文学集', index: 3 },
        collections: [{ name: 'コレクション', type: 'series', index: 1 }],
      },
      chapters: [{ title: '一', body: '本文。' }],
    });

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');

    expect(opf).toContain('<dc:title id="title">群像</dc:title>');
    expect(opf).toContain('<dc:title id="subtitle">副題</dc:title>');
    expect(opf).toContain('property="title-type">subtitle');
    expect(opf).toContain('<dc:description>長いあらすじ</dc:description>');
    expect(opf).toContain('<dc:rights>© 2026 著作者</dc:rights>');
    expect(opf).toContain('<dc:date>2026-05-20T00:00:00Z</dc:date>');
    expect(opf).toMatch(
      /<dc:creator id="creator-1">夏目漱石<\/dc:creator>[\s\S]*scheme="marc:relators">aut/u,
    );
    expect(opf).toContain('property="file-as">なつめ そうせき');
    expect(opf).toContain('<dc:creator id="creator-2">森鴎外</dc:creator>');
    expect(opf).toContain('<dc:contributor id="contributor-1">挿絵担当</dc:contributor>');
    expect(opf).toContain('<dc:subject>歴史小説</dc:subject>');
    expect(opf).toContain('<dc:subject>純文学</dc:subject>');
    expect(opf).toContain('calibre:series" content="近代文学集"');
    expect(opf).toContain('calibre:series_index" content="3"');
    expect(opf).toContain('property="belongs-to-collection" id="collection-1">コレクション');
    expect(opf).toContain('property="collection-type">series');
    expect(opf).toContain('property="group-position">1');
  });

  it('maps the legacy `author` shortcut to creators[0] with role aut', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '吾輩は猫である',
        author: '夏目漱石',
        identifier: 'urn:uuid:legacy-author-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      chapters: [{ title: '一', body: '本文。' }],
    });

    const out = await project.export();
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    expect(opf).toContain('<dc:creator id="creator-1">夏目漱石</dc:creator>');
    expect(opf).toContain('scheme="marc:relators">aut');
  });

  it('reports serialize and zip progress during export', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: '進捗', identifier: 'urn:uuid:progress-book' },
      chapters: [
        { title: '一', body: '本文。' },
        { title: '二', body: '本文。' },
      ],
    });

    const events: Array<['serialize' | 'zip', number]> = [];
    await project.export({
      onProgress: (phase, ratio) => events.push([phase, ratio]),
    });

    const serialize = events.filter(([phase]) => phase === 'serialize').map(([, r]) => r);
    expect(serialize).toEqual([0.5, 1]);
    expect(events.some(([phase, ratio]) => phase === 'zip' && ratio > 0 && ratio <= 1)).toBe(true);
  });

  it('aborts when the signal is already triggered', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'aborted', identifier: 'urn:uuid:aborted-book' },
      chapters: [{ title: '一', body: '本文。' }],
    });
    const controller = new AbortController();
    controller.abort();
    await expect(project.export({ signal: controller.signal })).rejects.toThrow();
  });

  it('generates EPUB3 package, nav, stylesheet, cover asset, and OCF mimetype', async () => {
    const project = EpubProject.fromManuscript({
      metadata: {
        title: '表紙つき',
        identifier: 'urn:uuid:cover-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      cover: {
        href: 'OPS/Images/cover.png',
        data: new Uint8Array([1, 2, 3]),
      },
      chapters: [{ title: '本文', body: '本文です。' }],
    });

    const out = await project.export();
    const bytes = new Uint8Array(out);
    const view = new DataView(out);
    const fileNameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const firstName = new TextDecoder().decode(bytes.slice(30, 30 + fileNameLength));
    const firstContentsStart = 30 + fileNameLength + extraLength;
    const firstContents = new TextDecoder().decode(
      bytes.slice(firstContentsStart, firstContentsStart + 'application/epub+zip'.length),
    );
    const zip = await JSZip.loadAsync(out);
    const opf = await zip.file('OPS/package.opf')?.async('string');
    const nav = await zip.file('OPS/nav.xhtml')?.async('string');
    const css = await zip.file('OPS/Styles/style.css')?.async('string');
    const cover = await zip.file('OPS/Images/cover.png')?.async('uint8array');

    expect(view.getUint16(8, true)).toBe(0);
    expect(firstName).toBe('mimetype');
    expect(firstContents).toBe('application/epub+zip');
    expect(opf).toContain('properties="nav"');
    expect(opf).toContain('id="title-page"');
    expect(opf).toMatch(/<itemref idref="title-page" \/>[\s\S]*<itemref idref="chapter-1" \/>/u);
    expect(opf).toContain('properties="cover-image"');
    expect(nav).toContain('Text/titlepage.xhtml');
    expect(nav).toContain('xmlns:epub="http://www.idpf.org/2007/ops"');
    expect(nav).toContain('epub:type="toc"');
    expect(css).toContain('.title-page h1');
    expect(css).toContain('writing-mode: vertical-rl');
    expect(Array.from(cover ?? [])).toEqual([1, 2, 3]);
  });

  it('drops XML-illegal control characters from every generated document', async () => {
    const bel = String.fromCharCode(0x07);
    const verticalTab = String.fromCharCode(0x0b);
    const formFeed = String.fromCharCode(0x0c);
    const project = EpubProject.fromManuscript({
      metadata: {
        title: `題${bel}名`,
        subtitle: `副${verticalTab}題`,
        author: `作${formFeed}者`,
        publisher: `版${bel}元`,
        subjects: [`分${verticalTab}類`],
        identifier: 'urn:uuid:control-char-book',
        modified: new Date('2026-05-20T00:00:00Z'),
      },
      chapters: [{ title: `第${bel}一話`, body: `本${verticalTab}文${formFeed}です。` }],
    });
    project.addInlineImage(0, 1, {
      href: 'OPS/Images/figure.png',
      data: new Uint8Array([1]),
      alt: `挿${bel}絵`,
    });

    const zip = await JSZip.loadAsync(await project.export());
    const documents = [
      'META-INF/container.xml',
      'OPS/package.opf',
      'OPS/nav.xhtml',
      'OPS/Text/titlepage.xhtml',
      'OPS/Text/chapter-001.xhtml',
    ];
    for (const path of documents) {
      const xml = (await zip.file(path)?.async('string')) ?? '';
      expect(xml).not.toBe('');
      expect(hasXmlIllegalChar(xml)).toBe(false);
      const reparsed = new DOMParser().parseFromString(
        stripStylesheetLinks(xml),
        'application/xml',
      );
      expect(reparsed.getElementsByTagName('parsererror')).toHaveLength(0);
    }

    const opf = (await zip.file('OPS/package.opf')?.async('string')) ?? '';
    const chapter = (await zip.file('OPS/Text/chapter-001.xhtml')?.async('string')) ?? '';
    expect(opf).toContain('<dc:title id="title">題名</dc:title>');
    expect(opf).toContain('<dc:creator id="creator-1">作者</dc:creator>');
    expect(chapter).toContain('<h1>第一話</h1>');
    expect(chapter).toContain('<p>本文です。</p>');
    expect(chapter).toContain('alt="挿絵"');
  });

  it('encodes attribute white space that XML normalization would otherwise flatten', async () => {
    const project = EpubProject.fromManuscript({
      metadata: { title: 'Attribute white space', identifier: 'urn:uuid:attribute-space-book' },
      chapters: [{ title: '一', body: '段落' }],
    });
    project.addInlineImage(0, 1, {
      href: 'OPS/Images/figure.png',
      data: new Uint8Array([1]),
      alt: '一行目\n二行目',
    });

    const zip = await JSZip.loadAsync(await project.export());
    const chapter = (await zip.file('OPS/Text/chapter-001.xhtml')?.async('string')) ?? '';

    expect(chapter).toContain('alt="一行目&#10;二行目"');
    const reparsed = new DOMParser().parseFromString(
      stripStylesheetLinks(chapter),
      'application/xml',
    );
    expect(reparsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(reparsed.getElementsByTagName('img')[0]?.getAttribute('alt')).toBe('一行目\n二行目');
  });

  describe('assetResolver', () => {
    it('resolves URL-only assets through the supplied resolver at export time', async () => {
      const project = EpubProject.fromManuscript({
        metadata: { title: 'Remote assets', identifier: 'urn:uuid:remote-assets' },
        chapters: [{ title: '一', body: '本文' }],
      });
      project.addAsset({
        href: 'OPS/Images/remote.png',
        mediaType: 'image/png',
        url: 'https://cdn.example.com/remote.png',
      });

      const seen: Array<{ assetKey: string; url: string }> = [];
      const out = await project.export({
        assetResolver(request) {
          seen.push({ assetKey: request.assetKey, url: request.url });
          return new Uint8Array([0x52, 0x65, 0x6d]);
        },
      });

      const zip = await JSZip.loadAsync(out);
      const stored = await zip.file('OPS/Images/remote.png')?.async('uint8array');

      expect(Array.from(stored ?? [])).toEqual([0x52, 0x65, 0x6d]);
      expect(seen).toEqual([
        { assetKey: 'OPS/Images/remote.png', url: 'https://cdn.example.com/remote.png' },
      ]);
    });

    it('rejects when an asset has neither `data` nor `url`', async () => {
      const project = EpubProject.fromManuscript({
        metadata: { title: 'Empty asset', identifier: 'urn:uuid:empty-asset' },
        chapters: [{ title: '一', body: '本文' }],
      });
      const asset = project.addAsset({
        href: 'OPS/Images/orphan.png',
        data: new Uint8Array([1]),
      });
      asset.data = undefined;

      await expect(project.export()).rejects.toThrow(/has neither `data` nor `url`/);
    });
  });
});
