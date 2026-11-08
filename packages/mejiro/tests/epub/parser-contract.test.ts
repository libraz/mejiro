/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as epub from '@libraz/mejiro/epub';
import {
  assertEpubInputSize,
  type EpubParseOptions,
  extractRubyContent,
  MejiroError,
  type MejiroErrorCode,
  parseEpub,
} from '@libraz/mejiro/epub';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

const containerXml = `<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/package.opf" />
  </rootfiles>
</container>`;

const opfXml = `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>契約</dc:title>
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

async function makeEpub(
  files: Record<string, string> = {
    'META-INF/container.xml': containerXml,
    'OPS/package.opf': opfXml,
    'OPS/Text/chapter.xhtml': chapterXhtml,
  },
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
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

describe('parseEpub input', () => {
  it('reads a Uint8Array through its own view, never the whole backing buffer', async () => {
    const bytes = await makeEpub();
    const padded = new Uint8Array(bytes.length + 128).fill(0xaa);
    padded.set(bytes, 37);
    const view = padded.subarray(37, 37 + bytes.length);
    const before = padded.slice();

    const book = await parseEpub(view);

    expect(book.chapters[0].paragraphs[0].text).toBe('本文');
    expect(padded).toEqual(before);
  });

  it('accepts a Node Buffer as read from disk', async () => {
    const bytes = await makeEpub();
    const book = await parseEpub(Buffer.from(bytes));
    expect(book.title).toBe('契約');
  });

  it('accepts an ArrayBuffer and leaves it unchanged', async () => {
    const bytes = await makeEpub();
    const buffer = bytes.slice().buffer;
    await expect(parseEpub(buffer)).resolves.toBeDefined();
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'epub'],
    ['a number', 12],
    ['a plain object', {}],
    ['an array', [80, 75]],
  ])('rejects %s with a TypeError', async (_label, value) => {
    await expect(parseEpub(value as never)).rejects.toThrow(TypeError);
  });

  it.each([
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array(1)],
    ['an empty ArrayBuffer', new ArrayBuffer(0)],
    ['not a zip', new TextEncoder().encode('not a zip file at all')],
  ])('rejects %s as an invalid archive', async (_label, value) => {
    await expectCode(parseEpub(value), 'epub-invalid-archive');
  });

  it('types the input as ArrayBuffer or Uint8Array only', () => {
    const header = `import { parseEpub } from '@libraz/mejiro/epub';
