/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as epubEntry from '@libraz/mejiro/epub';
import {
  type AssetResolverRequest,
  clampEditableEpubSelection,
  cloneEditableEpubBook,
  type EditableEpub,
  editableEpubToEpubBook,
  MejiroError,
  type MejiroErrorCode,
  parseEditableEpub,
  parseEpub,
} from '@libraz/mejiro/epub';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

const containerXml = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>`;

function opf(chapters: readonly string[], manifestExtra = ''): string {
  return `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>契約</dc:title></metadata>
  <manifest>
${chapters.map((_, i) => `    <item id="c${i}" href="Text/c${i}.xhtml" media-type="application/xhtml+xml" />`).join('\n')}${manifestExtra}
  </manifest>
  <spine>${chapters.map((_, i) => `<itemref idref="c${i}" />`).join('')}</spine>
</package>`;
}

const xhtml = (body: string) => `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章</title></head><body>${body}</body></html>`;

async function makeEpub(
  chapters: readonly string[] = [xhtml('<p>一段落</p><p>二段落</p>')],
  extra: Record<string, string | Uint8Array> = {},
  manifestExtra = '',
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', containerXml);
  zip.file('OPS/package.opf', opf(chapters, manifestExtra));
  chapters.forEach((chapter, i) => {
    zip.file(`OPS/Text/c${i}.xhtml`, chapter);
  });
  for (const [path, contents] of Object.entries(extra)) zip.file(path, contents);
  return zip.generateAsync({ type: 'uint8array' });
}

async function open(...args: Parameters<typeof makeEpub>): Promise<EditableEpub> {
  return parseEditableEpub(await makeEpub(...args));
}

async function chapterXhtml(out: Uint8Array, index = 0): Promise<string> {
  const zip = await JSZip.loadAsync(out);
  return (await zip.file(`OPS/Text/c${index}.xhtml`)?.async('string')) ?? '';
}

/** Rejection value of `promise`, or fails when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

async function expectCode(promise: Promise<unknown>, code: MejiroErrorCode): Promise<void> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(MejiroError);
  expect((error as MejiroError).code).toBe(code);
}

const PROBE_HEADER = `import {
  type AssetResolverRequest,
  type EditableEpub,
  type EditableEpubBook,
  type EditableEpubChapter,
  type EditableImageAsset,
  type NewParagraph,
  type ParagraphPatch,
} from '@libraz/mejiro/epub';
declare const editor: EditableEpub;
declare const epub: EditableEpubBook;
declare const chapter: EditableEpubChapter;
`;

describe('EditableEpub paragraph input', () => {
  it('inserts with text alone and returns the stored block', async () => {
    const editor = await open();
    const block = editor.insertParagraph(0, 0, { text: '新しい段落' });

    expect(block).toMatchObject({ kind: 'paragraph', text: '新しい段落', inlineAnnotations: [] });
    expect(editor.chapters[0].blocks[0]).toBe(block);
    expect(editor.chapters[0].blocks.filter((b) => b.id === block.id)).toHaveLength(1);
  });

  it('types a new paragraph so its kind decides the fields it carries', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
const plain: NewParagraph = { text: '本文' };
const quoted: NewParagraph = { text: '引用', paragraphKind: 'blockquote' };
const heading: NewParagraph = { text: '見出し', paragraphKind: 'heading', headingLevel: 2 };
const sceneBreak: NewParagraph = { paragraphKind: 'sceneBreak' };
const levelless: NewParagraph = { text: '見出し', paragraphKind: 'heading' };
const bodyWithLevel: NewParagraph = { text: '本文', paragraphKind: 'body', headingLevel: 2 };
const breakWithText: NewParagraph = { paragraphKind: 'sceneBreak', text: '消える' };
const levelSeven: NewParagraph = { text: '見出し', paragraphKind: 'heading', headingLevel: 7 };
export const values = [plain, quoted, heading, sceneBreak, levelless, bodyWithLevel, breakWithText, levelSeven];`,
      {
        fails: [
          'const levelless',
          'const bodyWithLevel',
          'const breakWithText',
          'const levelSeven',
        ],
      },
    );
  });

  it('rejects at run time what the paragraph types rule out, before recording anything', async () => {
    const editor = await open();
    const insert = (paragraph: unknown) =>
      editor.insertParagraph(0, 0, paragraph as Parameters<EditableEpub['insertParagraph']>[2]);

    for (const headingLevel of [0, 7, 1.5]) {
      expect(() => insert({ text: '見出し', paragraphKind: 'heading', headingLevel })).toThrow(
        RangeError,
      );
    }
    expect(() => insert({ text: '見出し', paragraphKind: 'heading' })).toThrow(TypeError);
    expect(() => insert({ text: '本文', paragraphKind: 'body', headingLevel: 2 })).toThrow(
      TypeError,
    );
    expect(() => insert({ paragraphKind: 'sceneBreak', text: '消える' })).toThrow(TypeError);
    expect(() => insert({ text: '図', paragraphKind: 'figure' })).toThrow(RangeError);
    expect(() => editor.insertParagraph(9, 0, { text: 'なし' })).toThrow(RangeError);
    expect(editor.history.depth).toBe(0);

    expect(insert({ paragraphKind: 'sceneBreak' })).toMatchObject({
      paragraphKind: 'sceneBreak',
      text: '',
    });
  });
});

