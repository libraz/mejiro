/**
 * @vitest-environment happy-dom
 */
import {
  EpubProject,
  type ManuscriptChapter,
  MejiroError,
  type MejiroErrorCode,
  manuscriptToEpubBook,
  parseEpub,
} from '@libraz/mejiro/epub';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import * as projectModule from '../../src/epub/project.js';
import { expectTypeErrors } from '../type-probe.js';

const PROBE_HEADER = `import { EpubProject, manuscriptToEpubBook, type ManuscriptChapter } from '@libraz/mejiro/epub';
import type { ManuscriptChapter as CoreManuscriptChapter } from '@libraz/mejiro';
const project = new EpubProject({ metadata: { title: 'T' } });
const bytes = new Uint8Array([1]);`;

function newProject(
  extra: Partial<ConstructorParameters<typeof EpubProject>[0]> = {},
): EpubProject {
  return new EpubProject({
    metadata: { title: '契約', identifier: 'urn:uuid:contract-book' },
    chapters: [{ title: '一', body: '最初。\n\n二つ目。' }],
    ...extra,
  });
}

async function entry(out: Uint8Array, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(out);
  return (await zip.file(path)?.async('string')) ?? '';
}

describe('manuscriptToEpubBook with shared manuscript chapters', () => {
  it('takes the chapter type of the core entry and keeps the id off the book', () => {
    const chapters: readonly ManuscriptChapter[] = [{ id: 'c1', title: '第一話', body: '本文。' }];
    const book = manuscriptToEpubBook(chapters);

    expect(book.chapters[0].title).toBe('第一話');
    expect('id' in book.chapters[0]).toBe(false);
    expectTypeErrors(
      `${PROBE_HEADER}
const same: CoreManuscriptChapter = { title: 'a', body: 'b' } satisfies ManuscriptChapter;
export const book = manuscriptToEpubBook([same]);
export const unused: CoreManuscriptChapter | undefined = undefined as ManuscriptChapter | undefined;`,
      { fails: [] },
    );
  });

  it('reads the book title and author from package metadata', () => {
    const book = manuscriptToEpubBook([{ title: '一', body: '本文。' }], {
      metadata: {
        title: '題名',
        creators: [
          { name: '甲', role: 'aut' },
          { name: '乙', role: 'ill' },
          { name: '丙', role: 'aut' },
        ],
      },
    });

    expect(book.title).toBe('題名');
    expect(book.author).toBe('甲, 丙');
  });

  it('leaves the title empty and the author unset without metadata', () => {
    const book = manuscriptToEpubBook([{ title: '一', body: '本文。' }]);

    expect(book.title).toBe('');
    expect('author' in book).toBe(false);
  });

  it('takes metadata in place of the title and author options', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
manuscriptToEpubBook([], { metadata: { title: 'T', creators: [{ name: 'A', role: 'aut' }] } });
manuscriptToEpubBook([], { title: 'T' });
manuscriptToEpubBook([], { author: 'A' });`,
      { fails: ['manuscriptToEpubBook([], { title', 'manuscriptToEpubBook([], { author'] },
    );
  });
});

describe('EpubProject mutators return what they stored', () => {
  it('returns the stored chapter from addChapter', () => {
    const project = newProject();
    const stored = project.addChapter({ id: '2 章!', title: '二', body: '本文。' });

    expect(stored).toMatchObject({ id: 'id-2', title: '二', body: '本文。' });
    expect(project.chapters[1]).toEqual(stored);
  });

  it('returns the stored asset from addAsset and setCover', () => {
    const project = newProject();
    const asset = project.addAsset({ href: 'OPS/Images/a.png', data: new Uint8Array([1]) });
    const cover = project.setCover({ data: new Uint8Array([2]), mediaType: 'image/png' });

    expect(asset).toMatchObject({ href: 'OPS/Images/a.png', mediaType: 'image/png' });
    expect(cover).toMatchObject({ properties: 'cover-image', mediaType: 'image/png' });
    expect(project.assets).toEqual([asset, cover]);
  });

  it('returns the stored asset from addImage', () => {
    const project = newProject();
    const image = project.addImage(0, {
      filename: 'fig.png',
      data: new Uint8Array([3]),
      atParagraphIndex: 1,
    });

    expect(image).toMatchObject({ href: 'OPS/Images/fig.png', mediaType: 'image/png' });
    expect(project.assets).toEqual([image]);
  });
});

describe('EpubProject.addImage', () => {
  it('decides the href and embeds the image at the paragraph index', async () => {
    const project = newProject();
    project.addImage(0, {
      filename: 'fig.png',
      data: new Uint8Array([9, 8]),
      alt: '挿絵',
      atParagraphIndex: 1,
    });

    const out = await project.export();
    const book = await parseEpub(out);
    expect(book.chapters[1].paragraphs.map((p) => p.text)).toEqual(['一', '最初。', '二つ目。']);
    const chapter = await entry(out, 'OPS/Text/chapter-001.xhtml');
    expect(chapter).toMatch(
      /最初。<\/p>\s*<figure[^>]*>.*src="\.\.\/Images\/fig\.png".*alt="挿絵"/su,
    );
    const zip = await JSZip.loadAsync(out);
    expect(Array.from((await zip.file('OPS/Images/fig.png')?.async('uint8array')) ?? [])).toEqual([
      9, 8,
    ]);
  });

  it('renames a filename that is already taken', () => {
    const project = newProject();
    const first = project.addImage(0, {
      filename: 'a.png',
      data: new Uint8Array([1]),
      atParagraphIndex: 0,
    });
    const second = project.addImage(0, {
      filename: 'a.png',
      data: new Uint8Array([2]),
      atParagraphIndex: 0,
    });

    expect(first.href).toBe('OPS/Images/a.png');
    expect(second.href).toBe('OPS/Images/a-2.png');
  });

  it('takes the media type from the input before the extension', () => {
    const project = newProject();
    const image = project.addImage(0, {
      filename: 'a.png',
      mediaType: 'image/webp',
      data: new Uint8Array([1]),
      atParagraphIndex: 0,
    });

    expect(image.mediaType).toBe('image/webp');
  });

  it('defers a url image to the asset resolver, with the href the class decided', async () => {
    const project = newProject();
    project.addImage(0, {
      filename: 'remote.png',
      url: 'https://cdn.example.test/r.png',
      atParagraphIndex: 0,
    });
    const seen: unknown[] = [];

    await project.export({
      assetResolver(request) {
        seen.push(request);
        return new Uint8Array([7]);
      },
    });

    expect(seen).toEqual([
      {
        url: 'https://cdn.example.test/r.png',
        href: 'OPS/Images/remote.png',
        mediaType: 'image/png',
      },
    ]);
  });

  it('drops the image asset together with the chapter that alone referenced it', () => {
    const project = newProject();
    project.addImage(0, { filename: 'a.png', data: new Uint8Array([1]), atParagraphIndex: 0 });
    project.removeChapter(0);

    expect(project.assets).toEqual([]);
  });

  it('rejects arguments the types rule out', () => {
    const project = newProject();
    const image = { filename: 'a.png', data: new Uint8Array([1]), atParagraphIndex: 0 };

    expect(() => project.addImage(5, image)).toThrow(RangeError);
    expect(() => project.addImage(-1, image)).toThrow(RangeError);
    expect(() => project.addImage(0, { ...image, atParagraphIndex: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => project.addImage(0, { ...image, atParagraphIndex: 0.5 })).toThrow(RangeError);
    expect(() => project.addImage(0, { ...image, filename: '' })).toThrow(TypeError);
    expect(() => project.addImage(0, { ...image, filename: '../a.png' })).toThrow(TypeError);
    expect(() => project.addImage(0, { ...image, filename: 'a#b.png' })).toThrow(TypeError);
    expect(() => project.addImage(0, { filename: 'a.png', atParagraphIndex: 0 } as never)).toThrow(
      TypeError,
    );
    expect(() => project.addImage(0, { ...image, data: 'bytes' as never })).toThrow(TypeError);
    expect(project.assets).toEqual([]);
    expect(project.chapters[0].body).toBe('最初。\n\n二つ目。');
  });

  it('replaces addInlineImage and carries bytes or a url, never both', () => {
    expect('addInlineImage' in newProject()).toBe(false);
    expectTypeErrors(
      `${PROBE_HEADER}
project.addImage(0, { filename: 'a.png', data: bytes, atParagraphIndex: 0 });
project.addImage(0, { filename: 'a.png', url: 'https://example.test/a.png', atParagraphIndex: 0 });
project.addImage(0, { filename: 'a.png', data: bytes });
project.addImage(0, { filename: 'a.png', atParagraphIndex: 0 });
project.addImage(0, { filename: 'a.png', data: bytes, url: 'https://example.test/a.png', atParagraphIndex: 0 });
project.addImage(0, { href: 'OPS/Images/a.png', data: bytes, atParagraphIndex: 0 });
project.addInlineImage(0, 0, { href: 'OPS/Images/a.png', data: bytes });`,
      {
        fails: [
          "project.addImage(0, { filename: 'a.png', data: bytes });",
          "project.addImage(0, { filename: 'a.png', atParagraphIndex: 0 });",
          "data: bytes, url: 'https://example.test/a.png', atParagraphIndex: 0 });",
          "project.addImage(0, { href: 'OPS/Images/a.png'",
          'project.addInlineImage(',
        ],
      },
    );
  });
});

describe('EpubProject cover', () => {
  it('stores the cover under a filename of its own and marks it as the cover image', async () => {
    const project = newProject();
    const cover = project.setCover({
      data: new Uint8Array([1, 2]),
      mediaType: 'image/png',
      filename: 'front.png',
    });

    expect(cover).toMatchObject({
      href: 'OPS/Images/front.png',
      mediaType: 'image/png',
      properties: 'cover-image',
    });
    const opf = await entry(await project.export(), 'OPS/package.opf');
    expect(opf).toContain(`<meta name="cover" content="${cover.id}" />`);
    expect(opf).toMatch(/href="Images\/front\.png"[^>]*properties="cover-image"/u);
  });

  it('falls back to cover.jpg without a filename, and keeps a single cover', () => {
    const project = newProject();
    project.setCover({ data: new Uint8Array([1]), mediaType: 'image/jpeg' });
    const replaced = project.setCover({
      url: 'https://cdn.example.test/c.jpg',
      mediaType: 'image/jpeg',
    });

    expect(replaced.href).toBe('OPS/Images/cover.jpg');
    expect(project.assets.filter((asset) => asset.properties === 'cover-image')).toEqual([
      replaced,
    ]);
  });

  it('registers the cover option of the constructor through the same input', () => {
    const project = newProject({ cover: { data: new Uint8Array([1]), mediaType: 'image/png' } });

    expect(project.assets).toHaveLength(1);
    expect(project.assets[0].properties).toBe('cover-image');
  });

  it('rejects a filename that is not a clean file name', () => {
    const project = newProject();

    expect(() =>
      project.setCover({ data: new Uint8Array([1]), mediaType: 'image/png', filename: '/c.png' }),
    ).toThrow(TypeError);
    expect(() =>
      project.setCover({ data: new Uint8Array([1]), mediaType: 'image/png', filename: 'a?b.png' }),
    ).toThrow(TypeError);
    expect(project.assets).toEqual([]);
  });

  it('takes bytes or a url with a media type, and no manifest properties', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
project.setCover({ data: bytes, mediaType: 'image/png' });
project.setCover({ url: 'https://example.test/c.png', mediaType: 'image/png', filename: 'c.png' });
project.setCover({ data: bytes });
project.setCover({ data: bytes, mediaType: 'image/png', properties: 'cover-image' });
project.setCover({ href: 'OPS/Images/c.png', data: bytes });
project.setCover({ data: bytes, url: 'https://example.test/c.png', mediaType: 'image/png' });`,
      {
        fails: [
          'project.setCover({ data: bytes });',
          "properties: 'cover-image' });",
          "project.setCover({ href: 'OPS/Images/c.png'",
          "project.setCover({ data: bytes, url: 'https://example.test/c.png'",
        ],
      },
    );
  });
});

