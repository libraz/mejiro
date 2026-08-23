/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { EditableEpub } from '../../src/epub/editor.js';
import {
  assertEpubArchiveWithinLimits,
  DEFAULT_EPUB_PARSE_LIMITS,
  resolveEpubParseLimits,
} from '../../src/epub/limits.js';
import { parseEpub } from '../../src/epub/parser.js';

const MIB = 1024 * 1024;
const EOCD_SIGNATURE = 0x0605_4b50;
const CENTRAL_HEADER_SIGNATURE = 0x0201_4b50;

const containerXml = `<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/package.opf" />
  </rootfiles>
</container>`;

const opfXml = `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>限界テスト</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`;

/** Builds an XHTML chapter whose UTF-8 size is at least `bytes`. */
function makeChapterXhtml(bytes: number): string {
  const unit = `<p>${'sample body text '.repeat(60)}</p>\n`;
  return `<?xml version="1.0"?>
<html><body>
${unit.repeat(Math.ceil(bytes / unit.length))}
</body></html>`;
}

/**
 * Rewrites the uncompressed size a ZIP archive declares for one entry, in both
 * the central directory and the local file header, leaving the compressed
 * payload untouched.
 */
function declareUncompressedSize(
  archive: ArrayBuffer,
  path: string,
  declared: number,
): ArrayBuffer {
  const bytes = new Uint8Array(archive.slice(0));
  const view = new DataView(bytes.buffer);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== EOCD_SIGNATURE) eocd--;
  if (eocd < 0) throw new Error('archive has no end-of-central-directory record');

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  let patched = false;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('archive has a malformed central directory');
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === path) {
      view.setUint32(cursor + 24, declared, true);
      view.setUint32(localOffset + 22, declared, true);
      patched = true;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!patched) throw new Error(`archive has no entry named ${path}`);
  return bytes.buffer;
}

/**
 * Builds an EPUB whose chapter expands to `expandedBytes` while its ZIP
 * metadata declares `declaredBytes`.
 */
async function makeSizeSpoofedEpub(
  expandedBytes: number,
  declaredBytes: number,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', containerXml);
  zip.file('OPS/package.opf', opfXml);
  zip.file('OPS/Text/chapter.xhtml', makeChapterXhtml(expandedBytes));
  const archive = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return declareUncompressedSize(archive, 'OPS/Text/chapter.xhtml', declaredBytes);
}

/** Samples how many bytes of buffer memory the running task holds at once. */
function trackPeakBufferBytes(): () => number {
  const base = process.memoryUsage();
  let peak = 0;
  let running = true;
  const sample = (): void => {
    if (!running) return;
    const now = process.memoryUsage();
    peak = Math.max(peak, now.arrayBuffers - base.arrayBuffers + (now.external - base.external));
    setImmediate(sample);
  };
  setImmediate(sample);
  return () => {
    running = false;
    return peak;
  };
}

describe('resolveEpubParseLimits', () => {
  const names = [
    'maxInputBytes',
    'maxEntries',
    'maxEntryBytes',
    'maxTotalBytes',
    'maxCompressionRatio',
  ] as const;

  it('defaults every limit when none is supplied', () => {
    expect(resolveEpubParseLimits()).toEqual(DEFAULT_EPUB_PARSE_LIMITS);
    expect(resolveEpubParseLimits({})).toEqual(DEFAULT_EPUB_PARSE_LIMITS);
  });

  it('overrides only the named limit', () => {
    const limits = resolveEpubParseLimits({ limits: { maxEntries: 5 } });

    expect(limits.maxEntries).toBe(5);
    expect(limits.maxTotalBytes).toBe(DEFAULT_EPUB_PARSE_LIMITS.maxTotalBytes);
  });

  it('rejects a non-positive, fractional or unsafe value for every limit', () => {
    for (const name of names) {
      for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
        expect(
          () => resolveEpubParseLimits({ limits: { [name]: value } }),
          `${name}=${value}`,
        ).toThrow(new RegExp(`EPUB parse limit ${name} must be a positive integer`));
        expect(() => resolveEpubParseLimits({ limits: { [name]: value } })).toThrow(RangeError);
      }
    }
  });

  it('accepts the smallest legal value for every limit', () => {
    for (const name of names) {
      expect(resolveEpubParseLimits({ limits: { [name]: 1 } })[name]).toBe(1);
    }
  });
});

