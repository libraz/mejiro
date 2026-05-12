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
        inlineAnnotations: [
          { kind: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'かんかん', type: 'mono' },
        ],
        layoutRubyAnnotations,
      },
    ];
    const entries: RenderEntry[] = [
      {
        chars: chars(text),
        breakPoints: new Uint32Array(0),
        inlineAnnotations: cached[0].inlineAnnotations,
      },
    ];

    const layout = makeLayout(cached, entries);
    layout.resize({ lineWidth: 80 });

    expect(layout.getPage(0).lines.length).toBeGreaterThan(1);
  });

  it('locates an in-chapter anchor in normal mode', () => {
    // 100 chars at 10px each, lineWidth=100 → 10 chars per line.
    // pageWidth=100, line pitch=10 → 10 lines per page.
    const text = 'あ'.repeat(100);
    const codepoints = toCodepoints(text);
    const cached: CachedParagraph[] = [
      {
        text: codepoints,
        advances: uniformAdvances(codepoints.length, 10),
        chars: chars(text),
        inlineAnnotations: [],
      },
    ];
    const breakPoints = new Uint32Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const entries: RenderEntry[] = [{ chars: chars(text), breakPoints, inlineAnnotations: [] }];
    const layout = makeLayout(cached, entries);

    // Char 0 → first line, first page (right side of first spread).
    expect(layout.locateAnchor({ paragraph: 0, charIndex: 0 })).toEqual({
      spreadIdx: 0,
      pageIdx: 0,
      lineIdx: 0,
      side: 'right',
    });

    // Char 25 (within line 2) → still on first page (10 lines per page).
    const at25 = layout.locateAnchor({ paragraph: 0, charIndex: 25 });
    expect(at25?.lineIdx).toBe(2);
    expect(at25?.side).toBe('right');

    // Char index out of range → null.
    expect(layout.locateAnchor({ paragraph: 0, charIndex: -1 })).toBeNull();
    expect(layout.locateAnchor({ paragraph: 5, charIndex: 0 })).toBeNull();
  });

  it('round-trips anchorAt ↔ locateAnchor for spread starts', () => {
    const text = 'あ'.repeat(60);
    const codepoints = toCodepoints(text);
    const cached: CachedParagraph[] = [
      {
        text: codepoints,
        advances: uniformAdvances(codepoints.length, 10),
        chars: chars(text),
        inlineAnnotations: [],
      },
    ];
    const breakPoints = new Uint32Array([10, 20, 30, 40, 50]);
    const entries: RenderEntry[] = [{ chars: chars(text), breakPoints, inlineAnnotations: [] }];
    const layout = makeLayout(cached, entries);

    const anchor = layout.anchorAt(0, 'right');
    expect(anchor).toEqual({ paragraph: 0, charIndex: 0 });
    if (!anchor) throw new Error('anchorAt returned null');

    const located = layout.locateAnchor(anchor);
    expect(located?.spreadIdx).toBe(0);
    expect(located?.side).toBe('right');
  });

  describe('coord ↔ anchor', () => {
    function makeStaticLayout(text: string, breakPoints: Uint32Array): ChapterLayout {
      const codepoints = toCodepoints(text);
      const cached: CachedParagraph[] = [
        {
          text: codepoints,
          advances: uniformAdvances(codepoints.length, 10),
          chars: chars(text),
          inlineAnnotations: [],
        },
      ];
      const entries: RenderEntry[] = [{ chars: chars(text), breakPoints, inlineAnnotations: [] }];
      return makeLayout(cached, entries);
    }

    it('returns rect at the start of the first column on the right page', () => {
      // 100 chars at 10px each, lineWidth=100 → 10 chars per line, 10 lines per page.
      const layout = makeStaticLayout(
        'あ'.repeat(100),
        new Uint32Array([10, 20, 30, 40, 50, 60, 70, 80, 90]),
      );
      const rect = layout.coordOfAnchor({ paragraph: 0, charIndex: 0 });
      expect(rect).not.toBeNull();
      if (!rect) throw new Error('rect is null');
      expect(rect.side).toBe('right');
      expect(rect.spreadIdx).toBe(0);
      expect(rect.pageIdx).toBe(0);
      // Rightmost column: right edge at contentWidth (100), left at 90, width = 10 (linePitch).
      expect(rect.x).toBe(90);
      expect(rect.y).toBe(0);
      expect(rect.width).toBe(10);
      expect(rect.height).toBe(10);
    });

    it('returns rect on the left page in negative x range', () => {
      const layout = makeStaticLayout(
        'あ'.repeat(150),
        new Uint32Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140]),
      );
      // Char 100 is at the start of line 10. Lines 0..9 fit on page 0; line 10 starts page 1 (left page of spread 0).
      const rect = layout.coordOfAnchor({ paragraph: 0, charIndex: 100 });
      expect(rect).not.toBeNull();
      if (!rect) throw new Error('rect is null');
      expect(rect.side).toBe('left');
      expect(rect.pageIdx).toBe(1);
      // Left page rightmost column: right edge at x = 0, left at x = -10.
      expect(rect.x).toBe(-10);
    });

    it('round-trips coordOfAnchor → anchorAtCoord at a column center', () => {
      const layout = makeStaticLayout(
        'あ'.repeat(100),
        new Uint32Array([10, 20, 30, 40, 50, 60, 70, 80, 90]),
      );
      const original = { paragraph: 0, charIndex: 25 };
      const rect = layout.coordOfAnchor(original);
      expect(rect).not.toBeNull();
      if (!rect) throw new Error('rect is null');
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const back = layout.anchorAtCoord(rect.spreadIdx, cx, cy);
      expect(back).toEqual(original);
    });

    it('returns null when the coordinate is outside every column', () => {
      const layout = makeStaticLayout('あ'.repeat(30), new Uint32Array([10, 20]));
      expect(layout.anchorAtCoord(0, 1000, 1000)).toBeNull();
    });
  });

  describe('selectionRects', () => {
    function makeStaticLayout(text: string, breakPoints: Uint32Array): ChapterLayout {
      const codepoints = toCodepoints(text);
      const cached: CachedParagraph[] = [
        {
          text: codepoints,
          advances: uniformAdvances(codepoints.length, 10),
          chars: chars(text),
          inlineAnnotations: [],
        },
      ];
      const entries: RenderEntry[] = [{ chars: chars(text), breakPoints, inlineAnnotations: [] }];
      return makeLayout(cached, entries);
    }

    it('returns one rect when the range stays within a single line', () => {
      const layout = makeStaticLayout('あ'.repeat(30), new Uint32Array([10, 20]));
      const rects = layout.selectionRects({
        start: { paragraph: 0, charIndex: 2 },
        end: { paragraph: 0, charIndex: 7 },
      });
      expect(rects).toHaveLength(1);
      const [r] = rects;
      expect(r.height).toBe(50);
      expect(r.width).toBe(10);
    });

    it('returns multiple rects across line boundaries', () => {
      const layout = makeStaticLayout('あ'.repeat(30), new Uint32Array([10, 20]));
      const rects = layout.selectionRects({
        start: { paragraph: 0, charIndex: 5 },
        end: { paragraph: 0, charIndex: 25 },
      });
      expect(rects.length).toBeGreaterThanOrEqual(3);
      // Different columns → different x.
      const xs = new Set(rects.map((r) => r.x));
      expect(xs.size).toBeGreaterThanOrEqual(3);
    });

    it('normalizes reversed ranges', () => {
      const layout = makeStaticLayout('あ'.repeat(20), new Uint32Array([10]));
      const forward = layout.selectionRects({
        start: { paragraph: 0, charIndex: 2 },
        end: { paragraph: 0, charIndex: 8 },
      });
      const reversed = layout.selectionRects({
        start: { paragraph: 0, charIndex: 8 },
        end: { paragraph: 0, charIndex: 2 },
      });
      expect(reversed).toEqual(forward);
    });

    it('returns an empty array for an empty range', () => {
      const layout = makeStaticLayout('あ'.repeat(10), new Uint32Array(0));
      const rects = layout.selectionRects({
        start: { paragraph: 0, charIndex: 5 },
        end: { paragraph: 0, charIndex: 5 },
      });
      expect(rects).toEqual([]);
    });
  });

  describe('findText', () => {
    function setup(textParts: string[]): ChapterLayout {
      const cached: CachedParagraph[] = textParts.map((text) => ({
        text: toCodepoints(text),
        advances: uniformAdvances([...text].length, 10),
        chars: chars(text),
        inlineAnnotations: [],
      }));
      const entries: RenderEntry[] = textParts.map((text) => ({
        chars: chars(text),
        breakPoints: new Uint32Array(0),
        inlineAnnotations: [],
      }));
      return makeLayout(cached, entries);
    }

    it('returns an empty array for an empty query', () => {
      const layout = setup(['あいうえお']);
      expect(layout.findText('')).toEqual([]);
    });

    it('finds literal substring matches with codepoint offsets and locations', () => {
      const layout = setup(['吾輩は猫である。名前はまだ無い。']);
      const matches = layout.findText('猫');
      expect(matches).toHaveLength(1);
      const [m] = matches;
      expect(m.paragraph).toBe(0);
      expect(m.charStart).toBe(3);
      expect(m.charEnd).toBe(4);
      expect(m.match).toBe('猫');
      expect(m.spreadIdx).toBe(0);
      expect(m.side).toBe('right');
    });

    it('finds multiple matches across paragraphs in document order', () => {
      const layout = setup(['abc abc', 'xyz', 'abc']);
      const matches = layout.findText('abc');
      expect(matches.map((m) => [m.paragraph, m.charStart])).toEqual([
        [0, 0],
        [0, 4],
        [2, 0],
      ]);
    });

    it('is case-insensitive by default and respects caseSensitive: true', () => {
      const layout = setup(['Hello hello HELLO']);
      expect(layout.findText('hello').map((m) => m.charStart)).toEqual([0, 6, 12]);
      expect(layout.findText('hello', { caseSensitive: true }).map((m) => m.charStart)).toEqual([
        6,
      ]);
    });

    it('supports regex queries when regex: true', () => {
      const layout = setup(['第1章: あ\n第10章: い']);
      const matches = layout.findText('第\\d+章', { regex: true });
      expect(matches.map((m) => m.match)).toEqual(['第1章', '第10章']);
    });

    it('escapes regex metacharacters in literal mode', () => {
      const layout = setup(['a.b a.b a+b']);
      // '.' must match literally, not "any char".
      const matches = layout.findText('a.b');
      expect(matches.map((m) => m.charStart)).toEqual([0, 4]);
    });

    it('caps results when maxResults is set', () => {
      const layout = setup(['aa aa aa aa aa']);
      const matches = layout.findText('aa', { maxResults: 2 });
      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.charStart)).toEqual([0, 3]);
    });
  });

  it('reuses cached SpreadExclusionEngine output for unchanged spreads after setImages', () => {
    const text = 'あ'.repeat(300);
    const codepoints = toCodepoints(text);
    const cached: CachedParagraph[] = [
      {
        text: codepoints,
        advances: uniformAdvances(codepoints.length, 10),
        chars: chars(text),
        inlineAnnotations: [],
      },
    ];
    const entries: RenderEntry[] = [
      {
        chars: chars(text),
        breakPoints: new Uint32Array(0),
        inlineAnnotations: [],
      },
    ];
    const layout = makeLayout(cached, entries);
    layout.resize({ lineWidth: 50 });

    layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 20 }]);
    layout.setImages(1, [{ x: 20, y: 10, w: 20, h: 20 }]);
    // Force computation.
    layout.getSpread(0);
    const cacheBefore = (layout as unknown as { spreadExclusionCache: Map<number, unknown> })
      .spreadExclusionCache;
    expect(cacheBefore.has(0)).toBe(true);
    expect(cacheBefore.has(1)).toBe(true);

    // Modify spread 1 only — spread 0 cache entry should survive.
    layout.setImages(1, [{ x: 30, y: 30, w: 30, h: 30 }]);
    expect(cacheBefore.has(0)).toBe(true);
    expect(cacheBefore.has(1)).toBe(false);
  });

  it('clears only the target spread when syncImages receives no images', () => {
    const text = 'あ'.repeat(300);
    const codepoints = toCodepoints(text);
    const cached: CachedParagraph[] = [
      {
        text: codepoints,
        advances: uniformAdvances(codepoints.length, 10),
        chars: chars(text),
        inlineAnnotations: [],
      },
    ];
    const entries: RenderEntry[] = [
      {
        chars: chars(text),
        breakPoints: new Uint32Array(0),
        inlineAnnotations: [],
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