describe('EpubProject assets', () => {
  it('takes bytes or a url, and rejects an asset that has neither', () => {
    const project = newProject();

    expect(() => project.addAsset({ href: 'OPS/Images/a.png' } as never)).toThrow(TypeError);
    expect(() => project.addAsset({ href: 'OPS/Images/a.png', data: 'bytes' as never })).toThrow(
      TypeError,
    );
    expectTypeErrors(
      `${PROBE_HEADER}
project.addAsset({ href: 'OPS/Images/a.png', data: bytes });
project.addAsset({ href: 'OPS/Images/a.png', url: 'https://example.test/a.png' });
project.addAsset({ href: 'OPS/Images/a.png' });
project.addAsset({ href: 'OPS/Images/a.png', data: bytes, url: 'https://example.test/a.png' });`,
      {
        fails: [
          "project.addAsset({ href: 'OPS/Images/a.png' });",
          "data: bytes, url: 'https://example.test/a.png' });",
        ],
      },
    );
  });

  it('rejects an href that is not a clean relative path with a TypeError', () => {
    const project = newProject();
    const data = new Uint8Array([1]);

    for (const href of [
      '',
      'OPS/Images/',
      '../a.png',
      '/a.png',
      'https://a.test/a.png',
      'a#b.png',
    ]) {
      expect(() => project.addAsset({ href, data })).toThrow(TypeError);
    }
    expect(project.assets).toEqual([]);
  });

  it('keeps its own copy of the bytes, reading only the range of a view', async () => {
    const backing = new Uint8Array([0, 0, 5, 6, 7, 0]);
    const project = newProject();
    project.addAsset({ href: 'OPS/Images/v.png', data: backing.subarray(2, 5) });
    backing.fill(9);

    const zip = await JSZip.loadAsync(await project.export());
    expect(Array.from((await zip.file('OPS/Images/v.png')?.async('uint8array')) ?? [])).toEqual([
      5, 6, 7,
    ]);
  });
});