describe('EditableEpub block addressing', () => {
  it('updates and annotates a paragraph by block id', async () => {
    const editor = await open();
    const [first, second] = editor.chapters[0].blocks;

    editor.updateParagraph(0, second.id, { text: '改稿' });
    editor.setInlineAnnotations(0, second.id, [{ type: 'em', startIndex: 0, endIndex: 1 }]);

    expect(editor.chapters[0].blocks[0]).toBe(first);
    expect(editor.chapters[0].blocks[1]).toMatchObject({
      id: second.id,
      text: '改稿',
      inlineAnnotations: [{ type: 'em', startIndex: 0, endIndex: 1 }],
    });
  });

  it('rejects an unknown, empty or wrong-kind block id with RangeError', async () => {
    const editor = await open(
      [xhtml('<p>本文</p><figure><img src="../Images/a.png" /></figure>')],
      {
        'OPS/Images/a.png': new Uint8Array([1]),
      },
    );
    const image = editor.chapters[0].blocks[1];
    const paragraph = editor.chapters[0].blocks[0];

    for (const blockId of ['missing', '']) {
      expect(() => editor.updateParagraph(0, blockId, { text: 'x' })).toThrow(RangeError);
      expect(() => editor.deleteBlock(0, blockId)).toThrow(RangeError);
    }
    expect(() => editor.updateParagraph(0, image.id, { text: 'x' })).toThrow(RangeError);
    expect(() => editor.setInlineAnnotations(0, image.id, [])).toThrow(RangeError);
    expect(() => editor.splitParagraph(0, image.id, 0)).toThrow(RangeError);
    expect(() => editor.updateImage(0, paragraph.id, { alt: 'x' })).toThrow(RangeError);
    expect(() => editor.setInlineAnnotations(3, paragraph.id, [])).toThrow(RangeError);
    expect(editor.history.depth).toBe(0);
  });

  it('takes block ids, not paragraph indices, in its signatures', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
editor.updateParagraph(0, 'b-1', { text: 'x' });
editor.setInlineAnnotations(0, 'b-1', []);
editor.updateParagraph(0, 1, { text: 'by index' });
editor.setInlineAnnotations(0, 1, []);`,
      { fails: ["0, 1, { text: 'by index' }", 'editor.setInlineAnnotations(0, 1, [])'] },
    );
  });
});

describe('EditableEpub images', () => {
  it('returns the image block, whose id the follow-up edits take', async () => {
    const editor = await open();
    const block = editor.addImage(0, { filename: 'a.png', data: new Uint8Array([1]) });

    expect(block).toMatchObject({ kind: 'image', assetKey: 'a.png' });
    expect(editor.chapters[0].blocks.at(-1)).toBe(block);
    editor.setImageCaption(0, block.id, '図1');
    expect(await chapterXhtml(await editor.export())).toContain('<figcaption>図1</figcaption>');
  });

  it('clears a caption with null', async () => {
    const editor = await open();
    const block = editor.addImage(0, {
      filename: 'a.png',
      data: new Uint8Array([1]),
      caption: '図',
    });

    editor.setImageCaption(0, block.id, null);

    expect(editor.chapters[0].blocks.at(-1)).not.toHaveProperty('caption');
    expect(await chapterXhtml(await editor.export())).not.toContain('figcaption');
  });

  it('deletes one block, and removes an asset with every block that shows it', async () => {
    const shared = '<figure><img src="../Images/s.png" alt="共有" /></figure>';
    const editor = await open(
      [xhtml(`<p>一</p>${shared}<p>中</p>`), xhtml(`<p>二</p>${shared}`)],
      { 'OPS/Images/s.png': new Uint8Array([5]) },
      '<item id="s" href="Images/s.png" media-type="image/png" />',
    );

    editor.deleteBlock(0, editor.chapters[0].blocks[2].id);
    expect(editor.chapters[0].blocks.map((b) => b.kind)).toEqual(['paragraph', 'image']);
    expect(editor.chapters[0].imageAssets.has('s.png')).toBe(true);

    editor.removeImageAsset('s.png');
    expect(editor.chapters.map((c) => c.blocks.map((b) => b.kind))).toEqual([
      ['paragraph'],
      ['paragraph'],
    ]);
    expect(editor.chapters.some((c) => c.imageAssets.has('s.png'))).toBe(false);
    const zip = await JSZip.loadAsync(await editor.export());
    expect(zip.file('OPS/Images/s.png')).toBeNull();

    expect(editor.undo()).toBe(true);
    expect(editor.chapters.map((c) => c.blocks.map((b) => b.kind))).toEqual([
      ['paragraph', 'image'],
      ['paragraph', 'image'],
    ]);
    expect(() => editor.removeImageAsset('missing.png')).toThrow(RangeError);
  });

  it('copies the bytes of a data input and reads a Uint8Array through its own view', async () => {
    const editor = await open();
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    editor.addImage(0, { filename: 'v.png', data: view });
    view[0] = 7;

    const zip = await JSZip.loadAsync(await editor.export());
    expect(Array.from((await zip.file('OPS/Images/v.png')?.async('uint8array')) ?? [])).toEqual([
      1, 2, 3,
    ]);
  });

  it('has no image shape besides the filename one, and no removeImage', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
editor.addImage(0, { filename: 'a.png', data: new Uint8Array([1]) });
editor.addImage(0, { href: 'OPS/Images/a.png', mediaType: 'image/png', data: new Uint8Array([1]) });
editor.addImage(0, { filename: 'a.png', data: new Uint8Array([1]), afterParagraph: 0 });
editor.removeImage(0, 'a.png');`,
      { fails: ["{ href: 'OPS/Images/a.png'", 'afterParagraph: 0', 'editor.removeImage'] },
    );
  });
});