describe('EPUB archive metadata limits', () => {
  it('rejects declared entry sizes that add up past the total limit', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', containerXml);
    zip.file('OPS/package.opf', opfXml);
    zip.file('OPS/Text/a.xhtml', makeChapterXhtml(64 * 1024));
    zip.file('OPS/Text/b.xhtml', makeChapterXhtml(64 * 1024));
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    const loaded = await JSZip.loadAsync(data);

    // Either entry fits on its own; only their sum passes the total.
    expect(() =>
      assertEpubArchiveWithinLimits(
        data,
        loaded,
        resolveEpubParseLimits({ limits: { maxTotalBytes: 96 * 1024 } }),
      ),
    ).toThrow(/total expanded size limit/);
    expect(() =>
      assertEpubArchiveWithinLimits(
        data,
        loaded,
        resolveEpubParseLimits({ limits: { maxTotalBytes: 4 * MIB } }),
      ),
    ).not.toThrow();
  });

  it('rejects an entry whose ZIP metadata carries no sizes', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', containerXml);
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    const loaded = await JSZip.loadAsync(data);
    const entry = loaded.files['META-INF/container.xml'] as JSZip.JSZipObject & {
      _data?: unknown;
    };
    entry._data = {};

    expect(() => assertEpubArchiveWithinLimits(data, loaded, resolveEpubParseLimits())).toThrow(
      /unavailable size metadata/,
    );
  });
});