describe('EpubProject metadata and stylesheet', () => {
  it('merges a metadata patch and skips undefined fields', async () => {
    const project = newProject();
    const before = project.metadata;
    project.updateMetadata({ title: '改題', publisher: '出版社', subtitle: undefined });

    expect(project.metadata).toMatchObject({
      title: '改題',
      publisher: '出版社',
      identifier: 'urn:uuid:contract-book',
      language: 'ja',
    });
    expect(project.metadata).not.toBe(before);
    expect(before.title).toBe('契約');
    const opf = await entry(await project.export(), 'OPS/package.opf');
    expect(opf).toContain('<dc:title id="title">改題</dc:title>');
    expect(opf).toContain('<dc:publisher>出版社</dc:publisher>');
  });

  it('replaces a blank identifier in a patch like the constructor does', () => {
    const project = newProject();
    project.updateMetadata({ identifier: '  ' });

    expect(project.metadata.identifier).toMatch(/^urn:uuid:/u);
    expect(project.metadata.identifier).not.toBe('urn:uuid:contract-book');
  });

  it('writes the stylesheet that setStylesheet replaced', async () => {
    const project = newProject();
    project.setStylesheet('p { color: red; }');

    expect(project.stylesheet).toBe('p { color: red; }');
    expect(await entry(await project.export(), 'OPS/Styles/style.css')).toBe('p { color: red; }');
  });

  it('exposes creators only through creators, with no author or series shortcut', async () => {
    const project = newProject({
      metadata: {
        title: '題',
        identifier: 'urn:uuid:creators-book',
        creators: [{ name: '作者', role: 'aut' }],
        collections: [{ name: '叢書', index: 2 }],
      },
    });
    const out = await project.export();
    const opf = await entry(out, 'OPS/package.opf');

    expect(opf).toContain('>作者</dc:creator>');
    expect(opf).not.toContain('calibre:series');
    expect((await parseEpub(out)).author).toBe('作者');
    expectTypeErrors(
      `${PROBE_HEADER}
new EpubProject({ metadata: { title: 'T', creators: [{ name: 'A', role: 'aut' }] } });
new EpubProject({ metadata: { title: 'T', author: 'A' } });
new EpubProject({ metadata: { title: 'T', series: { name: 'S' } } });
project.updateMetadata({ author: 'A' });`,
      {
        fails: [
          "author: 'A' } });",
          "series: { name: 'S' } } });",
          'project.updateMetadata({ author',
        ],
      },
    );
  });
});