describe('mejiro/epub editing entry points', () => {
  it('exports one way to open and one way to export an editing session', async () => {
    const entry = epubEntry as Record<string, unknown>;
    for (const name of [
      'exportEditableEpub',
      'updateEpubParagraph',
      'setEpubInlineAnnotations',
      'addEpubChapterImage',
    ]) {
      expect(entry[name]).toBeUndefined();
    }
    const editor = await open();
    expect((editor.constructor as unknown as Record<string, unknown>).load).toBeUndefined();
    expect(await editor.export()).toBeInstanceOf(Uint8Array);
  });

  it('drops the paragraph projection and the legacy image shape from the editable types', async () => {
    const editor = await open();
    expect(Object.keys(editor.chapters[0]).sort()).toEqual([
      'blocks',
      'href',
      'imageAssets',
      'originalXhtml',
      'title',
    ]);
    expectTypeErrors(
      `${PROBE_HEADER}
export const blocks = chapter.blocks;
export const paragraphs = chapter.paragraphs;
export const refs = chapter.paragraphRefs;
export const images = chapter.images;
import type { EditableEpubImage } from '@libraz/mejiro/epub';`,
      {
        fails: [
          'chapter.paragraphs',
          'chapter.paragraphRefs',
          'chapter.images',
          'EditableEpubImage',
        ],
      },
    );
  });

  it('keeps export state off the public book, chapter and asset types', async () => {
    const editor = await open(
      [xhtml('<p>本文</p><figure><img src="../Images/a.png" /></figure>')],
      {
        'OPS/Images/a.png': new Uint8Array([1]),
      },
    );
    expect(Object.keys(editor.epub).sort()).toEqual(['author', 'chapters', 'title']);
    expect(Object.keys(editor.chapters[0].imageAssets.get('a.png') ?? {}).sort()).toEqual([
      'data',
      'filename',
      'href',
      'mediaType',
    ]);
    expectTypeErrors(
      `${PROBE_HEADER}
export const title = epub.title;
export const packageData = epub.packageData;
export const dirty = chapter.isDirty;
export const hrefs = chapter.originalImageHrefs;
export const bytes: EditableImageAsset = { filename: 'a.png', data: new Uint8Array([1]) };
export const remote: EditableImageAsset = { filename: 'a.png', url: 'https://example.test/a.png' };
export const both: EditableImageAsset = { filename: 'a.png', data: new Uint8Array([1]), url: 'u' };
export const neither: EditableImageAsset = { filename: 'a.png' };`,
      {
        fails: [
          'epub.packageData',
          'chapter.isDirty',
          'chapter.originalImageHrefs',
          'const both',
          'const neither',
        ],
      },
    );
  });

  it('holds its document as epub', async () => {
    const editor = await open();
    expect(editor.epub.chapters).toBe(editor.chapters);
    expect('book' in editor).toBe(false);
  });
});

