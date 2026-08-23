/**
 * @vitest-environment happy-dom
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';
import { parseEpub } from '../../src/epub/parser.js';
import type { RenderPage, RenderSegment } from '../../src/render/types.js';

const containerXml = `<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/package.opf" />
  </rootfiles>
</container>`;

function packageOpf(): string {
  return `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>ルビ</dc:title>
  </metadata>
  <manifest>
    <item id="c1" href="chapter.xhtml" />
  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`;
}

async function makeEpub(body: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', containerXml);
  zip.file('OPS/package.opf', packageOpf());
  zip.file(
    'OPS/chapter.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

function collectRubySegments(page: RenderPage): { base: string; rubyText: string }[] {
  const found: { base: string; rubyText: string }[] = [];
  const visit = (segments: readonly RenderSegment[]): void => {
    for (const segment of segments) {
      if (segment.type === 'ruby') found.push({ base: segment.base, rubyText: segment.rubyText });
      if (segment.type !== 'text' && segment.children) visit(segment.children);
    }
  };
  for (const paragraph of page.paragraphs) {
    for (const line of paragraph.lines) visit(line.segments);
  }
  return found;
}

function lineTexts(page: RenderPage, paragraphIndex: number): string[] {
  const text = (segments: readonly RenderSegment[]): string =>
    segments
      .map((segment) => {
        if (segment.type === 'text') return segment.text;
        if (segment.type === 'ruby') return segment.base;
        return segment.text;
      })
      .join('');
  return page.paragraphs[paragraphIndex].lines.map((line) => text(line.segments));
}

describe('EPUB chapters with multi-rt ruby', () => {
  it('lays out a chapter containing per-character ruby without throwing', async () => {
    const data = await makeEpub(
      '<p>これは<ruby>東<rt>とう</rt>京<rt>きょう</rt>都<rt>と</rt></ruby>に行く話です。</p>',
    );
    const parsed = await parseEpub(data);

    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 200 });

    const layout = await book.layoutChapter(parsed.chapters[0]);

    expect(layout.totalPages).toBeGreaterThan(0);
  });

  it('renders every rt of a per-character ruby span into the page', async () => {
    const data = await makeEpub(
      '<p>これは<ruby>東<rt>とう</rt>京<rt>きょう</rt>都<rt>と</rt></ruby>に行く話です。</p>',
    );
    const parsed = await parseEpub(data);

    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 400 });
    const layout = await book.layoutChapter(parsed.chapters[0]);

    const rubies = collectRubySegments(layout.getPage(0).page);
    expect(rubies).toEqual(
      expect.arrayContaining([
        { base: '東', rubyText: 'とう' },
        { base: '京', rubyText: 'きょう' },
        { base: '都', rubyText: 'と' },
      ]),
    );
    // The covering aggregate must not be rendered a second time.
    expect(rubies.filter((r) => r.rubyText === 'とうきょうと')).toHaveLength(0);
  });

  it('keeps ruby on its own base characters when the source is line wrapped', async () => {
    const data = await makeEpub(
      '<p>これは\n  <ruby>漢字<rt>かんじ</rt></ruby>の\n  練習です。</p>',
    );
    const parsed = await parseEpub(data);

    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    book.setPageSize({ pageWidth: 400, lineWidth: 400 });
    const layout = await book.layoutChapter(parsed.chapters[0]);

    const page = layout.getPage(0).page;
    expect(lineTexts(page, 0).join('')).toBe('これは漢字の練習です。');
    expect(collectRubySegments(page)).toEqual([{ base: '漢字', rubyText: 'かんじ' }]);
  });

  it('breaks a multi-rt span only where the markup allows it', async () => {
    // 東京 shares one rt, so the only permitted break inside the span is
    // between 京 and 都 — no line may start with 京.
    const data = await makeEpub(
      '<p>これは<ruby>東京<rt>とうきょう</rt>都<rt>と</rt></ruby>に行く話です。</p>',
    );
    const parsed = await parseEpub(data);

    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    let sawWrappedSpan = false;
    for (let lineWidth = 60; lineWidth <= 200; lineWidth += 20) {
      book.setPageSize({ pageWidth: 400, lineWidth });
      const layout = await book.layoutChapter(parsed.chapters[0]);
      const lines = lineTexts(layout.getPage(0).page, 0);
      if (lines.length > 1) sawWrappedSpan = true;
      for (const line of lines) {
        expect(line.startsWith('京')).toBe(false);
      }
    }
    expect(sawWrappedSpan).toBe(true);
  });
});