describe('EpubProject state is read through readonly views', () => {
  it('rejects writes to chapters, assets, metadata and the stylesheet', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
const title: string = project.chapters[0].title;
const href: string = project.assets[0].href;
const name: string = project.metadata.title;
project.updateMetadata({ title: 'U' });
project.setStylesheet('p {}');
project.chapters.push({ id: 'x', title: 'x', body: 'x' });
project.chapters[0].title = 'x';
project.chapters[0].body = 'x';
project.assets.splice(0, 1);
project.metadata.title = 'x';
project.stylesheet = 'x';
export const read = [title, href, name];`,
      {
        fails: [
          'project.chapters.push(',
          "project.chapters[0].title = 'x'",
          "project.chapters[0].body = 'x'",
          'project.assets.splice(',
          "project.metadata.title = 'x'",
          "project.stylesheet = 'x'",
        ],
      },
    );
  });

  it('accepts readonly chapter and creator lists as input', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
const chapters: readonly ManuscriptChapter[] = [];
const creators: readonly { name: string }[] = [];
new EpubProject({ metadata: { title: 'T', creators, subjects: ['a'] }, chapters });
export const same: CoreManuscriptChapter[] = [...chapters];`,
      { fails: [] },
    );
  });
});

describe('EpubProject.export', () => {
  it('resolves to the EPUB bytes as a Uint8Array', async () => {
    const out = await newProject().export();

    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out.subarray(0, 2))).toEqual([0x50, 0x4b]);
    expect((await parseEpub(out)).title).toBe('契約');
  });

  it('rejects a project without chapters with epub-invalid-package', async () => {
    const empty = new EpubProject({ metadata: { title: '空' } });
    const failure = await empty.export().catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(MejiroError);
    expect(failure).toMatchObject({
      name: 'MejiroError',
      code: 'epub-invalid-package' satisfies MejiroErrorCode,
    });
  });

  it('rejects with the reason of a signal that is already aborted, before reporting progress', async () => {
    const controller = new AbortController();
    const reason = new Error('stop');
    controller.abort(reason);
    const phases: string[] = [];

    await expect(
      newProject().export({ signal: controller.signal, onProgress: (phase) => phases.push(phase) }),
    ).rejects.toBe(reason);
    expect(phases).toEqual([]);
  });

  it('rejects with the abort reason and reports no progress afterwards', async () => {
    const controller = new AbortController();
    const reason = new Error('late stop');
    const seen: string[] = [];

    await expect(
      newProject({
        chapters: [
          { title: '一', body: 'a' },
          { title: '二', body: 'b' },
        ],
      }).export({
        signal: controller.signal,
        onProgress(phase) {
          seen.push(phase);
          controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(seen).toEqual(['serialize']);
  });

  it('rejects a signal that is not an AbortSignal with a TypeError', async () => {
    await expect(newProject().export({ signal: {} as AbortSignal })).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('takes the options both export entry points share and no watermark', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
export const out: Promise<Uint8Array> = project.export({ onProgress: () => {}, signal: new AbortController().signal });
export const marked = project.export({ watermark: 'draft' });`,
      { fails: ["watermark: 'draft'"] },
    );
  });
});

describe('EpubProject chapter indices', () => {
  it('rejects an index that names no chapter with a RangeError', () => {
    const project = newProject();

    expect(() => project.updateChapter(3, { title: 'x' })).toThrow(RangeError);
    expect(() => project.updateChapter(-1, { title: 'x' })).toThrow(RangeError);
    expect(() => project.removeChapter(1)).toThrow(RangeError);
    expect(() => project.removeChapter(-1)).toThrow(RangeError);
    expect(project.chapters).toHaveLength(1);
  });

  it('requires the index of removeChapter', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
project.removeChapter(0);
project.removeChapter();`,
      { fails: ['project.removeChapter();'] },
    );
  });
});

describe('mejiro/epub project module', () => {
  it('does not re-export the manuscript ruby parser', () => {
    expect('parseManuscriptRuby' in projectModule).toBe(false);
  });
});
