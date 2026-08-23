import { describe, expect, it } from 'vitest';
import { type CachedParagraph, ChapterLayout } from '../../src/book/chapter-layout.js';
import type { ParagraphKind } from '../../src/book/types.js';
import type { InlineAnnotation, InlineRubyAnnotation } from '../../src/browser/types.js';
import { computeBreaks } from '../../src/layout.js';
import { getLineRanges } from '../../src/paginate.js';
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

function computedBreakPoints(charCount: number): Uint32Array {
  return computeBreaks({
    text: toCodepoints('あ'.repeat(charCount)),
    advances: uniformAdvances(charCount, 10),
    lineWidth: 100,
  }).breakPoints;
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

  describe('resize', () => {
    function makeResizableLayout(): ChapterLayout {
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
      const entries: RenderEntry[] = [
        { chars: chars(text), breakPoints: computedBreakPoints(100), inlineAnnotations: [] },
      ];
      return makeLayout(cached, entries);
    }

    it('rejects a collapsed line width without changing any state', () => {
      const layout = makeResizableLayout();
      const before = layout.getPage(0);
      const totalPagesBefore = layout.totalPages;

      expect(() => layout.resize({ lineWidth: 0 })).toThrow(RangeError);

      const after = layout.getPage(0);
      expect(after.slots).toEqual(before.slots);
      expect(after.lines).toEqual(before.lines);
      expect(layout.totalPages).toBe(totalPagesBefore);
    });

    it('keeps geometry and breaks in step after a rejected resize', () => {
      const layout = makeResizableLayout();
      const before = layout.getPage(0);

      expect(() => layout.resize({ lineWidth: Number.NaN })).toThrow(RangeError);
      expect(() => layout.resize({ lineWidth: -50 })).toThrow(RangeError);
      expect(() => layout.resize({ pageWidth: Number.POSITIVE_INFINITY })).toThrow(RangeError);

      // A later cache drop must not resurrect a poisoned geometry.
      layout.setImages(0, []);
      expect(layout.getPage(0).slots).toEqual(before.slots);

      // The layout still accepts a valid resize afterwards.
      layout.resize({ lineWidth: 50 });
      expect(layout.getPage(0).slots.every((slot) => slot.height <= 50)).toBe(true);
    });
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
    const breakPoints = computedBreakPoints(100);
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

    // Line-end anchors stay on the line they end; the next character moves to
    // the following line.
    expect(layout.locateAnchor({ paragraph: 0, charIndex: 9 })?.lineIdx).toBe(0);
    expect(layout.locateAnchor({ paragraph: 0, charIndex: 10 })?.lineIdx).toBe(1);

    // Char index out of range → null.
    expect(layout.locateAnchor({ paragraph: 0, charIndex: -1 })).toBeNull();
    expect(layout.locateAnchor({ paragraph: 5, charIndex: 0 })).toBeNull();
  });

  it('rejects anchors that are not non-negative safe integers', () => {
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
    const entries: RenderEntry[] = [
      { chars: chars(text), breakPoints: computedBreakPoints(100), inlineAnnotations: [] },
    ];
    const layout = makeLayout(cached, entries);

    const rejected = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
    for (const value of rejected) {
      expect(layout.locateAnchor({ paragraph: value, charIndex: 0 })).toBeNull();
      expect(layout.locateAnchor({ paragraph: 0, charIndex: value })).toBeNull();
      expect(layout.coordOfAnchor({ paragraph: value, charIndex: 0 })).toBeNull();
      expect(layout.coordOfAnchor({ paragraph: 0, charIndex: value })).toBeNull();
    }

    // A valid anchor still resolves after the rejected ones.
    expect(layout.locateAnchor({ paragraph: 0, charIndex: 0 })).not.toBeNull();
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
    const breakPoints = computedBreakPoints(60);
    const entries: RenderEntry[] = [{ chars: chars(text), breakPoints, inlineAnnotations: [] }];
    const layout = makeLayout(cached, entries);

    const anchor = layout.anchorAt(0, 'right');
    expect(anchor).toEqual({ paragraph: 0, charIndex: 0 });
    if (!anchor) throw new Error('anchorAt returned null');

    const located = layout.locateAnchor(anchor);
    expect(located?.spreadIdx).toBe(0);
    expect(located?.side).toBe('right');
  });

  it('does not count an empty trailing left page in exclusion mode', () => {
    const text = 'あ'.repeat(50);
    const codepoints = toCodepoints(text);
    const cached: CachedParagraph[] = [
      {
        text: codepoints,
        advances: uniformAdvances(codepoints.length, 10),
        chars: chars(text),
        inlineAnnotations: [],
      },
    ];
    const breakPoints = computedBreakPoints(50);
    const entries: RenderEntry[] = [{ chars: chars(text), breakPoints, inlineAnnotations: [] }];
    const layout = makeLayout(cached, entries);

    layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 20, margin: 0 }]);

    expect(layout.totalPages).toBe(1);
    expect(layout.getSpread(0).totalPages).toBe(1);
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
      const layout = makeStaticLayout('あ'.repeat(100), computedBreakPoints(100));
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
      const layout = makeStaticLayout('あ'.repeat(150), computedBreakPoints(150));
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
      const layout = makeStaticLayout('あ'.repeat(100), computedBreakPoints(100));
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
      const layout = makeStaticLayout('あ'.repeat(30), computedBreakPoints(30));
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
      const layout = makeStaticLayout('あ'.repeat(30), computedBreakPoints(30));
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
      const layout = makeStaticLayout('あ'.repeat(30), computedBreakPoints(30));
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
      const layout = makeStaticLayout('あ'.repeat(20), computedBreakPoints(20));
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

  describe('ruby-aware anchor geometry', () => {
    // 'あ漢字あ…' with 6 ruby characters over '漢字': ruby width 60 against a
    // base width of 20, so the two base characters carry the widened advance.
    const TEXT = `あ漢字${'あ'.repeat(17)}`;

    function makeRubyLayout(withRuby: boolean): ChapterLayout {
      const codepoints = toCodepoints(TEXT);
      const advances = uniformAdvances(codepoints.length, 10);
      const rubyText = toCodepoints('かんじかんじ');
      const layoutRubyAnnotations: RubyAnnotation[] = [
        {
          startIndex: 1,
          endIndex: 3,
          rubyText,
          rubyAdvances: uniformAdvances(rubyText.length, 10),
          type: 'group',
        },
      ];
      const cached: CachedParagraph[] = [
        {
          text: codepoints,
          advances,
          chars: chars(TEXT),
          inlineAnnotations: withRuby
            ? [
                {
                  kind: 'ruby',
                  startIndex: 1,
                  endIndex: 3,
                  rubyText: 'かんじかんじ',
                  type: 'group',
                },
              ]
            : [],
          ...(withRuby ? { layoutRubyAnnotations } : {}),
        },
      ];
      const breakPoints = computeBreaks({
        text: codepoints,
        advances,
        lineWidth: 100,
        ...(withRuby ? { rubyAnnotations: layoutRubyAnnotations } : {}),
      }).breakPoints;
      const entries: RenderEntry[] = [
        { chars: chars(TEXT), breakPoints, inlineAnnotations: cached[0].inlineAnnotations },
      ];
      return makeLayout(cached, entries);
    }

    it('sizes selection rectangles from the ruby-widened advances', () => {
      const plainRects = makeRubyLayout(false).selectionRects({
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 4 },
      });
      const rubyRects = makeRubyLayout(true).selectionRects({
        start: { paragraph: 0, charIndex: 0 },
        end: { paragraph: 0, charIndex: 4 },
      });

      expect(plainRects).toHaveLength(1);
      expect(rubyRects).toHaveLength(1);
      expect(plainRects[0].height).toBeCloseTo(40, 5);
      // 10 + 30 + 30 + 10: the annotated characters carry the whole 60px of
      // ruby, since a neighbouring character never lends width to ruby.
      expect(rubyRects[0].height).toBeCloseTo(80, 5);
      expect(rubyRects[0].height).not.toBeCloseTo(plainRects[0].height, 5);
    });

    it('places a character rectangle where the ruby-aware breaks put it', () => {
      const layout = makeRubyLayout(true);
      const rect = layout.coordOfAnchor({ paragraph: 0, charIndex: 3 });
      if (!rect) throw new Error('rect is null');

      expect(rect.y).toBeCloseTo(70, 5);
      expect(rect.height).toBeCloseTo(10, 5);
    });

    it('round-trips anchor → coord → anchor with ruby present', () => {
      const layout = makeRubyLayout(true);
      for (const charIndex of [0, 1, 2, 3, 5]) {
        const original = { paragraph: 0, charIndex };
        const rect = layout.coordOfAnchor(original);
        if (!rect) throw new Error(`rect is null for char ${charIndex}`);
        const back = layout.anchorAtCoord(
          rect.spreadIdx,
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        expect(back).toEqual(original);
      }
    });

    it('hit-tests taps against the ruby-widened advances', () => {
      const layout = makeRubyLayout(true);
      // 40px down the first column is inside the second annotated character,
      // which spans 40..70; the raw advances would report char 4 instead.
      expect(layout.anchorAtCoord(0, 95, 40)).toEqual({ paragraph: 0, charIndex: 2 });
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

    it('reports codepoint offsets for supplementary-plane text', () => {
      // 𠮷 and 🐈 are each one codepoint but two UTF-16 code units, so a
      // UTF-16 offset would put 猫 at 5 instead of 3.
      const layout = setup(['𠮷野🐈猫です']);
      const [match] = layout.findText('猫');

      expect(match.paragraph).toBe(0);
      expect(match.charStart).toBe(3);
      expect(match.charEnd).toBe(4);
      expect(match.match).toBe('猫');
    });

    it('keeps a supplementary-plane match whole', () => {
      const layout = setup(['あ𠮷い']);
      const [match] = layout.findText('𠮷');

      expect(match.charStart).toBe(1);
      expect(match.charEnd).toBe(2);
      expect(match.match).toBe('𠮷');
    });

    it('reports codepoint offsets for supplementary-plane regex matches', () => {
      const layout = setup(['𠮷野🐈第12章']);
      const [match] = layout.findText('\\d+', { regex: true });

      expect(match.charStart).toBe(4);
      expect(match.charEnd).toBe(6);
      expect(match.match).toBe('12');
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

    it('uses Unicode regex semantics for regex queries', () => {
      const layout = setup(['ABC 漢字 123']);
      const matches = layout.findText('\\p{Script=Han}+', { regex: true });

      expect(matches.map((m) => [m.match, m.charStart, m.charEnd])).toEqual([['漢字', 4, 6]]);
    });

    it('rejects regex patterns with quantified complex groups', () => {
      const layout = setup(['aaaaaaaaaaaaaaaa!']);

      expect(() => layout.findText('(a+)+$', { regex: true })).toThrow(
        /Unsafe regex search pattern/,
      );
      expect(() => layout.findText('(a|aa)+$', { regex: true })).toThrow(
        /Unsafe regex search pattern/,
      );
    });

    it('rejects regex patterns with several quantifiers in one concatenation', () => {
      const layout = setup(['a'.repeat(60)]);

      expect(() => layout.findText('a*a*a*a*a*a*a*b', { regex: true })).toThrow(
        /Unsafe regex search pattern/,
      );
      // Splitting the quantifiers across groups does not help: an unquantified
      // group is spliced into the enclosing concatenation.
      expect(() => layout.findText('(a*)(a*)b', { regex: true })).toThrow(
        /Unsafe regex search pattern/,
      );
      // An optional term between the quantifiers does not anchor them either.
      expect(() => layout.findText('a*b?a*c', { regex: true })).toThrow(
        /Unsafe regex search pattern/,
      );
    });

    it('accepts quantifiers separated by a term that always consumes input', () => {
      const layout = setup(['2026年8月に刊行']);

      expect(layout.findText('\\d+年\\d+月', { regex: true }).map((m) => m.match)).toEqual([
        '2026年8月',
      ]);
    });

    it('refuses a long adversarial pattern instead of running it', () => {
      const layout = setup(['a'.repeat(60)]);
      const pattern = `${'a*'.repeat(30)}b`;
      expect(pattern.length).toBeGreaterThanOrEqual(60);

      const started = Date.now();
      expect(() => layout.findText(pattern, { regex: true })).toThrow(
        /Unsafe regex search pattern/,
      );
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it('keeps accepting patterns with a single quantified term', () => {
      const layout = setup(['第1章: 漢字', '第10章: あ']);

      expect(layout.findText('第\\d+章', { regex: true }).map((m) => m.match)).toEqual([
        '第1章',
        '第10章',
      ]);
      expect(layout.findText('\\p{Script=Han}+', { regex: true }).map((m) => m.match)).toEqual([
        '第',
        '章',
        '漢字',
        '第',
        '章',
      ]);
      // A lazy quantifier is one term, and alternatives are counted separately.
      expect(() => layout.findText('漢.*?字', { regex: true })).not.toThrow();
      expect(() => layout.findText('あ*|い*', { regex: true })).not.toThrow();
    });

    it('accepts a RegExp query and takes the regex path', () => {
      const layout = setup(['第1章: あ\n第10章: い']);

      const matches = layout.findText(/第\d+章/g);
      expect(matches.map((m) => m.match)).toEqual(['第1章', '第10章']);
      // A RegExp never falls through to the literal path, whatever `regex` says.
      expect(layout.findText(/第\d+章/, { regex: false }).map((m) => m.match)).toEqual([
        '第1章',
        '第10章',
      ]);
    });

    it('honours a RegExp own case flag and lets caseSensitive override it', () => {
      const layout = setup(['Hello hello HELLO']);

      expect(layout.findText(/hello/).map((m) => m.charStart)).toEqual([6]);
      expect(layout.findText(/hello/i).map((m) => m.charStart)).toEqual([0, 6, 12]);
      expect(layout.findText(/hello/i, { caseSensitive: true }).map((m) => m.charStart)).toEqual([
        6,
      ]);
      expect(layout.findText(/hello/, { caseSensitive: false }).map((m) => m.charStart)).toEqual([
        0, 6, 12,
      ]);
    });

    it('applies the regex safety guard to RegExp queries too', () => {
      const layout = setup(['aaaaaaaaaaaaaaaa!']);
      expect(() => layout.findText(/(a+)+$/)).toThrow(/Unsafe regex search pattern/);
    });

    it('returns an empty array for a RegExp that matches nothing', () => {
      const layout = setup(['あいうえお']);
      expect(layout.findText(/(?:)/)).toEqual([]);
      expect(layout.findText(/かきくけこ/)).toEqual([]);
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

  describe('image exclusion that blocks a whole column', () => {
    // 400px page, 40px padding → 320px content; fontSize 16 × lineSpacing 1.9
    // → 30.4px pitch → 10 columns per page.
    function makeBlockedLayout(): ChapterLayout {
      const body = 'あ'.repeat(1000);
      const cached: CachedParagraph[] = [
        {
          text: toCodepoints(body),
          advances: uniformAdvances([...body].length, 16),
          chars: chars(body),
          inlineAnnotations: [],
        },
      ];
      const entries: RenderEntry[] = [
        { chars: chars(body), breakPoints: new Uint32Array(0), inlineAnnotations: [] },
      ];
      return new ChapterLayout(
        cached,
        entries,
        {
          fontSize: 16,
          lineSpacing: 1.9,
          headingScale: 1.4,
          mode: 'strict',
          enableHanging: true,
        },
        { pageWidth: 400, lineWidth: 600, pagePaddingX: 40, pagePaddingY: 40 },
      );
    }

    it('reports an image that takes a full column as affecting the page', () => {
      const layout = makeBlockedLayout();
      // Covers the rightmost column over the full line width: every surviving
      // slot keeps its full height, so only the missing column reveals it.
      layout.setImages(0, [{ x: 330, y: 40, w: 30, h: 600 }]);

      const spread = layout.getSpread(0);
      expect(layout.hasImages).toBe(true);
      expect(spread.right.hasImages).toBe(true);
      expect(spread.right.slots).toHaveLength(9);
      expect(spread.right.slots[0].xPos).toBeCloseTo(30.4, 5);
      // No text is placed in the column the image occupies.
      expect(spread.right.slots.every((s) => s.xPos > 0.5)).toBe(true);
    });

    it('moves the text on when an image blocks an entire spread', () => {
      const layout = makeBlockedLayout();
      // Wide enough to cover both pages of the spread over the full line width.
      layout.setImages(0, [{ x: -400, y: 40, w: 800, h: 600 }]);

      const first = layout.getSpread(0);
      expect(first.right.hasImages).toBe(true);
      expect(first.right.lines).toEqual([]);
      expect(first.left.lines).toEqual([]);
      // The blocked spread must not swallow the chapter: text resumes later.
      expect(layout.getSpread(1).right.lines.length).toBeGreaterThan(0);
    }, 5000);

    it('keeps page and chapter image state in step across updates', () => {
      const layout = makeBlockedLayout();
      expect(layout.hasImages).toBe(false);
      expect(layout.getSpread(0).right.hasImages).toBe(false);

      layout.setImages(0, [{ x: 330, y: 40, w: 30, h: 600 }]);
      expect(layout.hasImages).toBe(true);
      expect(layout.getSpread(0).right.hasImages).toBe(true);

      layout.clearImages();
      expect(layout.hasImages).toBe(false);
      expect(layout.getSpread(0).right.hasImages).toBe(false);
    });
  });

  describe('image exclusion with a wide heading column', () => {
    // fontSize 10, lineSpacing 1 → body pitch 10; headingScale 1.4 → heading
    // font 14, pitch 14. pageWidth/contentWidth 100 → 10 body columns / page.
    const BASE_PITCH = 10;
    const CONTENT_WIDTH = 100;

    function makeHeadedLayout(): ChapterLayout {
      const heading = '章';
      const body = 'あ'.repeat(400);
      const cached: CachedParagraph[] = [
        {
          text: toCodepoints(heading),
          advances: uniformAdvances([...heading].length, 14),
          chars: chars(heading),
          inlineAnnotations: [],
          headingLevel: 1,
        },
        {
          text: toCodepoints(body),
          advances: uniformAdvances([...body].length, 10),
          chars: chars(body),
          inlineAnnotations: [],
        },
      ];
      const entries: RenderEntry[] = [
        {
          chars: chars(heading),
          breakPoints: new Uint32Array(0),
          inlineAnnotations: [],
          headingLevel: 1,
        },
        { chars: chars(body), breakPoints: new Uint32Array(0), inlineAnnotations: [] },
      ];
      return makeLayout(cached, entries);
    }

    /** Concatenates all rendered text across every spread of the layout. */
    function renderedText(layout: ChapterLayout): string {
      const spreadCount = Math.ceil(layout.totalPages / 2);
      let out = '';
      for (let s = 0; s < spreadCount; s++) {
        const spread = layout.getSpread(s);
        for (const page of [spread.right, spread.left]) {
          for (const line of page.lines) {
            for (const seg of line.segments) {
              if (seg.type === 'text') out += seg.text;
            }
          }
        }
      }
      return out;
    }

    it('keeps every right-page column inside the page content box', () => {
      const layout = makeHeadedLayout();
      // Image on the right page (content coords): overlaps body columns near x≈30.
      layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 30, margin: 0 }]);

      const spread = layout.getSpread(0);
      expect(spread.right.hasImages).toBe(true);

      // In vertical-rl, a slot's xPos is its distance from the right content
      // edge; the column occupies [xPos, xPos + pitch]. No column may extend
      // past the content box, or it is clipped off the page's left edge.
      const overflow = spread.right.slots.filter((s) => s.xPos + BASE_PITCH > CONTENT_WIDTH + 0.5);
      expect(overflow).toEqual([]);
    });

    it('reflows the trimmed columns instead of dropping their text', () => {
      const layout = makeHeadedLayout();
      const expected = renderedText(layout);

      layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 30, margin: 0 }]);
      // Columns trimmed from the overflowing right page must reappear on a
      // later page — the full chapter text is still rendered, never lost.
      expect(renderedText(layout)).toBe(expected);
    });

    it('uses heading pitch for exclusion anchor rectangles and taps', () => {
      const layout = makeHeadedLayout();
      layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 30, margin: 0 }]);

      const rect = layout.coordOfAnchor({ paragraph: 0, charIndex: 0 });
      expect(rect?.width).toBe(14);
      if (!rect) throw new Error('missing heading rect');

      const anchor = layout.anchorAtCoord(rect.spreadIdx, rect.x + rect.width / 2, rect.y + 1);
      expect(anchor).toEqual({ paragraph: 0, charIndex: 0 });
    });

    it('applies heading offset compensation to left-page images', () => {
      const layout = makeHeadedLayout();
      layout.setImages(0, [{ x: -70, y: 10, w: 20, h: 30, margin: 0 }]);

      const spread = layout.getSpread(0);

      expect(spread.left.hasImages).toBe(true);
      expect(spread.left.slots.some((slot) => slot.height < 100)).toBe(true);
    });
  });

  describe('paragraph kind across re-breaks', () => {
    const KINDS: ParagraphKind[] = ['heading', 'body', 'blockquote', 'sceneBreak', 'pre', 'figure'];

    function makeKindedLayout(): ChapterLayout {
      const text = 'あああ';
      const cached: CachedParagraph[] = KINDS.map((kind) => ({
        text: toCodepoints(text),
        advances: uniformAdvances([...text].length, 10),
        chars: chars(text),
        inlineAnnotations: [],
        ...(kind === 'heading' ? { headingLevel: 2, isHeading: true } : {}),
      }));
      const entries: RenderEntry[] = KINDS.map((kind) => ({
        chars: chars(text),
        breakPoints: new Uint32Array(0),
        inlineAnnotations: [],
        kind,
        ...(kind === 'heading' ? { headingLevel: 2, isHeading: true } : {}),
      }));
      return makeLayout(cached, entries);
    }

    /**
     * Kinds of every paragraph on the first spread. Both pages are read,
     * because a narrower column pitch can push the tail onto the left page.
     */
    function renderedKinds(layout: ChapterLayout): (ParagraphKind | undefined)[] {
      const spread = layout.getSpread(0);
      return [...spread.right.page.paragraphs, ...spread.left.page.paragraphs].map((p) => p.kind);
    }

    it('carries the kind of every paragraph into the first layout', () => {
      expect(renderedKinds(makeKindedLayout())).toEqual(KINDS);
    });

    it('keeps the kind after a resize re-break', () => {
      const layout = makeKindedLayout();
      layout.resize({ lineWidth: 60 });

      expect(renderedKinds(layout)).toEqual(KINDS);
    });

    it('keeps the kind after an option change re-break', () => {
      const layout = makeKindedLayout();
      layout.applyConfig({
        fontSize: 12,
        lineSpacing: 1,
        headingScale: 1.4,
        mode: 'loose',
        enableHanging: false,
      });

      expect(renderedKinds(layout)).toEqual(KINDS);
    });

    it('keeps the kind after a font re-measurement re-break', () => {
      const layout = makeKindedLayout();
      for (const para of layout.getCachedParagraphs()) {
        para.advances = uniformAdvances(para.text.length, 8);
      }
      layout.recomputeAfterMeasurement();

      expect(renderedKinds(layout)).toEqual(KINDS);
    });

    it('keeps the kind on the image exclusion path', () => {
      const layout = makeKindedLayout();
      layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 30, margin: 0 }]);

      const spread = layout.getSpread(0);
      expect(spread.right.hasImages).toBe(true);
      expect(renderedKinds(layout)).toEqual(KINDS);
    });

    it('records the kind in the snapshot, leaving body implicit', () => {
      const snapshot = makeKindedLayout().snapshot();

      expect(snapshot.paragraphs.map((p) => p.kind)).toEqual([
        'heading',
        undefined,
        'blockquote',
        'sceneBreak',
        'pre',
        'figure',
      ]);
    });
  });

  it('aligns exclusion line widths with gap-aware spread assignment on later spreads', () => {
    const paragraphs = Array.from({ length: 12 }, () => 'あ'.repeat(20));
    const cached: CachedParagraph[] = paragraphs.map((text) => ({
      text: toCodepoints(text),
      advances: uniformAdvances([...text].length, 10),
      chars: chars(text),
      inlineAnnotations: [],
    }));
    const entries: RenderEntry[] = paragraphs.map((text) => ({
      chars: chars(text),
      breakPoints: new Uint32Array(0),
      inlineAnnotations: [],
    }));
    const layout = makeLayout(cached, entries);

    layout.setImages(1, [{ x: 20, y: 20, w: 40, h: 60, margin: 0 }]);

    const page = layout.getSpread(1).right;
    expect(page.hasImages).toBe(true);
    expect(page.lines).toHaveLength(page.slots.length);

    const constrained = page.lines
      .map((line, i) => ({ line, slot: page.slots[i] }))
      .filter(({ slot }) => slot.height < 100);
    expect(constrained.length).toBeGreaterThan(0);

    for (const { line, slot } of constrained) {
      const charCount = line.segments.reduce((sum, segment) => {
        if (segment.type === 'text') return sum + [...segment.text].length;
        if (segment.type === 'ruby') return sum + [...segment.base].length;
        return sum + [...segment.text].length;
      }, 0);
      expect(charCount * 10).toBeLessThanOrEqual(slot.height + 0.5);
    }
  });

  describe('snapshot', () => {
    const SNAPSHOT_TEXT = 'あ'.repeat(25);

    function lineTexts(layout: ChapterLayout): string[] {
      return layout
        .getPage(0)
        .lines.map((line) =>
          line.segments
            .map((segment) => (segment.type === 'ruby' ? segment.base : segment.text))
            .join(''),
        );
    }

    function makeSnapshotLayout(): ChapterLayout {
      const codepoints = toCodepoints(SNAPSHOT_TEXT);
      const inlineAnnotations: InlineAnnotation[] = [
        {
          kind: 'ruby',
          startIndex: 0,
          endIndex: 2,
          rubyText: 'かんじ',
          type: 'jukugo',
          jukugoSplitPoints: [1],
        },
        { kind: 'link', startIndex: 3, endIndex: 5, href: 'https://example.com' },
      ];
      const cached: CachedParagraph[] = [
        {
          text: codepoints,
          advances: uniformAdvances(codepoints.length, 10),
          chars: chars(SNAPSHOT_TEXT),
          inlineAnnotations,
          layoutRubyAnnotations: [
            {
              startIndex: 0,
              endIndex: 2,
              rubyText: toCodepoints('かんじ'),
              rubyAdvances: uniformAdvances(3, 5),
              type: 'jukugo',
              jukugoSplitPoints: [1],
            },
          ],
          headingLevel: 2,
          isHeading: true,
        },
      ];
      const entries: RenderEntry[] = [
        {
          chars: chars(SNAPSHOT_TEXT),
          breakPoints: computedBreakPoints(25),
          inlineAnnotations,
          headingLevel: 2,
          isHeading: true,
        },
      ];
      return new ChapterLayout(
        cached,
        entries,
        {
          fontSize: 10,
          lineSpacing: 1,
          headingScale: 1.4,
          headingStyles: { 2: { scale: 1.2, gapAfterEm: 0.5 } },
          mode: 'strict',
          enableHanging: true,
        },
        { pageWidth: 400, lineWidth: 100, pagePaddingX: 0, pagePaddingY: 0 },
      );
    }

    it('reports break points as the last index of each line, as getLineRanges reads them', () => {
      const layout = makeSnapshotLayout();
      const para = layout.snapshot().paragraphs[0];
      const rendered = lineTexts(layout);

      const ranges = getLineRanges(Uint32Array.from(para.breakPoints), [...para.text].length);
      expect(ranges.map(([start, end]) => [...para.text].slice(start, end).join(''))).toEqual(
        rendered,
      );
      // The final index of line 0 is inclusive, so it is one less than its length.
      expect(para.breakPoints[0]).toBe([...rendered[0]].length - 1);
      expect(para.breakPoints).toHaveLength(rendered.length - 1);
    });

    it('shares no object with the live layout', () => {
      const layout = makeSnapshotLayout();
      layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 30, margin: 0 }]);
      const cached = layout.getCachedParagraphs()[0];
      const snap = layout.snapshot();

      expect(snap.paragraphs[0].inlineAnnotations).not.toBe(cached.inlineAnnotations);
      expect(snap.paragraphs[0].inlineAnnotations[0]).not.toBe(cached.inlineAnnotations[0]);
      expect(snap.paragraphs[0].layoutRubyAnnotations?.[0]).not.toBe(
        cached.layoutRubyAnnotations?.[0],
      );
    });

    it('keeps the live layout intact when every array in the snapshot is mutated', () => {
      const layout = makeSnapshotLayout();
      layout.setImages(0, [{ x: 20, y: 10, w: 20, h: 30, margin: 0 }]);
      const before = structuredClone(layout.snapshot());
      const renderedBefore = lineTexts(layout);

      const snap = layout.snapshot();
      const para = snap.paragraphs[0];
      para.advances[0] = 999;
      para.breakPoints[0] = 0;
      para.breakPoints.push(999);
      const ruby = para.inlineAnnotations[0] as InlineRubyAnnotation;
      ruby.startIndex = 99;
      ruby.rubyText = 'ダミー';
      ruby.jukugoSplitPoints?.push(99);
      para.inlineAnnotations = [];
      const layoutRuby = para.layoutRubyAnnotations?.[0];
      if (layoutRuby) {
        layoutRuby.rubyText[0] = 0;
        layoutRuby.rubyAdvances[0] = 999;
        layoutRuby.jukugoSplitPoints?.push(99);
      }
      snap.paragraphs.push(para);
      const headingStyles = snap.config.headingStyles;
      if (headingStyles) headingStyles[2].scale = 99;
      const spreadImages = snap.images?.[0];
      if (spreadImages) {
        spreadImages.images[0].x = 999;
        spreadImages.images.push({ x: 0, y: 0, w: 1, h: 1 });
      }
      snap.images?.push({ spreadIndex: 5, images: [] });

      expect(layout.snapshot()).toEqual(before);
      expect(lineTexts(layout)).toEqual(renderedBefore);
    });
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