describe('EditableEpub paragraph updates', () => {
  it('changes the kind of a paragraph in place, keeping its id', async () => {
    const editor = await open();
    const block = editor.chapters[0].blocks[0];

    editor.updateParagraph(0, block.id, { paragraphKind: 'blockquote' });
    expect(editor.chapters[0].blocks[0]).toMatchObject({
      id: block.id,
      paragraphKind: 'blockquote',
    });

    editor.updateParagraph(0, block.id, { paragraphKind: 'heading', headingLevel: 3 });
    editor.updateParagraph(0, block.id, { headingLevel: 2 });
    expect(await chapterXhtml(await editor.export())).toContain('<h2>一段落</h2>');

    editor.updateParagraph(0, block.id, { paragraphKind: 'body' });
    expect(editor.chapters[0].blocks[0]).not.toHaveProperty('headingLevel');
    expect(editor.chapters[0].blocks[0]).not.toHaveProperty('paragraphKind');

    editor.updateParagraph(0, block.id, { paragraphKind: 'sceneBreak' });
    expect(await chapterXhtml(await editor.export())).toMatch(/<hr ?\/>/u);
  });

  it('requires the fields a new kind needs in the patch type', () => {
    expectTypeErrors(
      `${PROBE_HEADER}
const text: ParagraphPatch = { text: '改稿' };
const quote: ParagraphPatch = { paragraphKind: 'blockquote' };
const heading: ParagraphPatch = { paragraphKind: 'heading', headingLevel: 2 };
const level: ParagraphPatch = { headingLevel: 3 };
const sceneBreak: ParagraphPatch = { paragraphKind: 'sceneBreak' };
const levelless: ParagraphPatch = { paragraphKind: 'heading' };
const breakWithText: ParagraphPatch = { paragraphKind: 'sceneBreak', text: 'x' };
const quoteWithLevel: ParagraphPatch = { paragraphKind: 'blockquote', headingLevel: 2 };
export const patches = [text, quote, heading, level, sceneBreak, levelless, breakWithText, quoteWithLevel];`,
      { fails: ['const levelless', 'const breakWithText', 'const quoteWithLevel'] },
    );
  });

  it('rejects at run time a patch its target cannot take', async () => {
    const editor = await open([xhtml('<p>本文</p><hr /><h2>見出し</h2>')]);
    const [body, sceneBreak, heading] = editor.chapters[0].blocks;
    const update = (blockId: string, patch: unknown) =>
      editor.updateParagraph(0, blockId, patch as Parameters<EditableEpub['updateParagraph']>[2]);

    expect(() => update(sceneBreak.id, { text: '消える' })).toThrow(TypeError);
    expect(() => update(body.id, { headingLevel: 2 })).toThrow(TypeError);
    expect(() => update(body.id, { paragraphKind: 'heading' })).toThrow(TypeError);
    expect(() => update(heading.id, { headingLevel: 9 })).toThrow(RangeError);
    expect(() => update(body.id, { paragraphKind: 'figure' })).toThrow(RangeError);
    expect(editor.history.depth).toBe(0);
  });
});

