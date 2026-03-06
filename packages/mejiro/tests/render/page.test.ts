import { describe, expect, it } from 'vitest';
import type { PageSlice } from '../../src/paginate.js';
import { buildRenderPage } from '../../src/render/page.js';
import type { RenderEntry } from '../../src/render/types.js';

function makeEntry(
  text: string,
  breakPoints: number[],
  isHeading = false,
  rubyAnnotations: RenderEntry['rubyAnnotations'] = [],
): RenderEntry {
  return {
    chars: [...text],
    breakPoints: new Uint32Array(breakPoints),
    rubyAnnotations,
    isHeading,
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

  it('marks heading paragraphs', () => {
    const entries = [makeEntry('タイトル', [], true)];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].isHeading).toBe(true);
  });

  it('handles ruby annotations', () => {
    // 漢字 with ruby かんじ at indices [0,2)
    const entries = [
      makeEntry('漢字です', [], false, [{ startIndex: 0, endIndex: 2, rubyText: 'かんじ' }]),
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
        { startIndex: 1, endIndex: 3, rubyText: 'かんじ' },
        { startIndex: 4, endIndex: 6, rubyText: 'もじ' },
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
        { startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'jukugo' },
      ]),
    ];
    const slices: PageSlice[] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }];

    const page = buildRenderPage(slices, entries);

    expect(page.paragraphs[0].lines[0].segments).toEqual([{ type: 'text', text: '漢字です' }]);
  });

  it('returns empty paragraphs for empty slices', () => {
    const page = buildRenderPage([], []);
    expect(page.paragraphs).toEqual([]);
  });
});
