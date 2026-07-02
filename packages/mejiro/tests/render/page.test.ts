import { describe, expect, it } from 'vitest';
import type { PageSlice } from '../../src/paginate.js';
import { buildRenderPage } from '../../src/render/page.js';
import type { RenderEntry } from '../../src/render/types.js';

function makeEntry(
  text: string,
  breakPoints: number[],
  isHeading = false,
  inlineAnnotations: RenderEntry['inlineAnnotations'] = [],
  headingLevel?: number,
): RenderEntry {
  return {
    chars: [...text],
    breakPoints: new Uint32Array(breakPoints),
    inlineAnnotations,
    isHeading,
    headingLevel,
  };
}

describe('buildRenderPage', () => {
  it('builds a simple page with one paragraph', () => {
    const entries = [makeEntry('あいうえお', [2])]; // break after index 2 → lines: [0,3), [3,5)
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 2 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs).toHaveLength(1);
    expect(page.paragraphs[0].isHeading).toBe(false);
    expect(page.paragraphs[0].lines).toHaveLength(2);
    expect(page.paragraphs[0].lines[0].segments).toEqual([{ type: 'text', text: 'あいう' }]);
    expect(page.paragraphs[0].lines[1].segments).toEqual([{ type: 'text', text: 'えお' }]);
  });

  it('marks heading paragraphs with headingLevel', () => {
    const entries = [makeEntry('タイトル', [], false, [], 2)];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].isHeading).toBe(true);
    expect(page.paragraphs[0].headingLevel).toBe(2);
  });

  it('marks heading paragraphs with legacy isHeading', () => {
    const entries = [makeEntry('タイトル', [], true)];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].isHeading).toBe(true);
    expect(page.paragraphs[0].headingLevel).toBeUndefined();
  });

  it('handles ruby annotations', () => {
    // 漢字 with ruby かんじ at indices [0,2)
    const entries = [
      makeEntry('漢字です', [], false, [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ' },
      ]),
    ];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines[0].segments).toEqual([
      { type: 'ruby', base: '漢字', rubyText: 'かんじ' },
      { type: 'text', text: 'です' },
    ]);
  });

  it('handles mixed text and ruby segments', () => {
    // あ[漢字]い[文字]う
    const entries = [
      makeEntry('あ漢字い文字う', [], false, [
        { kind: 'ruby', startIndex: 1, endIndex: 3, rubyText: 'かんじ' },
        { kind: 'ruby', startIndex: 4, endIndex: 6, rubyText: 'もじ' },
      ]),
    ];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines[0].segments).toEqual([
      { type: 'text', text: 'あ' },
      { type: 'ruby', base: '漢字', rubyText: 'かんじ' },
      { type: 'text', text: 'い' },
      { type: 'ruby', base: '文字', rubyText: 'もじ' },
      { type: 'text', text: 'う' },
    ]);
  });

  it('handles partial paragraph slices', () => {
    // 6 chars, break at 2 → lines: [0,3), [3,6)
    const entries = [makeEntry('あいうえおか', [2])];
    // Only show the second line
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 1, lineEnd: 2 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs).toHaveLength(1);
    expect(page.paragraphs[0].lines).toHaveLength(1);
    expect(page.paragraphs[0].lines[0].segments).toEqual([{ type: 'text', text: 'えおか' }]);
  });

  it('handles multiple paragraphs on one page', () => {
    const entries = [makeEntry('あいう', []), makeEntry('えおか', [])];
    const slices: PageSlice[] = [
      { paragraphIndex: 0, lineStart: 0, lineEnd: 1 },
      { paragraphIndex: 1, lineStart: 0, lineEnd: 1 },
    ];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs).toHaveLength(2);
    expect(page.paragraphs[0].lines[0].segments).toEqual([{ type: 'text', text: 'あいう' }]);
    expect(page.paragraphs[1].lines[0].segments).toEqual([{ type: 'text', text: 'えおか' }]);
  });

  it('skips jukugo ruby annotations', () => {
    const entries = [
      makeEntry('漢字です', [], false, [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'jukugo' },
      ]),
    ];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines[0].segments).toEqual([{ type: 'text', text: '漢字です' }]);
  });

  it('renders unsafe links as plain text', () => {
    const entries = [
      makeEntry('unsafe', [], false, [
        { kind: 'link', startIndex: 0, endIndex: 6, href: 'javascript:alert(1)' },
      ]),
    ];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines[0].segments).toEqual([{ type: 'text', text: 'unsafe' }]);
  });

  it('preserves contained annotations such as ruby inside links', () => {
    const entries = [
      makeEntry('漢字', [], false, [
        { kind: 'link', startIndex: 0, endIndex: 2, href: 'https://example.test' },
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
      ]),
    ];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines[0].segments).toEqual([
      {
        type: 'link',
        text: '漢字',
        href: 'https://example.test',
        children: [{ type: 'ruby', base: '漢字', rubyText: 'かんじ' }],
      },
    ]);
  });

  it('does not hang on zero-length annotations', () => {
    const entries = [
      makeEntry('本文', [], false, [
        { kind: 'emphasis', startIndex: 1, endIndex: 1, style: 'sesame' },
      ]),
    ];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines[0].segments).toEqual([{ type: 'text', text: '本文' }]);
  });

  it('returns empty paragraphs for empty slices', () => {
    const page = buildRenderPage([], []);
    expect(page.paragraphs).toEqual([]);
  });

  it('renders an empty paragraph slice without throwing', () => {
    const entries = [makeEntry('', [])];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines).toEqual([{ segments: [] }]);
  });
});
