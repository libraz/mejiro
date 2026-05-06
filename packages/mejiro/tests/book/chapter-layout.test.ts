import { describe, expect, it } from 'vitest';
import { type CachedParagraph, ChapterLayout } from '../../src/book/chapter-layout.js';
import type { RenderEntry } from '../../src/render/types.js';
import type { RubyAnnotation } from '../../src/ruby.js';
import { toCodepoints, uniformAdvances } from '../helpers.js';

function chars(text: string): string[] {
  return [...text];
}

function makeLayout(cached: CachedParagraph[], entries: RenderEntry[]): ChapterLayout {
  return new ChapterLayout(
    cached,
    entries,
    {
      fontSize: 10,
      lineSpacing: 1,
      headingScale: 1.4,
      mode: 'strict',
      enableHanging: true,
    },
    { pageWidth: 100, lineWidth: 100, pagePaddingX: 0, pagePaddingY: 0 },
  );
}

describe('ChapterLayout', () => {
  it('preserves ruby-aware breaks after resize reflow', () => {
    const text = '漢あいうえ';
    const rubyText = toCodepoints('かんかん');
    const layoutRubyAnnotations: RubyAnnotation[] = [
      {
        startIndex: 0,
        endIndex: 1,
        rubyText,
        rubyAdvances: uniformAdvances(rubyText.length, 10),
        type: 'mono',
      },
    ];
    const cached: CachedParagraph[] = [
      {
        text: toCodepoints(text),
        advances: uniformAdvances([...text].length, 16),
        chars: chars(text),
        rubyAnnotations: [{ startIndex: 0, endIndex: 1, rubyText: 'かんかん', type: 'mono' }],
        layoutRubyAnnotations,
      },
    ];
    const entries: RenderEntry[] = [
      {
        chars: chars(text),
        breakPoints: new Uint32Array(0),
        rubyAnnotations: cached[0].rubyAnnotations,
      },
    ];

    const layout = makeLayout(cached, entries);
    layout.resize({ lineWidth: 80 });

    expect(layout.getPage(0).lines.length).toBeGreaterThan(1);
  });

  it('clears only the target spread when syncImages receives no images', () => {
    const text = 'あ'.repeat(300);
    const codepoints = toCodepoints(text);
    const cached: CachedParagraph[] = [
      {
        text: codepoints,
        advances: uniformAdvances(codepoints.length, 10),
        chars: chars(text),
        rubyAnnotations: [],
      },
    ];
    const entries: RenderEntry[] = [
      {
        chars: chars(text),
        breakPoints: new Uint32Array(0),
        rubyAnnotations: [],
      },
    ];
    const layout = makeLayout(cached, entries);
    layout.resize({ lineWidth: 50 });

    layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 20 }]);
    layout.setImages(1, [{ x: 20, y: 10, w: 20, h: 20 }]);
    layout.syncImages(0, []);

    expect(layout.hasImages).toBe(true);
    expect(layout.getSpread(1).right.hasImages).toBe(true);
  });
});
