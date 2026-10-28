/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { EditableEpub, EpubProject, parseEpub } from '../../src/epub/index.js';

async function makeEpub(files: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const containerXml = (fullPath = 'OPS/package.opf') => `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="${fullPath}" /></rootfiles></container>`;

const opfXml = (manifestExtra = '') => `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>検証</dc:title></metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />${manifestExtra}
  </manifest>
  <spine><itemref idref="c1" /></spine>
</package>`;

const chapterXhtml = (body: string) => `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章</title></head><body>${body}</body></html>`;

async function loadChapter(
  body: string,
  extra: Record<string, string | Uint8Array> = {},
): Promise<EditableEpub> {
  return EditableEpub.load(
    await makeEpub({
      'META-INF/container.xml': containerXml(),
      'OPS/package.opf': opfXml(),
      'OPS/Text/chapter.xhtml': chapterXhtml(body),
      ...extra,
    }),
  );
}

async function chapterOf(out: ArrayBuffer, path = 'OPS/Text/chapter.xhtml'): Promise<string> {
  const zip = await JSZip.loadAsync(out);
  return (await zip.file(path)?.async('string')) ?? '';
}

function hasXmlIllegalChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
    if (code >= 0xd800 && code <= 0xdfff) return true;
    if (code === 0xfffe || code === 0xffff) return true;
  }
  return false;
}

/** Text of each paragraph-level element of a chapter document, newlines from `<br>` included. */
async function projectParagraphTexts(body: string): Promise<string[]> {
  const project = EpubProject.fromManuscript({
    metadata: { title: '比較', identifier: 'urn:uuid:compare-book' },
    includeTitlePage: false,
    chapters: [{ title: '章', body }],
  });
  const book = await parseEpub(await project.export());
  return book.chapters[0].paragraphs.slice(1).map((paragraph) => paragraph.text);
}