describe('EditableEpub.transaction', () => {
  it('rejects an async callback by type and returns what a sync one returns', async () => {
    expectTypeErrors(
      `${PROBE_HEADER}
export const count: number = editor.transaction(() => 3);
export const pending = editor.transaction(async () => 3);`,
      { fails: ['async () => 3'] },
    );
    const editor = await open();
    const block = editor.transaction(() => editor.insertParagraph(0, 0, { text: '一括' }));
    expect(block.text).toBe('一括');
    expect(editor.history.depth).toBe(1);
  });
});

describe('EditableEpub.subscribe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies after each edit, once per transaction, and on undo and redo', async () => {
    const editor = await open();
    const [first, second] = editor.chapters[0].blocks;
    const calls: unknown[][] = [];
    const off = editor.subscribe((...args) => calls.push(args));

    editor.updateParagraph(0, first.id, { text: 'a' });
    expect(calls).toEqual([[]]);
    editor.transaction(() => {
      editor.updateParagraph(0, first.id, { text: 'b' });
      editor.updateParagraph(0, second.id, { text: 'c' });
    });
    expect(calls).toHaveLength(2);
    editor.undo();
    editor.redo();
    expect(calls).toHaveLength(4);

    expect(() =>
      editor.transaction(() => {
        editor.updateParagraph(0, first.id, { text: 'd' });
        throw new Error('rolled back');
      }),
    ).toThrow('rolled back');
    expect(() => editor.updateParagraph(0, 'missing', { text: 'e' })).toThrow(RangeError);
    expect(calls).toHaveLength(4);

    off();
    off();
    editor.updateParagraph(0, first.id, { text: 'f' });
    expect(calls).toHaveLength(4);
  });

  it('keeps notifying the others when a listener throws, and rethrows on a microtask', async () => {
    const editor = await open();
    const thrown = new Error('listener failed');
    const rethrown: unknown[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      try {
        task();
      } catch (error) {
        rethrown.push(error);
      }
    });
    let reached = false;
    editor.subscribe(() => {
      throw thrown;
    });
    editor.subscribe(() => {
      reached = true;
    });

    editor.updateParagraph(0, editor.chapters[0].blocks[0].id, { text: 'x' });

    expect(reached).toBe(true);
    expect(rethrown).toEqual([thrown]);
  });
});

describe('EditableEpubSelection', () => {
  it('addresses a block by chapter index and block id', async () => {
    const editor = await open([xhtml('<p>一</p>'), xhtml('<p>二</p><p>三</p>')]);
    const [, third] = editor.chapters[1].blocks;

    expect(clampEditableEpubSelection(editor.epub, { chapterIndex: 1, blockId: third.id })).toEqual(
      { chapterIndex: 1, blockId: third.id },
    );
    expect(clampEditableEpubSelection(editor.epub, { chapterIndex: 7.5, blockId: 'gone' })).toEqual(
      { chapterIndex: 1, blockId: editor.chapters[1].blocks[0].id },
    );
    expect(clampEditableEpubSelection(editor.epub, { chapterIndex: 0, blockId: null })).toEqual({
      chapterIndex: 0,
      blockId: null,
    });
    expect(clampEditableEpubSelection(null, { chapterIndex: 3, blockId: 'x' })).toEqual({
      chapterIndex: 0,
      blockId: null,
    });
    expectTypeErrors(
      `import type { EditableEpubSelection } from '@libraz/mejiro/epub';
export const ok: EditableEpubSelection = { chapterIndex: 0, blockId: null };
export const old: EditableEpubSelection = { chapter: 0, paragraph: 0 };`,
      { fails: ['const old'] },
    );
  });
});