describe('EPUB archive limits across both import paths', () => {
  /** Archive that passes every default limit and trips each configured one. */
  async function makeArchive(): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', containerXml);
    zip.file('OPS/package.opf', opfXml);
    zip.file('OPS/Text/chapter.xhtml', makeChapterXhtml(16 * 1024));
    return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  }

  const cases: ReadonlyArray<{
    limits: Partial<Record<string, number>>;
    message: RegExp;
  }> = [
    { limits: { maxInputBytes: 1 }, message: /compressed input limit/ },
    { limits: { maxEntries: 1 }, message: /entry limit/ },
    { limits: { maxEntryBytes: 512 }, message: /expanded size limit/ },
    { limits: { maxTotalBytes: 512 }, message: /total expanded size limit/ },
    { limits: { maxCompressionRatio: 2 }, message: /compression ratio limit/ },
  ];

  it('rejects the same archive for the same reason in parseEpub and EditableEpub.load', async () => {
    const data = await makeArchive();

    // Neither path rejects the archive on its own.
    await expect(parseEpub(data)).resolves.toBeDefined();
    await expect(EditableEpub.load(data)).resolves.toBeDefined();

    for (const { limits, message } of cases) {
      await expect(parseEpub(data, { limits }), JSON.stringify(limits)).rejects.toThrow(message);
      await expect(EditableEpub.load(data, { limits }), JSON.stringify(limits)).rejects.toThrow(
        message,
      );
    }
  });

  it('rejects malformed limit values from both import paths', async () => {
    const data = await makeArchive();

    await expect(parseEpub(data, { limits: { maxEntries: 0 } })).rejects.toThrow(RangeError);
    await expect(EditableEpub.load(data, { limits: { maxEntries: 0 } })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('EPUB archive expansion limits', () => {
  // The declared size passes every metadata check while the entry really
  // expands to far more, so only a count of decompressed bytes can stop it.
  const expandedBytes = 32 * MIB;
  const declaredBytes = 1024;

  it('accepts the declared metadata of a size-spoofed archive', async () => {
    const data = await makeSizeSpoofedEpub(expandedBytes, declaredBytes);
    const zip = await JSZip.loadAsync(data);

    expect(() =>
      assertEpubArchiveWithinLimits(
        data,
        zip,
        resolveEpubParseLimits({ limits: { maxEntryBytes: MIB } }),
      ),
    ).not.toThrow();
  });

  it('rejects a size-spoofed archive from parseEpub without expanding the whole entry', async () => {
    const data = await makeSizeSpoofedEpub(expandedBytes, declaredBytes);

    const peakBytes = trackPeakBufferBytes();
    await expect(parseEpub(data, { limits: { maxEntryBytes: MIB } })).rejects.toThrow(
      /expanded size limit/,
    );

    expect(peakBytes()).toBeLessThan(4 * MIB);
  });

  it('rejects a size-spoofed archive from EditableEpub.load without expanding the whole entry', async () => {
    const data = await makeSizeSpoofedEpub(expandedBytes, declaredBytes);

    const peakBytes = trackPeakBufferBytes();
    await expect(EditableEpub.load(data, { limits: { maxEntryBytes: MIB } })).rejects.toThrow(
      /expanded size limit/,
    );

    expect(peakBytes()).toBeLessThan(4 * MIB);
  });

  it('counts expanded bytes of every entry against the total limit', async () => {
    const data = await makeSizeSpoofedEpub(4 * MIB, declaredBytes);

    await expect(parseEpub(data, { limits: { maxTotalBytes: 2 * MIB } })).rejects.toThrow(
      /total expanded size limit/,
    );
  });

  it('rejects an entry whose real expansion passes the compression ratio limit', async () => {
    // Declared metadata puts the ratio just under 2:1 while the entry really
    // expands ~250x, so a ratio limit of 20 is only passed by the real output.
    const data = await makeSizeSpoofedEpub(8 * MIB, 64 * 1024);
    const zip = await JSZip.loadAsync(data);
    const limits = { maxCompressionRatio: 20 };

    // The declared sizes alone clear the ratio limit, so the metadata check
    // lets the archive through.
    expect(() =>
      assertEpubArchiveWithinLimits(data, zip, resolveEpubParseLimits({ limits })),
    ).not.toThrow();

    // The default byte budgets are far out of reach (8 MiB against a 50 MiB
    // entry limit and a 200 MiB total), so nothing but the effective ratio can
    // stop this entry — and it stops it long before the entry finishes
    // expanding.
    const peakBytes = trackPeakBufferBytes();
    await expect(parseEpub(data, { limits })).rejects.toThrow(/compression ratio limit/);
    expect(peakBytes()).toBeLessThan(4 * MIB);

    await expect(EditableEpub.load(data, { limits })).rejects.toThrow(/compression ratio limit/);
  });

  it('accepts an honest archive that legitimately compresses well', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', containerXml);
    zip.file('OPS/package.opf', opfXml);
    zip.file('OPS/Text/chapter.xhtml', makeChapterXhtml(512 * 1024));
    const data = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    const loaded = await JSZip.loadAsync(data);
    const entry = loaded.files['OPS/Text/chapter.xhtml'] as JSZip.JSZipObject & {
      _data?: { compressedSize?: number; uncompressedSize?: number };
    };
    const realRatio =
      (entry._data?.uncompressedSize ?? 0) / Math.max(entry._data?.compressedSize ?? 0, 1);

    // Repetitive prose compresses far better than the ratios a reader would
    // consider suspicious, yet stays inside the default limit.
    expect(realRatio).toBeGreaterThan(100);
    expect(realRatio).toBeLessThan(DEFAULT_EPUB_PARSE_LIMITS.maxCompressionRatio);
    await expect(parseEpub(data)).resolves.toBeDefined();

    // A caller may tighten the limit below that ratio, or loosen it back.
    await expect(parseEpub(data, { limits: { maxCompressionRatio: 100 } })).rejects.toThrow(
      /compression ratio limit/,
    );
    await expect(
      parseEpub(data, { limits: { maxCompressionRatio: 10_000 } }),
    ).resolves.toBeDefined();
  });

  it('parses an honest archive of the same shape', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', containerXml);
    zip.file('OPS/package.opf', opfXml);
    zip.file('OPS/Text/chapter.xhtml', makeChapterXhtml(64 * 1024));
    const data = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });

    const book = await parseEpub(data);

    expect(book.title).toBe('限界テスト');
    expect(book.chapters[0].paragraphs.length).toBeGreaterThan(0);
  });
});