describe('EditableEpub export shares the project serializer', () => {
  it('writes a newline as <br> so an edited chapter reloads with it, as EpubProject does', async () => {
    const editor = await loadChapter('<p>前<br/>後</p>');
    expect(editor.chapters[0].paragraphs[0].text).toBe('前\n後');
    editor.updateParagraph(0, 0, { text: 'a\nb' });

    const out = await editor.export();
    expect(await chapterOf(out)).toMatch(/<p>a<br ?\/>b<\/p>/u);
    const reloaded = await EditableEpub.load(out);
    expect(reloaded.chapters[0].paragraphs[0].text).toBe('a\nb');
    expect(await projectParagraphTexts('a\nb')).toEqual(['a\nb']);
  });

  it('strips XML-illegal characters from text and attributes, matching EpubProject', async () => {
    const editor = await loadChapter('<p>本文</p>');
    const dirty = `a\u0001b\uD800c\uFFFEd`;
    editor.updateParagraph(0, 0, { text: dirty });
    editor.addImage(0, {
      filename: 'f.png',
      data: new Uint8Array([1]),
      alt: `図\u0002`,
      caption: `説\u0003明`,
    });

    const chapter = await chapterOf(await editor.export());
    expect(hasXmlIllegalChar(chapter)).toBe(false);
    expect(chapter).toContain('<p>abcd</p>');
    expect(chapter).toContain('alt="図"');
    expect(chapter).toContain('<figcaption>説明</figcaption>');
    const doc = new DOMParser().parseFromString(chapter, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(await projectParagraphTexts(dirty)).toEqual(['abcd']);
  });
});

describe('EditableEpub paragraph blocks are built by one normalizer', () => {
  it('rejects a heading without a level and levels outside integer 1-6 on every mutator', async () => {
    const editor = await loadChapter('<p>本文</p>');
    for (const level of [2.5, 9, 0, Number.NaN]) {
      expect(() =>
        editor.insertParagraph(0, 0, {
          text: '見出し',
          inlineAnnotations: [],
          headingLevel: level,
        }),
      ).toThrow(/headingLevel/u);
      expect(() => editor.updateParagraph(0, 0, { headingLevel: level })).toThrow(/headingLevel/u);
    }
    expect(() =>
      editor.insertParagraph(0, 0, {
        text: '見出し',
        inlineAnnotations: [],
        paragraphKind: 'heading',
      }),
    ).toThrow(/headingLevel/u);
    expect(editor.history.depth).toBe(0);
    expect(editor.chapters[0].isDirty).toBeFalsy();

    editor.insertParagraph(0, 0, {
      text: '見出し',
      inlineAnnotations: [],
      paragraphKind: 'heading',
      headingLevel: 3,
    });
    expect(await chapterOf(await editor.export())).toContain('<h3>見出し</h3>');
  });

  it('drops invalid annotations on insert exactly as updateParagraph does', async () => {
    const editor = await loadChapter('<p>本文</p>');
    const annotations = [
      { kind: 'em' as const, startIndex: 0, endIndex: 2 },
      { kind: 'em' as const, startIndex: 1, endIndex: 9 },
      { kind: 'strong' as const, startIndex: 0.5, endIndex: 1 },
    ];
    editor.insertParagraph(0, 0, { text: '挿入文', inlineAnnotations: annotations });
    editor.updateParagraph(0, 1, { text: '更新文', inlineAnnotations: annotations });
    expect(editor.chapters[0].paragraphs[0].inlineAnnotations).toEqual([annotations[0]]);
    expect(editor.chapters[0].paragraphs[1].inlineAnnotations).toEqual([annotations[0]]);
  });

  it('splits at a truncated integer index and rejects a non-finite one before recording', async () => {
    const editor = await loadChapter('<p>あいうえ</p>');
    const block = editor.chapters[0].blocks[0];
    editor.setInlineAnnotations(0, 0, [
      { kind: 'em', startIndex: 1, endIndex: 2 },
      { kind: 'strong', startIndex: 2, endIndex: 4 },
    ]);
    const depth = editor.history.depth;
    expect(() => editor.splitParagraph(0, block.id, Number.NaN)).toThrow(/split index/u);
    expect(editor.history.depth).toBe(depth);

    editor.splitParagraph(0, block.id, 1.5);
    const [left, right] = editor.chapters[0].paragraphs;
    expect(left.text).toBe('あ');
    expect(right.text).toBe('いうえ');
    expect(left.inlineAnnotations).toEqual([]);
    expect(right.inlineAnnotations).toEqual([
      { kind: 'em', startIndex: 0, endIndex: 1 },
      { kind: 'strong', startIndex: 1, endIndex: 3 },
    ]);
  });
});

describe('edited chapters either round-trip a construct or fail naming the chapter', () => {
  const failsNamingChapter = /Cannot export edited chapter with .*: OPS\/Text\/chapter\.xhtml/u;

  it('keeps the blockquote kind of a blockquote holding paragraphs', async () => {
    const editor = await loadChapter(
      '<p>地の文</p><blockquote><p>引用一</p><p>引用二</p></blockquote>',
    );
    expect(editor.chapters[0].blocks.map((b) => b.kind === 'paragraph' && b.paragraphKind)).toEqual(
      [undefined, 'blockquote', 'blockquote'],
    );
    editor.updateParagraph(0, 0, { text: '改稿' });
    const reloaded = await EditableEpub.load(await editor.export());
    expect(
      reloaded.chapters[0].blocks.map((b) => b.kind === 'paragraph' && [b.text, b.paragraphKind]),
    ).toEqual([
      ['改稿', undefined],
      ['引用一', 'blockquote'],
      ['引用二', 'blockquote'],
    ]);
  });

  it('rejects a blockquote around other blocks, an unresolved image and a multi-image figure', async () => {
    const opf = opfXml('<item id="g" href="Images/g.png" media-type="image/png" />');
    const cases = [
      '<p>本文</p><blockquote><h2>見出し</h2><p>引用</p></blockquote>',
      '<p>本文</p><p><img src="data:image/png;base64,AAAA" alt="埋込" /></p>',
      '<p>本文</p><figure><img src="../Images/g.png" alt="一" /><img src="../Images/g.png" alt="二" /></figure>',
      '<p>本文</p><figure><img src="../Images/g.png" alt="一" /><p>図の外の文</p></figure>',
    ];
    for (const body of cases) {
      const editor = await EditableEpub.load(
        await makeEpub({
          'META-INF/container.xml': containerXml(),
          'OPS/package.opf': opf,
          'OPS/Text/chapter.xhtml': chapterXhtml(body),
          'OPS/Images/g.png': new Uint8Array([7]),
        }),
      );
      // Unedited, the chapter is written back verbatim.
      await expect(editor.export()).resolves.toBeInstanceOf(ArrayBuffer);
      editor.updateParagraph(0, 0, { text: '編集' });
      await expect(editor.export()).rejects.toThrow(failsNamingChapter);
    }
  });

  it('loads a book whose image src has a malformed percent escape', async () => {
    const editor = await loadChapter('<p>本文</p><p><img src="a%zz.png" alt="壊" /></p>');
    expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual(['本文']);
    await expect(editor.export()).resolves.toBeInstanceOf(ArrayBuffer);
    editor.updateParagraph(0, 0, { text: '編集' });
    await expect(editor.export()).rejects.toThrow(failsNamingChapter);
  });
});

describe('import fidelity shared by parseEpub and EditableEpub.load', () => {
  const pre = '<pre>line 1\nline 2\n  line 3</pre>';

  it('keeps pre newlines and spacing through parse, edit, export and reload', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml(),
      'OPS/package.opf': opfXml(),
      'OPS/Text/chapter.xhtml': chapterXhtml(`<p>本文</p>${pre}`),
    });
    const book = await parseEpub(data);
    expect(book.chapters[0].paragraphs[1].text).toBe('line 1\nline 2\n  line 3');

    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].paragraphs[1].text).toBe('line 1\nline 2\n  line 3');
    editor.updateParagraph(0, 0, { text: '改稿' });
    const reloaded = await EditableEpub.load(await editor.export());
    const block = reloaded.chapters[0].blocks[1];
    expect(block).toMatchObject({ text: 'line 1\nline 2\n  line 3', paragraphKind: 'pre' });
  });

  it('extracts no text from hidden or aria-hidden blocks', async () => {
    const bodies = [
      '<p hidden="">H1</p><p>vis</p>',
      '<p aria-hidden="true">H2</p><p>vis</p>',
      '<div hidden=""><p>H3</p></div><p>vis</p>',
    ];
    for (const body of bodies) {
      const data = await makeEpub({
        'META-INF/container.xml': containerXml(),
        'OPS/package.opf': opfXml(),
        'OPS/Text/chapter.xhtml': chapterXhtml(body),
      });
      const book = await parseEpub(data);
      expect(book.chapters[0].paragraphs.map((p) => p.text)).toEqual(['vis']);
      const editor = await EditableEpub.load(data);
      expect(editor.chapters[0].paragraphs.map((p) => p.text)).toEqual(['vis']);
    }
  });

  it('decodes a percent-encoded rootfile full-path on both entry points', async () => {
    const data = await makeEpub({
      'META-INF/container.xml': containerXml('my%20book/content.opf'),
      'my book/content.opf': opfXml(),
      'my book/Text/chapter.xhtml': chapterXhtml('<p>本文</p>'),
    });
    expect((await parseEpub(data)).chapters[0].paragraphs[0].text).toBe('本文');
    const editor = await EditableEpub.load(data);
    expect(editor.chapters[0].paragraphs[0].text).toBe('本文');
    editor.updateParagraph(0, 0, { text: '改稿' });
    const out = await editor.export();
    expect(await chapterOf(out, 'my book/Text/chapter.xhtml')).toContain('<p>改稿</p>');
    expect((await EditableEpub.load(out)).chapters[0].paragraphs[0].text).toBe('改稿');
  });
});