declare const bytes: Uint8Array;
declare const buffer: ArrayBuffer;
`;
    expectTypeErrors(`${header}parseEpub(bytes);\nparseEpub(buffer);\n`, { fails: [] });
    expectTypeErrors(`${header}parseEpub('bytes');\n`, { fails: ["parseEpub('bytes')"] });
  });
});

describe('parseEpub cancellation', () => {
  it('rejects with the signal reason when the signal is already aborted', async () => {
    const data = await makeEpub();
    const controller = new AbortController();
    controller.abort();

    const error = await rejection(parseEpub(data, { signal: controller.signal }));

    expect(error).toBe(controller.signal.reason);
    expect((error as Error).name).toBe('AbortError');
  });

  it('rejects with a custom reason passed to abort()', async () => {
    const data = await makeEpub();
    const controller = new AbortController();
    const reason = new Error('another book was picked');
    controller.abort(reason);

    expect(await rejection(parseEpub(data, { signal: controller.signal }))).toBe(reason);
  });

  it('stops when the signal aborts while the archive is being read', async () => {
    const data = await makeEpub();
    const controller = new AbortController();
    const pending = parseEpub(data, { signal: controller.signal });
    controller.abort();

    const error = await rejection(pending);

    expect(error).toBe(controller.signal.reason);
  });

  it('parses normally with a signal that never aborts', async () => {
    const data = await makeEpub();
    const controller = new AbortController();
    await expect(parseEpub(data, { signal: controller.signal })).resolves.toBeDefined();
  });

  it.each([
    ['null', null],
    ['a plain object', {}],
    ['a string', 'abort'],
  ])('rejects %s as the signal with a TypeError', async (_label, signal) => {
    const data = await makeEpub();
    await expect(parseEpub(data, { signal: signal as never })).rejects.toThrow(TypeError);
  });

  it('declares signal on the options shared with the editable import', () => {
    const header = `import type { EpubParseOptions } from '@libraz/mejiro/epub';\n`;
    expectTypeErrors(
      `${header}export const options: EpubParseOptions = { limits: { maxEntries: 5 }, signal: new AbortController().signal };\n`,
      { fails: [] },
    );
    expectTypeErrors(`${header}export const options: EpubParseOptions = { signal: 'abort' };\n`, {
      fails: ['export const options'],
    });
    const options: EpubParseOptions = { signal: new AbortController().signal };
    expect(options.signal?.aborted).toBe(false);
  });
});

describe('parseEpub failures', () => {
  it('tells an unreadable archive from a malformed package', async () => {
    await expectCode(parseEpub(new Uint8Array(64).fill(1)), 'epub-invalid-archive');

    const noContainer = await makeEpub({ 'OPS/package.opf': opfXml });
    await expectCode(parseEpub(noContainer), 'epub-invalid-package');

    const noRootfile = await makeEpub({ 'META-INF/container.xml': '<container />' });
    await expectCode(parseEpub(noRootfile), 'epub-invalid-package');

    const brokenContainer = await makeEpub({ 'META-INF/container.xml': '<container><rootfiles>' });
    await expectCode(parseEpub(brokenContainer), 'epub-invalid-package');

    const noOpf = await makeEpub({ 'META-INF/container.xml': containerXml });
    await expectCode(parseEpub(noOpf), 'epub-invalid-package');
  });

  it('reports a package without a readable chapter as an invalid package', async () => {
    const empty = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': '<?xml version="1.0"?><html><body></body></html>',
    });
    await expectCode(parseEpub(empty), 'epub-invalid-package');
  });

  it('reports a malformed chapter and a malformed manifest href as an invalid package', async () => {
    const brokenChapter = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': '<html><body><p>open',
    });
    await expectCode(parseEpub(brokenChapter), 'epub-invalid-package');

    const brokenHref = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml.replace('Text/chapter.xhtml', 'chapter%E0%A4%A.xhtml'),
    });
    await expectCode(parseEpub(brokenHref), 'epub-invalid-package');
  });

  it('keeps the original failure as the cause of a wrapped error', async () => {
    const error = await rejection(parseEpub(new Uint8Array(64).fill(1)));
    expect((error as MejiroError).cause).toBeDefined();
  });

  it('reports every exceeded archive limit as a limit error', async () => {
    const chapter = `<?xml version="1.0"?>\n<html><body>${'<p>sample body text sample body text</p>\n'.repeat(
      400,
    )}</body></html>`;
    const data = await makeEpub({
      'META-INF/container.xml': containerXml,
      'OPS/package.opf': opfXml,
      'OPS/Text/chapter.xhtml': chapter,
    });
    await expect(parseEpub(data)).resolves.toBeDefined();

    const limits: EpubParseOptions['limits'][] = [
      { maxInputBytes: 1 },
      { maxEntries: 1 },
      { maxEntryBytes: 512 },
      { maxTotalBytes: 512 },
      { maxCompressionRatio: 2 },
    ];
    for (const limit of limits) {
      await expectCode(parseEpub(data, { limits: limit }), 'epub-limit-exceeded');
    }
  });

  it('keeps malformed limit values a RangeError rather than a mejiro error', async () => {
    const data = await makeEpub();
    const error = await rejection(parseEpub(data, { limits: { maxEntries: 0 } }));
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(MejiroError);
  });

  it('reports an oversized file size check as a limit error', () => {
    let thrown: unknown;
    try {
      assertEpubInputSize(5, { maxInputBytes: 4 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MejiroError);
    expect((thrown as MejiroError).code).toBe('epub-limit-exceeded');
    expect(() => assertEpubInputSize(4, { maxInputBytes: 4 })).not.toThrow();
  });
});

describe('extractRubyContent failures', () => {
  it('reports malformed XHTML as an invalid package', () => {
    let thrown: unknown;
    try {
      extractRubyContent('<html><body><p>open');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MejiroError);
    expect((thrown as MejiroError).code).toBe('epub-invalid-package');
  });
});

describe('parsed book shape', () => {
  it('carries only the public fields, with no package internals', async () => {
    const book = await parseEpub(await makeEpub());

    expect(Object.keys(book).sort()).toEqual(['author', 'chapters', 'title']);
    expect(Object.keys(book.chapters[0]).sort()).toEqual(['paragraphs', 'title']);
    expect(Object.keys(book.chapters[0].paragraphs[0]).sort()).toEqual([
      'inlineAnnotations',
      'text',
    ]);
  });

  it('types a heading level as 1 to 6', () => {
    const header = `import type { AnnotatedParagraph } from '@libraz/mejiro/epub';\n`;
    expectTypeErrors(
      `${header}export const paragraph: AnnotatedParagraph = { text: 'a', inlineAnnotations: [], headingLevel: 3 };\n`,
      { fails: [] },
    );
    expectTypeErrors(
      `${header}export const paragraph: AnnotatedParagraph = { text: 'a', inlineAnnotations: [], headingLevel: 7 };\n`,
      { fails: ['export const paragraph'] },
    );
  });
});

describe('mejiro/epub entry', () => {
  it('re-exports the manuscript parser without the retired ruby-only variant', () => {
    expect('parseManuscript' in epub).toBe(true);
    expect('parseManuscriptRuby' in epub).toBe(false);
    expectTypeErrors(
      `import type { ManuscriptDialect, ParseManuscriptOptions, ParsedManuscript } from '@libraz/mejiro/epub';
export const dialect: ManuscriptDialect = 'narou';
export type Options = ParseManuscriptOptions;
export type Parsed = ParsedManuscript;
`,
      { fails: [] },
    );
    expectTypeErrors(`import { parseManuscriptRuby } from '@libraz/mejiro/epub';\n`, {
      fails: ['parseManuscriptRuby'],
    });
  });

  it('describes the current contract in the parse-side sources', () => {
    const dir = resolve(import.meta.dirname, '../../src/epub');
    for (const file of [
      'parser.ts',
      'limits.ts',
      'ruby-extractor.ts',
      'xml-utils.ts',
      'package-paths.ts',
      'chapter-markup.ts',
    ]) {
      expect(readFileSync(resolve(dir, file), 'utf8'), file).not.toMatch(/\bv0\.\d/u);
    }
  });
});