describe('EditableEpub asset resolver', () => {
  it('hands the resolver the URL, the ZIP path it fills and the media type', async () => {
    const editor = await open();
    editor.addImage(0, {
      filename: 'r.png',
      mediaType: 'image/png',
      url: 'https://cdn.test/r.png',
    });
    const seen: AssetResolverRequest[] = [];

    const out = await editor.export({
      assetResolver(request) {
        seen.push(request);
        return new Uint8Array([4]);
      },
    });

    expect(seen).toEqual([
      { url: 'https://cdn.test/r.png', href: 'OPS/Images/r.png', mediaType: 'image/png' },
    ]);
    const zip = await JSZip.loadAsync(out);
    expect(Array.from((await zip.file(seen[0].href)?.async('uint8array')) ?? [])).toEqual([4]);
    expectTypeErrors(
      `${PROBE_HEADER}
declare const request: AssetResolverRequest;
export const href: string = request.href;
export const asset = request.asset;
export const key = request.assetKey;`,
      { fails: ['request.asset;', 'request.assetKey'] },
    );
  });

  it('reports a failed default fetch as asset-fetch-failed', async () => {
    const editor = await open();
    editor.addImage(0, { filename: 'r.png', url: 'https://cdn.test/r.png' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    try {
      await expectCode(editor.export(), 'asset-fetch-failed');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('EditableEpub export cancellation and progress', () => {
  it('rejects with the signal reason, an AbortError by default', async () => {
    const editor = await open();
    const reason = new Error('left the page');
    await expect(editor.export({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);

    const controller = new AbortController();
    controller.abort();
    const error = await rejection(editor.export({ signal: controller.signal }));
    expect(error).toBe(controller.signal.reason);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('stops reporting progress once aborted', async () => {
    const editor = await open();
    const controller = new AbortController();
    const events: [string, number][] = [];
    await rejection(
      editor.export({
        signal: controller.signal,
        onProgress(phase, ratio) {
          events.push([phase, ratio]);
          if (phase === 'zip') controller.abort();
        },
      }),
    );
    expect(events.filter(([phase]) => phase === 'zip')).toHaveLength(1);
  });

  it('reports each phase from 0 to 1', async () => {
    const editor = await open([xhtml('<p>一</p>'), xhtml('<p>二</p>')]);
    const events: [string, number][] = [];
    await editor.export({ onProgress: (phase, ratio) => events.push([phase, ratio]) });

    for (const phase of ['serialize', 'zip']) {
      const ratios = events.filter(([p]) => p === phase).map(([, ratio]) => ratio);
      expect(ratios[0]).toBe(0);
      expect(ratios.at(-1)).toBe(1);
      expect(
        ratios.every((ratio, i) => ratio >= 0 && ratio <= 1 && ratio >= (ratios[i - 1] ?? 0)),
      ).toBe(true);
    }
    expect(events.findIndex(([p]) => p === 'zip')).toBeGreaterThan(
      events.findLastIndex(([p]) => p === 'serialize'),
    );
  });
});

describe('parseEditableEpub', () => {
  it('takes the parse options of parseEpub, rejecting with the signal reason', async () => {
    const data = await makeEpub();
    const reason = new Error('cancelled');
    await expect(parseEditableEpub(data, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    await expectCode(parseEditableEpub(data, { limits: { maxEntries: 1 } }), 'epub-limit-exceeded');
    await expect(
      parseEditableEpub(data, { signal: {} as unknown as AbortSignal }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('reads a Uint8Array through its own view and exports a Uint8Array', async () => {
    const bytes = await makeEpub();
    const padded = new Uint8Array(bytes.length + 64).fill(0xaa);
    padded.set(bytes, 21);
    const view = padded.subarray(21, 21 + bytes.length);
    const before = padded.slice();

    const editor = await parseEditableEpub(view);
    const out = await editor.export();

    expect(editor.chapters[0].blocks[0]).toMatchObject({ text: '一段落' });
    expect(padded).toEqual(before);
    expect(out).toBeInstanceOf(Uint8Array);
    expect((await parseEpub(out)).chapters[0].paragraphs[0].text).toBe('一段落');
    await expect(parseEditableEpub(null as unknown as Uint8Array)).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('reports unreadable archives, malformed packages and unexportable edits by code', async () => {
    await expectCode(parseEditableEpub(new Uint8Array()), 'epub-invalid-archive');
    await expectCode(parseEditableEpub(new Uint8Array([1])), 'epub-invalid-archive');
    const zip = new JSZip();
    zip.file('META-INF/container.xml', containerXml);
    await expectCode(
      parseEditableEpub(await zip.generateAsync({ type: 'uint8array' })),
      'epub-invalid-package',
    );
    await expectCode(open([xhtml('<p>unterminated')]), 'epub-invalid-package');
    await expectCode(open([xhtml('')]), 'epub-invalid-package');

    const editor = await open([xhtml('<p>前</p><ul><li>項目</li></ul>')]);
    editor.updateParagraph(0, editor.chapters[0].blocks[0].id, { text: '編集' });
    await expectCode(editor.export(), 'epub-unsupported-content');
  });
});

describe('EditableEpub export watermark', () => {
  const MARK = '[mejiro-watermark] 見本';

  it('puts the watermark first in edited, untouched and rebuilt chapters of the export only', async () => {
    const untouched = xhtml('<p>未編集</p>');
    const unnamespaced = '<?xml version="1.0"?><html><body><p>名前空間なし</p></body></html>';
    const editor = await open([xhtml('<p>編集前</p>'), untouched, unnamespaced]);
    const edited = editor.chapters[0].blocks[0];
    editor.updateParagraph(0, edited.id, { text: '編集後' });
    const before = cloneEditableEpubBook(editor.epub);

    const out = await editor.export({ watermark: MARK });

    const parsed = await parseEpub(out);
    expect(parsed.chapters.map((chapter) => chapter.paragraphs.map((p) => p.text))).toEqual([
      [MARK, '編集後'],
      [MARK, '未編集'],
      [MARK, '名前空間なし'],
    ]);
    expect(await chapterXhtml(out, 1)).toBe(untouched.replace('<body>', `<body><p>${MARK}</p>`));
    expect(editor.epub).toEqual(before);
    expect(editor.history.depth).toBe(1);
    expect((await parseEpub(await editor.export())).chapters[1].paragraphs[0].text).toBe('未編集');
  });

  it('gives the watermark block an id the chapter does not use', async () => {
    const editor = await open([xhtml('<p>本文</p>')]);
    const block = editor.chapters[0].blocks[0];
    editor.insertParagraph(0, 0, { text: '先頭' });
    const out = await editor.export({ watermark: MARK });

    const reopened = await parseEditableEpub(out);
    expect(reopened.chapters[0].blocks.map((b) => (b.kind === 'paragraph' ? b.text : ''))).toEqual([
      MARK,
      '先頭',
      '本文',
    ]);
    expect(editor.chapters[0].blocks.map((b) => b.id)).toContain(block.id);
  });

  it('copies the edited book without sharing its chapters', async () => {
    const editor = await open([xhtml('<p>本文</p>')]);
    editor.updateParagraph(0, editor.chapters[0].blocks[0].id, { text: '編集' });
    const copy = cloneEditableEpubBook(editor.epub);

    expect(copy).toEqual(editor.epub);
    expect(copy.chapters[0]).not.toBe(editor.chapters[0]);
  });
});

describe('editableEpubToEpubBook', () => {
  it('projects an unedited book onto what parseEpub reads, and shows an edit', async () => {
    const data = await makeEpub(
      [
        xhtml(
          '<h2>見出し</h2><p>本<ruby>文<rt>ぶん</rt></ruby><em>強</em></p><hr/><blockquote><p>引用</p></blockquote><figure><img src="../Images/a.png" alt="図"/><figcaption>説明</figcaption></figure><pre>a\nb</pre>',
        ),
        xhtml('<p>二章</p>'),
      ],
      { 'OPS/Images/a.png': new Uint8Array([1]) },
      '<item id="a" href="Images/a.png" media-type="image/png" />',
    );
    const editor = await parseEditableEpub(data);

    const projected = editableEpubToEpubBook(editor.epub);

    expect(projected).toEqual(await parseEpub(data));
    const paragraph = projected.chapters[0].paragraphs[1];
    expect(paragraph.inlineAnnotations).not.toBe(
      editor.chapters[0].blocks[1].kind === 'paragraph'
        ? editor.chapters[0].blocks[1].inlineAnnotations
        : undefined,
    );

    editor.updateParagraph(0, editor.chapters[0].blocks[1].id, {
      text: '改稿',
      inlineAnnotations: [],
    });
    expect(editableEpubToEpubBook(editor.epub).chapters[0].paragraphs[1]).toEqual({
      text: '改稿',
      inlineAnnotations: [],
    });
    expect(paragraph.text).toBe('本文強');
  });
});

describe('mejiro/epub editing sources', () => {
  it('describe the current contract only', () => {
    for (const file of ['editor.ts', 'clone.ts', 'types.ts']) {
      const source = readFileSync(resolve(import.meta.dirname, '../../src/epub', file), 'utf8');
      expect(source).not.toMatch(/\bv0\.\d+\b/u);
      expect(source).not.toMatch(/\bformerly\b|@deprecated/u);
    }
  });
});
